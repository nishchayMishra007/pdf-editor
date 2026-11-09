"""Fidelity tests from the product spec.

a) Export with zero ops equals the original (pixel diff = 0).
b) After an edit, pixel diff outside the edited bbox = 0 at 150 DPI.
c) Image xref hashes are identical before and after export.
"""

from __future__ import annotations

from pathlib import Path

import fitz

from app.ops.engine import apply_ops
from app.ops.fidelity import image_content_hashes, pixel_diff
from app.ops.layout import extract_page_layout
from app.ops.models import BBox, EditOp, OpType


def test_a_zero_ops_pixel_and_bytes(sample_simple: Path):
    original = sample_simple.read_bytes()
    result = apply_ops(sample_simple, [])
    assert result.pdf_bytes == original
    diff = pixel_diff(sample_simple, result.pdf_bytes, page=0, dpi=150)
    assert diff.max_diff == 0
    assert diff.changed_pixels == 0


def test_b_outside_bbox_unchanged_after_replace(sample_simple: Path):
    doc = fitz.open(sample_simple)
    layout = extract_page_layout(doc[0])
    doc.close()
    span = layout["blocks"][0]["lines"][0]["spans"][0]
    bbox = span["bbox"]
    src = span["text"]
    new_text = ("Z" + src[1:]) if len(src) > 1 else "Z"

    op = EditOp(
        id="r1",
        type=OpType.REPLACE_TEXT,
        page=0,
        span_id=span["id"],
        bbox=BBox(x0=bbox[0], y0=bbox[1], x1=bbox[2], y1=bbox[3]),
        text=new_text,
        original_text=src,
        font=span["font"],
        size=span["size"],
        color=tuple(span["color"]),
    )
    result = apply_ops(sample_simple, [op])
    assert op.id in result.applied

    # Pad ignore region slightly for AA / metric fringe
    pad = 8
    ignore = (bbox[0] - pad, bbox[1] - pad, bbox[2] + pad + 12, bbox[3] + pad * 3)
    diff = pixel_diff(
        sample_simple, result.pdf_bytes, page=0, dpi=150, ignore_bbox=ignore
    )
    assert diff.outside_bbox_max_diff == 0, diff
    assert diff.outside_bbox_changed == 0, diff


def test_c_image_content_hashes_unchanged(sample_image: Path):
    doc = fitz.open(sample_image)
    layout = extract_page_layout(doc[0])
    doc.close()
    span = None
    for block in layout["blocks"]:
        for line in block["lines"]:
            for s in line["spans"]:
                if s["text"].strip():
                    span = s
                    break
            if span:
                break
        if span:
            break
    assert span is not None

    before = image_content_hashes(sample_image, 0)
    assert before, "sample must contain images"

    bbox = span["bbox"]
    src = span["text"]
    new_text = ("Z" + src[1:]) if len(src) > 1 else "Z"
    op = EditOp(
        id="r1",
        type=OpType.REPLACE_TEXT,
        page=0,
        span_id=span["id"],
        bbox=BBox(x0=bbox[0], y0=bbox[1], x1=bbox[2], y1=bbox[3]),
        text=new_text,
        original_text=src,
        font=span["font"],
        size=span["size"],
        color=tuple(span["color"]),
    )
    result = apply_ops(sample_image, [op])
    after = image_content_hashes(result.pdf_bytes, 0)
    assert before == after
