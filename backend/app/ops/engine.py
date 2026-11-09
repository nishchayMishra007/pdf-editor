"""Apply JSON edit ops onto a copy of the original PDF.

Fidelity rules:
- Never mutate the source file; caller passes a path / bytes and we open a copy.
- Remove old text via redaction with fill=False and images/graphics = NONE.
- Re-insert text using the original embedded font when possible.
- Do not shrink font size to fit. Prefer a single line: expand the draw
  width to the right (clamped to the page) when new text is longer.
  Only wrap / warn when the text still cannot fit (e.g. past page edge
  or explicit newlines).
"""

from __future__ import annotations

import io
import logging
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional, Union

import fitz

from .fonts import (
    ensure_bundled_fonts,
    find_bundled_font,
    missing_glyphs,
    resolve_font,
)
from .layout import extract_page_layout, find_span
from .models import BBox, EditOp, OpType

logger = logging.getLogger(__name__)

Source = Union[str, Path, bytes]


@dataclass
class OpMetrics:
    """Per-op fidelity / font metrics surfaced to the spike and API."""

    op_id: str
    font_source: str = "embedded"  # embedded | bundled | base14
    fallback_glyph_count: int = 0
    fallback_glyphs: list[str] = field(default_factory=list)
    overflow: bool = False
    clipped: bool = False
    notes: list[str] = field(default_factory=list)
    # Actual draw box used after width expansion (PDF points).
    drawn_bbox: Optional[tuple[float, float, float, float]] = None


@dataclass
class OpsResult:
    pdf_bytes: bytes
    warnings: list[str] = field(default_factory=list)
    applied: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    op_metrics: list[OpMetrics] = field(default_factory=list)


def _open_copy(source: Source) -> fitz.Document:
    if isinstance(source, (str, Path)):
        doc = fitz.open(source)
    else:
        doc = fitz.open(stream=source, filetype="pdf")
    # Work on an in-memory copy so the original file handle is never written.
    data = doc.tobytes()
    doc.close()
    return fitz.open(stream=data, filetype="pdf")


def _register_font(page: fitz.Page, fontname: str, buffer: Optional[bytes]) -> str:
    if buffer is None:
        return fontname  # base-14
    # insert_font returns an xref (int) in PyMuPDF — keep our logical name for draw calls.
    page.insert_font(fontname=fontname, fontbuffer=buffer)
    return fontname


def _color_rgb(color: Optional[tuple[float, float, float]]) -> tuple[float, float, float]:
    if not color:
        return (0.0, 0.0, 0.0)
    return (float(color[0]), float(color[1]), float(color[2]))


def _morph_for_dir(
    origin: tuple[float, float],
    direction: Optional[tuple[float, float]],
) -> Optional[tuple[fitz.Point, fitz.Matrix]]:
    """Build a PyMuPDF morph for non-horizontal text (line direction vector)."""
    if not direction:
        return None
    dx, dy = float(direction[0]), float(direction[1])
    if abs(dy) < 1e-6 and dx >= 0:
        return None  # horizontal LTR — no morph needed
    # PyMuPDF text `dir` is the baseline unit vector; Matrix(a) rotation that
    # reproduces it is the negation of atan2(dy, dx) (PDF y-down vs math y-up).
    angle = -math.degrees(math.atan2(dy, dx))
    return (fitz.Point(origin), fitz.Matrix(angle))


def _approx_text_width(text: str, fontname: str, fontsize: float, fontbuffer: Optional[bytes] = None) -> float:
    """Estimate rendered width in points."""
    try:
        if fontbuffer:
            font = fitz.Font(fontbuffer=fontbuffer)
            return float(font.text_length(text, fontsize=fontsize))
        return float(fitz.get_text_length(text, fontname=fontname, fontsize=fontsize))
    except Exception:  # noqa: BLE001
        # Rough CJK-unaware fallback
        return len(text) * fontsize * 0.5


def _expanded_draw_width(
    page: fitz.Page,
    bbox: BBox,
    text_w: float,
) -> tuple[float, bool]:
    """Width needed to keep text on one line, clamped to the page right edge.

    Returns (draw_width, clipped_by_page).
    """
    box_w = max(bbox.width(), 1.0)
    needed = max(box_w, text_w * 1.04 + 2.0)
    max_w = max(page.rect.width - bbox.x0 - 1.0, box_w)
    if needed <= max_w + 0.5:
        return needed, False
    return max_w, True


