"""Document lifecycle: upload, ops autosave, working PDF, export, fonts."""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Optional

import fitz
from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..models import Document
from ..ops.engine import OpsResult, apply_ops
from ..ops.fonts import extract_page_fonts, resolve_font
from ..ops.layout import extract_page_layout
from ..ops.models import EditOp
from . import storage


def _loads_ops(raw: str) -> list[EditOp]:
    data = json.loads(raw or "[]")
    return [EditOp.model_validate(item) for item in data]


def _dumps_ops(ops: list[EditOp]) -> str:
    return json.dumps([op.model_dump(mode="json") for op in ops])


def list_documents(db: Session, limit: int = 50) -> list[Document]:
    return (
        db.query(Document)
        .order_by(Document.updated_at.desc())
        .limit(limit)
        .all()
    )


def get_document(db: Session, doc_id: str) -> Document:
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


def rename_document(db: Session, doc_id: str, name: str) -> Document:
    doc = get_document(db, doc_id)
    cleaned = " ".join(name.split()).strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    doc.name = cleaned[:512]
    db.commit()
    db.refresh(doc)
    return doc


def delete_document(db: Session, doc_id: str) -> None:
    doc = get_document(db, doc_id)
    paths = [
        storage.working_path(doc_id),
        storage.export_path(doc_id, doc.name),
    ]
    if doc.original_path:
        paths.insert(0, Path(doc.original_path))
    db.delete(doc)
    db.commit()
    for path in paths:
        try:
            if path.exists():
                path.unlink()
        except OSError:
            pass


def _unlock_pdf(pdf: fitz.Document, password: Optional[str]) -> None:
    """Authenticate an encrypted PDF. Raises HTTPException on failure."""
    # needs_pass: user must supply a password. Some PDFs are "encrypted" but
    # open with an empty password (owner-only restrictions).
    needs = bool(getattr(pdf, "needs_pass", False) or pdf.is_encrypted)
    if not needs:
        return
    pw = password if password is not None else ""
    if pdf.authenticate(pw):
        return
    # Empty password failed — ask the user, or reject a wrong one.
    if not pw:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "password_required",
                "message": "This PDF is password-protected. Enter the password to open it.",
            },
        )
    raise HTTPException(
        status_code=401,
        detail={
            "code": "invalid_password",
            "message": "Incorrect password. Try again.",
        },
    )


def _pdf_bytes_unlocked(pdf: fitz.Document, original: bytes, *, was_locked: bool) -> bytes:
    """Return PDF bytes suitable for storage (strip encryption when needed).

    After authenticate(), ``is_encrypted`` becomes False — so we must use
    ``was_locked`` (pre-auth) to decide whether to rewrite unlocked bytes.
    """
    if not was_locked:
        return original
    import io

    try:
        return pdf.tobytes(garbage=3, deflate=True, encryption=fitz.PDF_ENCRYPT_NONE)
    except TypeError:
        buf = io.BytesIO()
        pdf.save(buf, garbage=3, deflate=True, encryption=fitz.PDF_ENCRYPT_NONE)
        return buf.getvalue()
    except Exception:  # noqa: BLE001
        # Last resort: page-copy into a fresh unencrypted document.
        fresh = fitz.open()
        try:
            fresh.insert_pdf(pdf)
            buf = io.BytesIO()
            fresh.save(buf, garbage=4, deflate=True)
            return buf.getvalue()
        finally:
            fresh.close()


def _prepare_pdf(
    data: bytes,
    filename: str,
    password: Optional[str],
) -> tuple[bytes, int, bool, list[str]]:
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF uploads are supported")
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        pdf = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid PDF: {exc}") from exc

    try:
        was_locked = bool(getattr(pdf, "needs_pass", False) or pdf.is_encrypted)
        _unlock_pdf(pdf, password)
        page_count = pdf.page_count
        has_text = False
        for i in range(min(page_count, 5)):
            if extract_page_layout(pdf[i])["has_text"]:
                has_text = True
                break
        stored = _pdf_bytes_unlocked(pdf, data, was_locked=was_locked)
    finally:
        pdf.close()

    warnings: list[str] = []
    if was_locked and password:
        warnings.append(
            "Opened a password-protected PDF; a decrypted local copy is used for editing."
        )
    if not has_text:
        warnings.append(
            "No text layer detected on the first pages (scanned PDF?). "
            "Text editing is unavailable; OCR is out of scope."
        )
    return stored, page_count, has_text, warnings


