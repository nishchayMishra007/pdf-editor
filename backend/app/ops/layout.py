"""Text layout extraction from PDF pages."""

from __future__ import annotations

from typing import Any, Optional

import fitz


def srgb_tuple(color_int: int) -> tuple[float, float, float]:
    """Convert PyMuPDF integer color to 0..1 RGB."""
    r = ((color_int >> 16) & 255) / 255.0
    g = ((color_int >> 8) & 255) / 255.0
    b = (color_int & 255) / 255.0
    return (r, g, b)


def extract_page_layout(page: fitz.Page) -> dict[str, Any]:
    """Return structured text blocks with stable span ids."""
    page_dict = page.get_text("dict", flags=fitz.TEXTFLAGS_TEXT)
    blocks_out: list[dict[str, Any]] = []
    for bi, block in enumerate(page_dict.get("blocks", [])):
        if block.get("type") != 0:
            continue
        lines_out: list[dict[str, Any]] = []
        for li, line in enumerate(block.get("lines", [])):
            spans_out: list[dict[str, Any]] = []
            for si, span in enumerate(line.get("spans", [])):
                span_id = f"{page.number}:{bi}:{li}:{si}"
                color = span.get("color", 0)
                if isinstance(color, int):
                    rgb = srgb_tuple(color)
                else:
                    rgb = tuple(color)  # type: ignore[assignment]
                spans_out.append(
                    {
                        "id": span_id,
                        "bbox": list(span["bbox"]),
                        "text": span.get("text", ""),
                        "font": span.get("font", ""),
                        "size": float(span.get("size", 12)),
                        "color": rgb,
                        "flags": span.get("flags", 0),
                        "origin": list(span.get("origin", [span["bbox"][0], span["bbox"][3]])),
                        "dir": list(line.get("dir", (1, 0))),
                        "ascender": span.get("ascender"),
                        "descender": span.get("descender"),
                    }
                )
            if spans_out:
                lines_out.append(
                    {
                        "bbox": list(line["bbox"]),
                        "dir": list(line.get("dir", (1, 0))),
                        "wmode": line.get("wmode", 0),
                        "spans": spans_out,
                    }
                )
        if lines_out:
            blocks_out.append(
                {
                    "id": f"{page.number}:{bi}",
                    "bbox": list(block["bbox"]),
                    "lines": lines_out,
                }
            )
    return {
        "page": page.number,
        "width": page.rect.width,
        "height": page.rect.height,
        "rotation": page.rotation,
        "blocks": blocks_out,
        "has_text": bool(blocks_out),
    }


def find_span(
    page: fitz.Page,
    *,
    span_id: Optional[str] = None,
    bbox: Optional[tuple[float, float, float, float]] = None,
    text: Optional[str] = None,
    tol: float = 1.5,
) -> Optional[dict[str, Any]]:
    layout = extract_page_layout(page)
    if span_id:
        for block in layout["blocks"]:
            for line in block["lines"]:
                for span in line["spans"]:
                    if span["id"] == span_id:
                        return span
    candidates: list[dict[str, Any]] = []
    for block in layout["blocks"]:
        for line in block["lines"]:
            for span in line["spans"]:
                if bbox is not None:
                    sb = span["bbox"]
                    if (
                        abs(sb[0] - bbox[0]) <= tol
                        and abs(sb[1] - bbox[1]) <= tol
                        and abs(sb[2] - bbox[2]) <= tol
                        and abs(sb[3] - bbox[3]) <= tol
                    ):
                        if text is None or span["text"] == text:
                            candidates.append(span)
                elif text is not None and span["text"] == text:
                    candidates.append(span)
    if not candidates:
        return None
    # Prefer exact text match if multiple
    if text is not None:
        exact = [c for c in candidates if c["text"] == text]
        if exact:
            return exact[0]
    return candidates[0]


def page_image_xrefs(doc: fitz.Document, page: fitz.Page) -> dict[int, bytes]:
    """Map image xref -> raw image bytes (for fidelity hashing)."""
    out: dict[int, bytes] = {}
    for img in page.get_images(full=True):
        xref = img[0]
        try:
            out[xref] = doc.extract_image(xref)["image"]
        except Exception:  # noqa: BLE001
            continue
    return out