def _insert_span_text(
    page: fitz.Page,
    *,
    text: str,
    bbox: BBox,
    fontname: str,
    fontsize: float,
    color: tuple[float, float, float],
    origin: Optional[tuple[float, float]] = None,
    direction: Optional[tuple[float, float]] = None,
    fontbuffer: Optional[bytes] = None,
) -> tuple[bool, Optional[str], Optional[BBox]]:
    """Insert text. Prefer insert_text at original baseline; expand width if needed.

    Returns (ok, warning, drawn_bbox). Never shrinks fontsize.
    Preserves rotation via morph when ``direction`` is non-horizontal.
    """
    if origin is None:
        # PyMuPDF origin ≈ (x0, baseline). Approximate baseline near bottom of bbox.
        origin = (bbox.x0, bbox.y1 - fontsize * 0.15)

    morph = _morph_for_dir(origin, direction)
    rotated = morph is not None
    box_w = max(bbox.width(), 1.0)
    box_h = max(bbox.height(), fontsize * 1.2)
    text_w = _approx_text_width(text, fontname, fontsize, fontbuffer)
    has_newline = "\n" in text
    draw_w, clipped_by_page = _expanded_draw_width(page, bbox, text_w)
    drawn = BBox(x0=bbox.x0, y0=bbox.y0, x1=bbox.x0 + draw_w, y1=bbox.y1)
    fits_single_line = (not has_newline) and (text_w <= draw_w * 1.02)

    # Single-line path: original width or expanded-to-fit width.
    if fits_single_line:
        try:
            kwargs: dict = dict(
                fontname=fontname,
                fontsize=fontsize,
                color=color,
                render_mode=0,
            )
            if morph is not None:
                kwargs["morph"] = morph
            rc = page.insert_text(origin, text, **kwargs)
            if isinstance(rc, int) and rc >= 1:
                warn = None
                if clipped_by_page and text_w > box_w * 1.02:
                    warn = (
                        "Text is wider than the available page space and may be clipped"
                    )
                return True, warn, drawn
        except Exception as exc:  # noqa: BLE001
            logger.debug("insert_text failed: %s", exc)

    if rotated:
        # Cannot wrap rotated text reliably — insert single morph line + warn if too wide.
        try:
            page.insert_text(
                origin,
                text,
                fontname=fontname,
                fontsize=fontsize,
                color=color,
                morph=morph,
            )
            warn = (
                "Rotated text re-inserted via morph; multi-line wrap is not supported "
                "for rotated spans"
            )
            if not fits_single_line:
                warn = "Text overflow: " + warn
            return True, warn, drawn
        except Exception as exc:  # noqa: BLE001
            return False, f"rotated insert failed: {exc}", None

    # Explicit multi-line (or single-line insert failed): use textbox.
    # Prefer expanded width so we don't wrap just because the original span was short.
    rect = fitz.Rect(bbox.x0, bbox.y0, bbox.x0 + draw_w, bbox.y0 + box_h)
    try:
        rc = page.insert_textbox(
            rect,
            text,
            fontname=fontname,
            fontsize=fontsize,
            color=color,
            align=fitz.TEXT_ALIGN_LEFT,
        )
        if isinstance(rc, (int, float)) and rc >= 0:
            return True, None, drawn

        # Still doesn't fit height — allow taller box within expanded width.
        tall = fitz.Rect(bbox.x0, bbox.y0, bbox.x0 + draw_w, bbox.y0 + fontsize * 40)
        page.insert_textbox(
            tall,
            text,
            fontname=fontname,
            fontsize=fontsize,
            color=color,
            align=fitz.TEXT_ALIGN_LEFT,
        )
        drawn_tall = BBox(
            x0=bbox.x0,
            y0=bbox.y0,
            x1=bbox.x0 + draw_w,
            y1=bbox.y0 + fontsize * 40,
        )
        return True, (
            "Text overflow: content does not fit original box height "
            "at locked font size"
        ), drawn_tall
    except Exception as exc:  # noqa: BLE001
        return False, f"insert failed: {exc}", None


def _redact_span(page: fitz.Page, bbox: Iterable[float]) -> None:
    """Mark a span for removal. fill=False → no white cover rectangle."""
    rect = fitz.Rect(bbox)
    # Slightly inflate to catch anti-aliased ink without eating neighbors aggressively.
    # Keep inflation tiny — overlapping neighbors are a known fidelity risk.
    rect = rect + (-0.3, -0.3, 0.3, 0.3)
    page.add_redact_annot(rect, fill=False, cross_out=False)