def create_draft(db: Session) -> Document:
    """Empty playground draft — PDF is attached later."""
    doc = Document(
        id=str(uuid.uuid4()),
        name="Untitled draft",
        original_path="",
        page_count=0,
        has_text=0,
        ops_json="[]",
        warnings_json="[]",
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def _write_pdf_files(doc_id: str, filename: str, stored: bytes) -> str:
    dest = storage.original_path(doc_id, filename)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(stored)
    storage.working_path(doc_id).write_bytes(stored)
    return str(dest)


async def create_document(
    db: Session,
    upload: UploadFile,
    password: Optional[str] = None,
) -> Document:
    filename = upload.filename or "document.pdf"
    stored, page_count, has_text, warnings = _prepare_pdf(
        await upload.read(), filename, password
    )
    doc_id = str(uuid.uuid4())
    path = _write_pdf_files(doc_id, filename, stored)
    doc = Document(
        id=doc_id,
        name=filename,
        original_path=path,
        page_count=page_count,
        has_text=1 if has_text else 0,
        ops_json="[]",
        warnings_json=json.dumps(warnings),
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


async def attach_pdf(
    db: Session,
    doc_id: str,
    upload: UploadFile,
    password: Optional[str] = None,
) -> Document:
    """Bind a PDF to an existing draft and reset edits."""
    doc = get_document(db, doc_id)
    filename = upload.filename or "document.pdf"
    stored, page_count, has_text, warnings = _prepare_pdf(
        await upload.read(), filename, password
    )
    if doc.original_path:
        old = Path(doc.original_path)
        try:
            if old.is_file():
                old.unlink()
        except OSError:
            pass
    doc.name = filename
    doc.original_path = _write_pdf_files(doc_id, filename, stored)
    doc.page_count = page_count
    doc.has_text = 1 if has_text else 0
    doc.ops_json = "[]"
    doc.warnings_json = json.dumps(warnings)
    db.commit()
    db.refresh(doc)
    return doc


def page_layout(db: Session, doc_id: str, page_n: int) -> dict:
    """page_n is 1-based in the API."""
    doc = get_document(db, doc_id)
    if not doc.original_path:
        raise HTTPException(status_code=404, detail="No PDF uploaded for this draft yet")
    if page_n < 1 or page_n > doc.page_count:
        raise HTTPException(status_code=404, detail="Page out of range")
    pdf = fitz.open(doc.original_path)
    try:
        layout = extract_page_layout(pdf[page_n - 1])
        if not layout["has_text"]:
            layout["message"] = (
                "No text layer on this page (scanned?). OCR is out of scope."
            )
        return layout
    finally:
        pdf.close()


def save_ops(db: Session, doc_id: str, ops: list[EditOp]) -> OpsResult:
    doc = get_document(db, doc_id)
    if not doc.original_path:
        raise HTTPException(status_code=400, detail="Upload a PDF before editing")
    result = apply_ops(doc.original_path, ops)
    storage.working_path(doc_id).write_bytes(result.pdf_bytes)
    doc.ops_json = _dumps_ops(ops)
    warnings = list(result.warnings)
    if not doc.has_text:
        warnings = [
            "No text layer detected (scanned PDF?). Text editing is unavailable."
        ] + warnings
    doc.warnings_json = json.dumps(warnings)
    db.commit()
    return result


def working_pdf_bytes(db: Session, doc_id: str) -> bytes:
    doc = get_document(db, doc_id)
    if not doc.original_path:
        raise HTTPException(status_code=404, detail="No PDF uploaded for this draft yet")
    path = storage.working_path(doc_id)
    if path.exists():
        return path.read_bytes()
    # Rebuild from ops if working file missing
    ops = _loads_ops(doc.ops_json)
    result = apply_ops(doc.original_path, ops)
    path.write_bytes(result.pdf_bytes)
    return result.pdf_bytes


def export_pdf(db: Session, doc_id: str) -> tuple[Path, str, list[str]]:
    doc = get_document(db, doc_id)
    if not doc.original_path:
        raise HTTPException(status_code=400, detail="Upload a PDF before downloading")
    ops = _loads_ops(doc.ops_json)
    result = apply_ops(doc.original_path, ops)
    out = storage.export_path(doc_id, doc.name)
    out.write_bytes(result.pdf_bytes)
    stem = storage.safe_stem(doc.name)
    download_name = f"{stem}_edited.pdf"
    return out, download_name, result.warnings


def font_bytes(db: Session, doc_id: str, font_name: str, page: int = 0) -> bytes:
    doc = get_document(db, doc_id)
    pdf = fitz.open(doc.original_path)
    try:
        if page < 0 or page >= pdf.page_count:
            page = 0
        page_obj = pdf[page]
        cache = extract_page_fonts(pdf, page_obj)
        fres = resolve_font(pdf, page_obj, font_name, extracted_cache=cache)
        if fres.buffer:
            return fres.buffer
        # Try direct cache hit
        for key, buf in cache.items():
            if font_name.lower() in key.lower():
                return buf
        raise HTTPException(status_code=404, detail=f"Font '{font_name}' not available")
    finally:
        pdf.close()


def document_to_out(doc: Document) -> dict:
    try:
        warnings = json.loads(doc.warnings_json or "[]")
    except json.JSONDecodeError:
        warnings = []
    return {
        "id": doc.id,
        "name": doc.name,
        "page_count": doc.page_count,
        "has_text": bool(doc.has_text),
        "has_file": bool(doc.original_path),
        "created_at": doc.created_at,
        "updated_at": doc.updated_at,
        "warnings": warnings,
    }


def op_metrics_dicts(result: OpsResult) -> list[dict]:
    return [asdict(m) for m in result.op_metrics]
