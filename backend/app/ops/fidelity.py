"""Fidelity measurement helpers for spike + pytest."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Union

import fitz
import numpy as np
from PIL import Image

from .layout import page_image_xrefs

Source = Union[str, Path, bytes]


@dataclass
class PixelDiffResult:
    page: int
    dpi: int
    max_diff: int
    mean_diff: float
    changed_pixels: int
    total_pixels: int
    outside_bbox_changed: int
    outside_bbox_max_diff: int


def _open(source: Source) -> fitz.Document:
    if isinstance(source, (str, Path)):
        return fitz.open(source)
    return fitz.open(stream=source, filetype="pdf")


def render_page(doc: fitz.Document, page_index: int, dpi: int = 150) -> np.ndarray:
    page = doc[page_index]
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    return arr.copy()


def pixel_diff(
    a: Source,
    b: Source,
    *,
    page: int = 0,
    dpi: int = 150,
    ignore_bbox: Optional[tuple[float, float, float, float]] = None,
) -> PixelDiffResult:
    """Compare two PDFs page renders. ignore_bbox is in PDF points (72 dpi space)."""
    da, db = _open(a), _open(b)
    try:
        ra = render_page(da, page, dpi)
        rb = render_page(db, page, dpi)
        # Align shapes (pad with white if needed)
        h = max(ra.shape[0], rb.shape[0])
        w = max(ra.shape[1], rb.shape[1])

        def pad(img: np.ndarray) -> np.ndarray:
            out = np.full((h, w, 3), 255, dtype=np.uint8)
            out[: img.shape[0], : img.shape[1]] = img
            return out

        ra, rb = pad(ra), pad(rb)
        diff = np.abs(ra.astype(np.int16) - rb.astype(np.int16)).max(axis=2)
        changed = int((diff > 0).sum())
        total = int(diff.size)

        outside_changed = changed
        outside_max = int(diff.max()) if diff.size else 0
        if ignore_bbox is not None:
            scale = dpi / 72.0
            x0, y0, x1, y1 = ignore_bbox
            # Text bboxes from get_text are in unrotated space; pixmap is visual
            # (post-rotation). Map ignore region into render space when needed.
            page_a = da[page]
            if page_a.rotation:
                r = fitz.Rect(x0, y0, x1, y1) * page_a.rotation_matrix
                x0, y0, x1, y1 = r.x0, r.y0, r.x1, r.y1
            ix0 = max(0, int(min(x0, x1) * scale) - 2)
            iy0 = max(0, int(min(y0, y1) * scale) - 2)
            ix1 = min(w, int(max(x0, x1) * scale) + 2)
            iy1 = min(h, int(max(y0, y1) * scale) + 2)
            mask = np.ones_like(diff, dtype=bool)
            mask[iy0:iy1, ix0:ix1] = False
            outside = diff[mask]
            outside_changed = int((outside > 0).sum()) if outside.size else 0
            outside_max = int(outside.max()) if outside.size else 0

        return PixelDiffResult(
            page=page,
            dpi=dpi,
            max_diff=int(diff.max()) if diff.size else 0,
            mean_diff=float(diff.mean()) if diff.size else 0.0,
            changed_pixels=changed,
            total_pixels=total,
            outside_bbox_changed=outside_changed,
            outside_bbox_max_diff=outside_max,
        )
    finally:
        da.close()
        db.close()


def image_xref_hashes(source: Source, page: int = 0) -> dict[int, str]:
    """Map xref -> sha256. Prefer image_content_hashes() for fidelity checks —
    garbage collection renumbers xrefs even when bytes are identical."""
    doc = _open(source)
    try:
        imgs = page_image_xrefs(doc, doc[page])
        return {xref: hashlib.sha256(data).hexdigest() for xref, data in imgs.items()}
    finally:
        doc.close()


def image_content_hashes(source: Source, page: int = 0) -> set[str]:
    """Set of image content hashes on a page (xref-independent)."""
    return set(image_xref_hashes(source, page).values())


def save_diff_preview(
    a: Source,
    b: Source,
    out_path: Path,
    *,
    page: int = 0,
    dpi: int = 100,
) -> Path:
    """Write a side-by-side + difference heat preview PNG."""
    da, db = _open(a), _open(b)
    try:
        ra = render_page(da, page, dpi)
        rb = render_page(db, page, dpi)
        h = max(ra.shape[0], rb.shape[0])
        w = max(ra.shape[1], rb.shape[1])

        def pad(img: np.ndarray) -> np.ndarray:
            out = np.full((h, w, 3), 255, dtype=np.uint8)
            out[: img.shape[0], : img.shape[1]] = img
            return out

        ra, rb = pad(ra), pad(rb)
        diff = np.abs(ra.astype(np.int16) - rb.astype(np.int16)).max(axis=2)
        heat = np.zeros_like(ra)
        heat[..., 0] = np.clip(diff * 8, 0, 255).astype(np.uint8)
        heat[..., 1] = np.clip(diff * 2, 0, 255).astype(np.uint8)
        canvas = np.concatenate([ra, rb, heat], axis=1)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(canvas).save(out_path)
        return out_path
    finally:
        da.close()
        db.close()