def _apply_redactions(page: fitz.Page) -> None:
    page.apply_redactions(
        images=fitz.PDF_REDACT_IMAGE_NONE,
        graphics=fitz.PDF_REDACT_LINE_ART_NONE,
        text=fitz.PDF_REDACT_TEXT_REMOVE,
    )


def apply_ops(source: Source, ops: list[EditOp]) -> OpsResult:
    """Apply ops in order and return resulting PDF bytes + warnings."""
    ensure_bundled_fonts()
    warnings: list[str] = []
    applied: list[str] = []
    skipped: list[str] = []
    op_metrics: list[OpMetrics] = []

    if not ops:
        # Zero-ops path: return an exact byte copy of the source PDF content stream.
        if isinstance(source, (str, Path)):
            return OpsResult(pdf_bytes=Path(source).read_bytes())
        return OpsResult(pdf_bytes=source)

    doc = _open_copy(source)
    try:
        if doc.is_encrypted and not doc.authenticate(""):
            doc.close()
            raise PermissionError("PDF is encrypted and cannot be opened without a password")

        # Group ops by page for efficient redaction batches.
        # Strategy per page:
        #   1. Resolve all span targets against CURRENT page layout
        #   2. Collect redactions for delete/replace/move (source removal)
        #   3. apply_redactions once
        #   4. insert new text for replace/move/duplicate/add

        by_page: dict[int, list[EditOp]] = {}
        for op in ops:
            by_page.setdefault(op.page, []).append(op)

        for page_index, page_ops in by_page.items():
            if page_index < 0 or page_index >= doc.page_count:
                for op in page_ops:
                    skipped.append(op.id)
                    warnings.append(f"Op {op.id}: page {page_index} out of range")
                continue

            page = doc[page_index]
            layout = extract_page_layout(page)
            if not layout["has_text"] and any(
                op.type != OpType.ADD_TEXT for op in page_ops
            ):
                warnings.append(
                    f"Page {page_index}: no text layer detected (scanned PDF?). "
                    "Text edit ops skipped."
                )
                for op in page_ops:
                    if op.type != OpType.ADD_TEXT:
                        skipped.append(op.id)

            # Resolve targets up-front (layout changes after redaction)
            resolved: list[tuple[EditOp, Optional[dict]]] = []
            for op in page_ops:
                if op.type == OpType.ADD_TEXT:
                    resolved.append((op, None))
                    continue
                bbox = op.bbox.as_rect() if op.bbox else None
                span = find_span(
                    page,
                    span_id=op.span_id,
                    bbox=bbox,
                    text=op.original_text,
                )
                if span is None and op.type != OpType.ADD_TEXT:
                    skipped.append(op.id)
                    warnings.append(f"Op {op.id}: target span not found")
                    continue
                resolved.append((op, span))

            # Pass 1: redactions for ops that remove original text
            need_redact = False
            for op, span in resolved:
                if op.id in skipped:
                    continue
                if op.type in (OpType.REPLACE_TEXT, OpType.MOVE, OpType.DELETE) and span:
                    _redact_span(page, span["bbox"])
                    need_redact = True
                elif op.type == OpType.DUPLICATE:
                    # duplicate keeps original; no redaction
                    pass

            if need_redact:
                _apply_redactions(page)

            # Pass 2: insert new text
            for op, span in resolved:
                if op.id in skipped:
                    continue

                if op.type == OpType.DELETE:
                    applied.append(op.id)
                    continue

                # Typography from span (locked) or from op payload
                direction: Optional[tuple[float, float]] = None
                if span:
                    font = op.font or span["font"]
                    size = op.size or span["size"]
                    color = _color_rgb(op.color or tuple(span["color"]))  # type: ignore[arg-type]
                    origin = tuple(span.get("origin") or [span["bbox"][0], span["bbox"][3]])
                    d = span.get("dir") or (1.0, 0.0)
                    direction = (float(d[0]), float(d[1]))
                    src_bbox = BBox(
                        x0=span["bbox"][0],
                        y0=span["bbox"][1],
                        x1=span["bbox"][2],
                        y1=span["bbox"][3],
                    )
                else:
                    font = op.font or "helv"
                    size = op.size or 12.0
                    color = _color_rgb(op.color)
                    origin = None
                    if op.bbox:
                        src_bbox = op.bbox
                    elif op.new_bbox:
                        src_bbox = op.new_bbox
                    else:
                        skipped.append(op.id)
                        warnings.append(f"Op {op.id}: missing bbox for add_text")
                        continue

                # Destination bbox
                if op.type == OpType.MOVE and op.new_bbox:
                    dest = op.new_bbox
                    # Keep origin relative offset when moving
                    if span and origin:
                        dx = dest.x0 - src_bbox.x0
                        dy = dest.y0 - src_bbox.y0
                        origin = (origin[0] + dx, origin[1] + dy)
                elif op.type == OpType.DUPLICATE and op.new_bbox:
                    dest = op.new_bbox
                    text = op.text if op.text is not None else (span["text"] if span else "")
                    if span and origin:
                        dx = dest.x0 - src_bbox.x0
                        dy = dest.y0 - src_bbox.y0
                        origin = (origin[0] + dx, origin[1] + dy)
                elif op.type == OpType.ADD_TEXT:
                    dest = op.new_bbox or op.bbox or src_bbox
                    text = op.text or ""
                    origin = (dest.x0, dest.y1 - size * 0.15)
                else:
                    # replace_text: same location
                    dest = src_bbox
                    text = op.text if op.text is not None else (span["text"] if span else "")

                if op.type == OpType.REPLACE_TEXT:
                    text = op.text if op.text is not None else ""
                elif op.type == OpType.MOVE:
                    text = span["text"] if span else (op.text or "")
                elif op.type == OpType.DUPLICATE:
                    text = op.text if op.text is not None else (span["text"] if span else "")

                fres = resolve_font(doc, page, font)
                metrics = OpMetrics(op_id=op.id, font_source=fres.source)
                if fres.warning:
                    warnings.append(f"Op {op.id}: {fres.warning}")
                    metrics.notes.append(fres.warning)

                # Count glyphs that forced a non-embedded fallback (subset miss or bundled).
                miss = missing_glyphs(fres.buffer, text) if fres.buffer else []
                if miss:
                    metrics.fallback_glyphs = miss
                    metrics.fallback_glyph_count = len(miss)
                elif fres.source == "bundled":
                    # Whole run substituted — count non-space chars.
                    metrics.fallback_glyphs = [c for c in text if not c.isspace()]
                    metrics.fallback_glyph_count = len(metrics.fallback_glyphs)
                # base14 alias of Times/Arial/etc. is not counted as a fallback.

                if fres.buffer and miss:
                    bundled = find_bundled_font()
                    if bundled:
                        fres.buffer = bundled.read_bytes()
                        fres.fontname = f"fb_glyph"
                        fres.source = "bundled"
                        metrics.font_source = "bundled"
                        msg = (
                            f"Op {op.id}: subset font missing {len(miss)} glyph(s) "
                            f"{miss!r}; using bundled {bundled.name}"
                        )
                        warnings.append(msg)
                        metrics.notes.append(msg)
                    else:
                        msg = (
                            f"Op {op.id}: subset font missing {len(miss)} glyph(s); "
                            "no bundled fallback found"
                        )
                        warnings.append(msg)
                        metrics.notes.append(msg)

                registered = _register_font(page, fres.fontname, fres.buffer)
                ok, warn, drawn = _insert_span_text(
                    page,
                    text=text,
                    bbox=dest,
                    fontname=registered,
                    fontsize=float(size),
                    color=color,
                    origin=origin,  # type: ignore[arg-type]
                    direction=direction,
                    fontbuffer=fres.buffer,
                )
                if drawn is not None:
                    metrics.drawn_bbox = (
                        drawn.x0,
                        drawn.y0,
                        drawn.x1,
                        drawn.y1,
                    )
                if warn:
                    warnings.append(f"Op {op.id}: {warn}")
                    metrics.notes.append(warn)
                    low = warn.lower()
                    if "overflow" in low:
                        metrics.overflow = True
                    if "clip" in low or "rotated text" in low:
                        metrics.clipped = True
                if ok:
                    applied.append(op.id)
                else:
                    skipped.append(op.id)
                    warnings.append(f"Op {op.id}: text insertion failed")
                op_metrics.append(metrics)

        # Prefer incremental-ish save with garbage to drop orphaned content streams
        buf = io.BytesIO()
        doc.save(buf, garbage=3, deflate=True, clean=True)
        return OpsResult(
            pdf_bytes=buf.getvalue(),
            warnings=warnings,
            applied=applied,
            skipped=skipped,
            op_metrics=op_metrics,
        )
    finally:
        doc.close()
