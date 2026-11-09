#!/usr/bin/env python3
"""Generate 8–10 tricky sample PDFs for Phase 0 fidelity spike."""

from __future__ import annotations

import sys
from pathlib import Path

import fitz

BACKEND = Path(__file__).resolve().parents[1]
OUT = BACKEND / "data" / "samples"
sys.path.insert(0, str(BACKEND))

from app.ops.fonts import ensure_bundled_fonts, find_bundled_font  # noqa: E402


def _fontfile() -> str | None:
    ensure_bundled_fonts()
    p = find_bundled_font("sans")
    return str(p) if p else None


def _insert(page: fitz.Page, point, text, *, fontsize=12, color=(0, 0, 0), fontfile=None, fontname="helv"):
    kwargs = dict(fontsize=fontsize, color=color)
    if fontfile:
        page.insert_font(fontname="sample", fontfile=fontfile)
        kwargs["fontname"] = "sample"
    else:
        kwargs["fontname"] = fontname
    page.insert_text(point, text, **kwargs)


def make_simple_text(path: Path, fontfile: str | None) -> None:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    _insert(page, (72, 72), "Hello World", fontsize=18, fontfile=fontfile)
    _insert(page, (72, 110), "A short second line.", fontsize=12, fontfile=fontfile)
    _insert(page, (72, 140), "Editable paragraph for replace/move/duplicate tests.", fontsize=12, fontfile=fontfile)
    doc.save(path)
    doc.close()


def make_colored_background(path: Path, fontfile: str | None) -> None:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    # Solid colored background (not white) — white-box redaction would be visible
    shape = page.new_shape()
    shape.draw_rect(page.rect)
    shape.finish(color=(0.15, 0.25, 0.45), fill=(0.15, 0.25, 0.45))
    shape.commit()
    _insert(page, (72, 100), "White text on navy", fontsize=20, color=(1, 1, 1), fontfile=fontfile)
    _insert(page, (72, 140), "Second navy line", fontsize=14, color=(0.9, 0.95, 1), fontfile=fontfile)
    # Accent band
    shape = page.new_shape()
    shape.draw_rect(fitz.Rect(0, 200, 612, 280))
    shape.finish(color=(0.85, 0.35, 0.2), fill=(0.85, 0.35, 0.2))
    shape.commit()
    _insert(page, (72, 240), "Text on coral band", fontsize=16, color=(1, 1, 1), fontfile=fontfile)
    doc.save(path)
    doc.close()


def make_text_over_image(path: Path, fontfile: str | None) -> None:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    # Procedural PNG via pixmap
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 400, 200), 1)
    # Fill with a gradient-ish pattern
    samples = bytearray()
    for y in range(200):
        for x in range(400):
            samples.extend([int(x * 255 / 400), int(y * 255 / 200), 120, 255])
    pix = fitz.Pixmap(fitz.csRGB, 400, 200, bytes(samples), True)
    page.insert_image(fitz.Rect(72, 72, 472, 272), pixmap=pix)
    _insert(page, (90, 150), "Caption over photo", fontsize=22, color=(1, 1, 0), fontfile=fontfile)
    _insert(page, (90, 190), "Must not punch a hole in the image", fontsize=12, color=(1, 1, 1), fontfile=fontfile)
    _insert(page, (72, 320), "Body text below image stays pristine.", fontsize=12, fontfile=fontfile)
    doc.save(path)
    doc.close()


def make_vector_graphics(path: Path, fontfile: str | None) -> None:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    shape = page.new_shape()
    shape.draw_circle((200, 200), 80)
    shape.finish(color=(0.2, 0.5, 0.8), fill=(0.7, 0.85, 1.0), width=2)
    shape.draw_line((50, 50), (400, 350))
    shape.finish(color=(0.8, 0.1, 0.1), width=3)
    shape.draw_rect(fitz.Rect(350, 80, 520, 200))
    shape.finish(color=(0.1, 0.6, 0.3), fill=None, width=2)
    shape.commit()
    _insert(page, (160, 200), "Inside circle", fontsize=14, fontfile=fontfile)
    _insert(page, (360, 140), "Near box", fontsize=12, fontfile=fontfile)
    _insert(page, (72, 400), "Graphics must survive text redaction.", fontsize=12, fontfile=fontfile)
    doc.save(path)
    doc.close()


def make_multicolumn(path: Path, fontfile: str | None) -> None:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    left = [
        "Column A title",
        "Alpha paragraph one sits here.",
        "Alpha paragraph two continues.",
        "Alpha paragraph three ends.",
    ]
    right = [
        "Column B title",
        "Bravo paragraph one sits here.",
        "Bravo paragraph two continues.",
        "Bravo paragraph three ends.",
    ]
    y = 72
    for t in left:
        _insert(page, (54, y), t, fontsize=11, fontfile=fontfile)
        y += 22
    y = 72
    for t in right:
        _insert(page, (330, y), t, fontsize=11, fontfile=fontfile)
        y += 22
    doc.save(path)
    doc.close()


