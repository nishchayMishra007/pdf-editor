"""Document REST endpoints."""

from __future__ import annotations

from pathlib import Path

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas import DocumentOut, LayoutOut, OpsPut, OpsPutResult, RenameIn
from ..services import documents as svc

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("/drafts", response_model=DocumentOut)
def create_draft(db: Session = Depends(get_db)) -> dict:
    """Start an empty playground draft and return its id."""
    return svc.document_to_out(svc.create_draft(db))


@router.post("/{doc_id}/file", response_model=DocumentOut)
async def attach_file(
    doc_id: str,
    file: UploadFile = File(...),
    password: Optional[str] = Form(None),
    db: Session = Depends(get_db),
) -> dict:
    doc = await svc.attach_pdf(db, doc_id, file, password=password)
    return svc.document_to_out(doc)


@router.post("", response_model=DocumentOut)
async def upload_document(
    file: UploadFile = File(...),
    password: Optional[str] = Form(None),
    db: Session = Depends(get_db),
) -> dict:
    doc = await svc.create_document(db, file, password=password)
    return svc.document_to_out(doc)


@router.get("", response_model=list[DocumentOut])
def list_recent(db: Session = Depends(get_db)) -> list[dict]:
    return [svc.document_to_out(d) for d in svc.list_documents(db)]


@router.get("/{doc_id}", response_model=DocumentOut)
def get_one(doc_id: str, db: Session = Depends(get_db)) -> dict:
    return svc.document_to_out(svc.get_document(db, doc_id))


@router.patch("/{doc_id}", response_model=DocumentOut)
def rename_one(doc_id: str, body: RenameIn, db: Session = Depends(get_db)) -> dict:
    return svc.document_to_out(svc.rename_document(db, doc_id, body.name))


@router.delete("/{doc_id}", status_code=204)
def delete_one(doc_id: str, db: Session = Depends(get_db)) -> Response:
    svc.delete_document(db, doc_id)
    return Response(status_code=204)


@router.get("/{doc_id}/pages/{page_n}/layout", response_model=LayoutOut)
def get_layout(doc_id: str, page_n: int, db: Session = Depends(get_db)) -> dict:
    return svc.page_layout(db, doc_id, page_n)


@router.put("/{doc_id}/ops", response_model=OpsPutResult)
def put_ops(doc_id: str, body: OpsPut, db: Session = Depends(get_db)) -> dict:
    result = svc.save_ops(db, doc_id, body.ops)
    return {
        "id": doc_id,
        "applied": result.applied,
        "skipped": result.skipped,
        "warnings": result.warnings,
        "op_metrics": svc.op_metrics_dicts(result),
    }


@router.get("/{doc_id}/original")
def get_original(doc_id: str, db: Session = Depends(get_db)) -> Response:
    """Unmodified original PDF bytes — used by Compare mode."""
    doc = svc.get_document(db, doc_id)
    data = Path(doc.original_path).read_bytes()
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/{doc_id}/working")
def get_working(doc_id: str, db: Session = Depends(get_db)) -> Response:
    data = svc.working_pdf_bytes(db, doc_id)
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/{doc_id}/ops")
def get_ops(doc_id: str, db: Session = Depends(get_db)) -> dict:
    doc = svc.get_document(db, doc_id)
    import json

    return {
        "id": doc_id,
        "ops": json.loads(doc.ops_json or "[]"),
        "warnings": json.loads(doc.warnings_json or "[]"),
    }


@router.get("/{doc_id}/fonts/{font_name}")
def get_font(
    doc_id: str,
    font_name: str,
    page: int = 0,
    db: Session = Depends(get_db),
) -> Response:
    data = svc.font_bytes(db, doc_id, font_name, page=page)
    return Response(
        content=data,
        media_type="font/ttf",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.post("/{doc_id}/export")
def export_document(doc_id: str, db: Session = Depends(get_db)) -> Response:
    path, download_name, _warnings = svc.export_pdf(db, doc_id)
    return Response(
        content=path.read_bytes(),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{download_name}"',
            "Cache-Control": "no-store",
            "X-Export-Filename": download_name,
        },
    )