def make_rotated_page(path: Path, fontfile: str | None) -> None:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    _insert(page, (72, 100), "Upright text before rotate flag", fontsize=14, fontfile=fontfile)
    _insert(page, (72, 140), "Target span for edit", fontsize=14, fontfile=fontfile)
    page.set_rotation(90)
    doc.save(path)
    doc.close()


def make_rotated_text(path: Path, fontfile: str | None) -> None:
    """Text drawn with a rotate morph (not page rotation)."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    _insert(page, (72, 72), "Normal horizontal text", fontsize=14, fontfile=fontfile)
    # Morph rotate around a point
    morph = (fitz.Point(200, 400), fitz.Matrix(45))
    if fontfile:
        page.insert_font(fontname="sample", fontfile=fontfile)
        fname = "sample"
    else:
        fname = "helv"
    page.insert_text(
        (200, 400),
        "Diagonal caption",
        fontname=fname,
        fontsize=16,
        color=(0.1, 0.1, 0.5),
        morph=morph,
    )
    _insert(page, (72, 500), "Footer stays horizontal", fontsize=12, fontfile=fontfile)
    doc.save(path)
    doc.close()


def make_multipage(path: Path, fontfile: str | None) -> None:
    doc = fitz.open()
    for i in range(5):
        page = doc.new_page(width=612, height=792)
        _insert(page, (72, 72), f"Page {i + 1} of 5", fontsize=18, fontfile=fontfile)
        _insert(page, (72, 110), f"Editable line on page {i + 1}", fontsize=12, fontfile=fontfile)
        _insert(page, (72, 140), "Shared boilerplate across pages.", fontsize=12, fontfile=fontfile)
    doc.save(path)
    doc.close()


def make_subset_font_risk(path: Path, fontfile: str | None) -> None:
    """PDF with limited character set — replacing with new glyphs should warn."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    # Only the letters in this sentence are likely embedded if subsetting occurs
    _insert(page, (72, 100), "abc", fontsize=24, fontfile=fontfile)
    _insert(page, (72, 150), "Only three glyphs embedded risk", fontsize=12, fontfile=fontfile)
    doc.save(path)
    # Re-open and subset isn't automatic with insert_text from TTF — still useful as baseline
    doc.close()


def make_tight_lines(path: Path, fontfile: str | None) -> None:
    """Narrow line spacing — redaction inflation can eat neighbors."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    y = 100
    for i in range(8):
        _insert(page, (72, y), f"Tight line number {i}: pack them close.", fontsize=11, fontfile=fontfile)
        y += 13  # tighter than typical leading
    doc.save(path)
    doc.close()


def make_scanned_no_text(path: Path) -> None:
    """Image-only page simulating a scan (no text layer)."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    pix = fitz.Pixmap(fitz.csRGB, 500, 700, bytes([230, 230, 230] * 500 * 700), False)
    page.insert_image(page.rect, pixmap=pix)
    # Draw fake "text" as vectors so it looks like a page but has no text layer
    shape = page.new_shape()
    for i in range(10):
        y = 100 + i * 40
        shape.draw_rect(fitz.Rect(80, y, 500, y + 8))
        shape.finish(color=(0.2, 0.2, 0.2), fill=(0.2, 0.2, 0.2))
    shape.commit()
    doc.save(path)
    doc.close()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    fontfile = _fontfile()
    print(f"Using fontfile: {fontfile}")

    makers = [
        ("01_simple_text.pdf", lambda p: make_simple_text(p, fontfile)),
        ("02_colored_background.pdf", lambda p: make_colored_background(p, fontfile)),
        ("03_text_over_image.pdf", lambda p: make_text_over_image(p, fontfile)),
        ("04_vector_graphics.pdf", lambda p: make_vector_graphics(p, fontfile)),
        ("05_multicolumn.pdf", lambda p: make_multicolumn(p, fontfile)),
        ("06_rotated_page.pdf", lambda p: make_rotated_page(p, fontfile)),
        ("07_rotated_text.pdf", lambda p: make_rotated_text(p, fontfile)),
        ("08_multipage.pdf", lambda p: make_multipage(p, fontfile)),
        ("09_subset_font_risk.pdf", lambda p: make_subset_font_risk(p, fontfile)),
        ("10_tight_lines.pdf", lambda p: make_tight_lines(p, fontfile)),
        ("11_scanned_no_text.pdf", lambda p: make_scanned_no_text(p)),
    ]
    for name, fn in makers:
        path = OUT / name
        fn(path)
        print(f"  wrote {path.relative_to(BACKEND)}")
    print(f"Done — {len(makers)} samples in {OUT}")


if __name__ == "__main__":
    main()
