#!/usr/bin/env python3
"""Fidelity spike — synthetic samples or a folder of real PDFs.

Usage:
  python backend/scripts/spike.py
  python backend/scripts/spike.py backend/data/samples_real

Per PDF reports:
  - zero-ops identity (exact bytes)
  - outside_bbox_max_diff for replace/move/duplicate
  - fallback-font glyph counts per edit
  - clipped / overflow warnings
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from dataclasses import asdict, dataclass, field
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import fitz  # noqa: E402

from app.ops.engine import apply_ops  # noqa: E402
from app.ops.fidelity import image_content_hashes, pixel_diff, save_diff_preview  # noqa: E402
from app.ops.layout import extract_page_layout  # noqa: E402
from app.ops.models import BBox, EditOp, OpType  # noqa: E402

DEFAULT_SAMPLES = BACKEND / "data" / "samples"
DEFAULT_OUT = BACKEND / "data" / "spike_out"
DPI = 150

OUTSIDE_MAX_DIFF_SOFT = 0
OUTSIDE_MAX_DIFF_HARD = 8
OUTSIDE_CHANGED_RATIO_HARD = 0.002


@dataclass
class CaseResult:
    sample: str
    case: str
    ok: bool
    hard_fail: bool = False
    notes: list[str] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)


@dataclass
class PdfSummary:
    sample: str
    zero_ops_identity: bool
    outside_bbox_max_diff: dict[str, int] = field(default_factory=dict)
    fallback_glyph_counts: dict[str, int] = field(default_factory=dict)
    overflow_or_clipped: list[str] = field(default_factory=list)
    hard_fails: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def first_span(pdf_path: Path, page: int = 0):
    doc = fitz.open(pdf_path)
    try:
        if doc.is_encrypted and not doc.authenticate(""):
            return None, {"has_text": False, "encrypted": True, "blocks": []}
        if page >= doc.page_count:
            page = 0
        layout = extract_page_layout(doc[page])
        for block in layout["blocks"]:
            for line in block["lines"]:
                for span in line["spans"]:
                    if span["text"].strip():
                        return span, layout
        return None, layout
    finally:
        doc.close()


def union_bbox(*boxes: list[float]) -> tuple[float, float, float, float]:
    xs0, ys0, xs1, ys1 = [], [], [], []
    for b in boxes:
        xs0.append(b[0])
        ys0.append(b[1])
        xs1.append(b[2])
        ys1.append(b[3])
    return (min(xs0), min(ys0), max(xs1), max(ys1))


def _metrics_from_ops(result) -> dict:
    fallback = 0
    glyphs: list[str] = []
    overflow = False
    clipped = False
    for m in result.op_metrics:
        fallback += m.fallback_glyph_count
        glyphs.extend(m.fallback_glyphs)
        overflow = overflow or m.overflow
        clipped = clipped or m.clipped
    return {
        "fallback_glyph_count": fallback,
        "fallback_glyphs": glyphs[:40],
        "overflow": overflow,
        "clipped": clipped,
        "font_sources": [m.font_source for m in result.op_metrics],
    }


def evaluate_edit(
    sample: Path,
    case: str,
    ops: list[EditOp],
    ignore_bboxes: list[list[float]],
    out_dir: Path,
    *,
    expect_scanned_skip: bool = False,
) -> CaseResult:
    notes: list[str] = []
    result = apply_ops(sample, ops)
    notes.extend(result.warnings)
    op_meta = _metrics_from_ops(result)

    out_pdf = out_dir / sample.stem / f"{case}.pdf"
    out_pdf.parent.mkdir(parents=True, exist_ok=True)
    out_pdf.write_bytes(result.pdf_bytes)

    try:
        h0 = image_content_hashes(sample, 0)
        h1 = image_content_hashes(result.pdf_bytes, 0)
        img_ok = h0 == h1
        if not img_ok:
            notes.append(f"IMAGE CONTENT HASH MISMATCH: before={sorted(h0)} after={sorted(h1)}")
    except Exception as exc:  # noqa: BLE001
        img_ok = False
        notes.append(f"image hash error: {exc}")

    ignore = None
    if ignore_bboxes:
        ignore = union_bbox(*ignore_bboxes)
        pad = 8
        ignore = (ignore[0] - pad, ignore[1] - pad, ignore[2] + pad, ignore[3] + pad * 3)

    diff = pixel_diff(sample, result.pdf_bytes, page=0, dpi=DPI, ignore_bbox=ignore)
    save_diff_preview(sample, result.pdf_bytes, out_dir / sample.stem / f"{case}_diff.png", page=0)

    metrics = {
        "max_diff": diff.max_diff,
        "mean_diff": diff.mean_diff,
        "changed_pixels": diff.changed_pixels,
        "outside_bbox_changed": diff.outside_bbox_changed,
        "outside_bbox_max_diff": diff.outside_bbox_max_diff,
        "image_hashes_equal": img_ok,
        "applied": result.applied,
        "skipped": result.skipped,
        "ignore_bbox": ignore,
        **op_meta,
    }

    if expect_scanned_skip:
        ok = any("no text layer" in w.lower() for w in result.warnings) or not result.applied
        return CaseResult(sample.name, case, ok=ok, notes=notes, metrics=metrics)

    outside_ratio = (
        diff.outside_bbox_changed / max(diff.total_pixels, 1) if diff.total_pixels else 0.0
    )

    # Overflow probes intentionally paint below the original box; treat
    # outside-bbox pixel changes as soft findings when overflow was flagged.
    is_overflow_case = case.startswith("overflow") or bool(op_meta.get("overflow"))

    hard = False
    if not img_ok:
        hard = True
    if diff.outside_bbox_max_diff > OUTSIDE_MAX_DIFF_HARD:
        if is_overflow_case:
            notes.append(
                f"soft(overflow): outside max channel diff {diff.outside_bbox_max_diff} "
                "(expected when wrapped text extends past original height)"
            )
        else:
            hard = True
            notes.append(
                f"HARD: outside max channel diff {diff.outside_bbox_max_diff} > {OUTSIDE_MAX_DIFF_HARD}"
            )
    if outside_ratio > OUTSIDE_CHANGED_RATIO_HARD and not is_overflow_case:
        hard = True
        notes.append(
            f"HARD: outside changed ratio {outside_ratio:.4%} > {OUTSIDE_CHANGED_RATIO_HARD:.2%}"
        )

    ok = (not hard) and bool(result.applied or case == "zero_ops")
    if is_overflow_case and not op_meta.get("overflow") and not op_meta.get("clipped"):
        notes.append(
            "soft: overflow_probe did not set overflow flag — wrap may have fit expanded box"
        )
    if diff.outside_bbox_max_diff > OUTSIDE_MAX_DIFF_SOFT:
        notes.append(
            f"soft: outside max_diff={diff.outside_bbox_max_diff} "
            f"changed={diff.outside_bbox_changed}"
        )
    if op_meta["fallback_glyph_count"]:
        notes.append(
            f"fallback glyphs: {op_meta['fallback_glyph_count']} {op_meta['fallback_glyphs']!r}"
        )
    if op_meta["overflow"] or op_meta["clipped"]:
        notes.append(
            f"overflow={op_meta['overflow']} clipped={op_meta['clipped']}"
        )

    return CaseResult(
        sample=sample.name,
        case=case,
        ok=ok,
        hard_fail=hard,
        notes=notes,
        metrics=metrics,
    )


def run_zero_ops(sample: Path) -> CaseResult:
    original = sample.read_bytes()
    try:
        result = apply_ops(sample, [])
    except PermissionError as exc:
        return CaseResult(
            sample=sample.name,
            case="zero_ops",
            ok=False,
            hard_fail=True,
            notes=[str(exc)],
            metrics={"byte_equal": False, "max_diff": -1, "encrypted": True},
        )
    byte_equal = result.pdf_bytes == original
    diff = pixel_diff(sample, result.pdf_bytes, page=0, dpi=DPI)
    notes = []
    if not byte_equal:
        notes.append("zero-ops bytes differ (unexpected — engine should short-circuit)")
    ok = byte_equal and diff.max_diff == 0
    return CaseResult(
        sample=sample.name,
        case="zero_ops",
        ok=ok,
        hard_fail=not ok,
        notes=notes,
        metrics={"byte_equal": byte_equal, "max_diff": diff.max_diff},
    )


def run_sample(sample: Path, out_dir: Path) -> list[CaseResult]:
    results: list[CaseResult] = []
    results.append(run_zero_ops(sample))
    if results[0].metrics.get("encrypted"):
        return results

    span, layout = first_span(sample)
    if layout.get("encrypted"):
        results.append(
            CaseResult(
                sample=sample.name,
                case="encrypted",
                ok=False,
                hard_fail=True,
                notes=["PDF is encrypted"],
                metrics={},
            )
        )
        return results

    if span is None:
        op = EditOp(
            id="r1",
            type=OpType.REPLACE_TEXT,
            page=0,
            text="SHOULD_SKIP",
            bbox=BBox(x0=72, y0=72, x1=200, y1=90),
        )
        results.append(
            evaluate_edit(
                sample, "scanned_skip", [op], [], out_dir, expect_scanned_skip=True
            )
        )
        return results

    bbox = span["bbox"]
    bb = BBox(x0=bbox[0], y0=bbox[1], x1=bbox[2], y1=bbox[3])

    src = span["text"]
    new_text = ("Z" + src[1:]) if len(src) > 1 else "Z"
    replace_op = EditOp(
        id="replace-1",
        type=OpType.REPLACE_TEXT,
        page=0,
        span_id=span["id"],
        bbox=bb,
        text=new_text,
        original_text=span["text"],
        font=span["font"],
        size=span["size"],
        color=tuple(span["color"]),
    )
    wide = list(bbox)
    wide[2] = bbox[0] + max(bbox[2] - bbox[0], len(new_text) * span["size"] * 0.7) + 12
    results.append(evaluate_edit(sample, "replace", [replace_op], [wide], out_dir))

    # Overflow probe: deliberately too-long text at locked size
    long_text = (src[:8] or "Text") + " " + ("OVERFLOW " * 12)
    overflow_op = EditOp(
        id="overflow-1",
        type=OpType.REPLACE_TEXT,
        page=0,
        span_id=span["id"],
        bbox=bb,
        text=long_text,
        original_text=span["text"],
        font=span["font"],
        size=span["size"],
        color=tuple(span["color"]),
    )
    tall = list(bbox)
    tall[2] = bbox[0] + max(bbox[2] - bbox[0], span["size"] * 8) + 20
    tall[3] = bbox[1] + span["size"] * 40
    results.append(evaluate_edit(sample, "overflow_probe", [overflow_op], [tall], out_dir))

    dx, dy = 40.0, 60.0
    moved = bb.translated(dx, dy)
    move_op = EditOp(
        id="move-1",
        type=OpType.MOVE,
        page=0,
        span_id=span["id"],
        bbox=bb,
        new_bbox=moved,
        original_text=span["text"],
        font=span["font"],
        size=span["size"],
        color=tuple(span["color"]),
    )
    results.append(
        evaluate_edit(sample, "move", [move_op], [bbox, list(moved.as_rect())], out_dir)
    )

    dup_box = bb.translated(30.0, 90.0)
    dup_op = EditOp(
        id="dup-1",
        type=OpType.DUPLICATE,
        page=0,
        span_id=span["id"],
        bbox=bb,
        new_bbox=dup_box,
        original_text=span["text"],
        font=span["font"],
        size=span["size"],
        color=tuple(span["color"]),
    )
    results.append(
        evaluate_edit(sample, "duplicate", [dup_op], [list(dup_box.as_rect())], out_dir)
    )

    diag = None
    for block in layout["blocks"]:
        for line in block["lines"]:
            d = line.get("dir") or [1, 0]
            if abs(float(d[1])) > 0.01:
                for s in line["spans"]:
                    if s["text"].strip():
                        diag = s
                        break
            if diag:
                break
        if diag:
            break
    if diag is not None:
        db = diag["bbox"]
        dbb = BBox(x0=db[0], y0=db[1], x1=db[2], y1=db[3])
        src_d = diag["text"]
        new_diag = ("Z" + src_d[1:]) if len(src_d) > 1 else "Z"
        diag_op = EditOp(
            id="replace-diag",
            type=OpType.REPLACE_TEXT,
            page=0,
            span_id=diag["id"],
            bbox=dbb,
            text=new_diag,
            original_text=diag["text"],
            font=diag["font"],
            size=diag["size"],
            color=tuple(diag["color"]),
        )
        results.append(evaluate_edit(sample, "replace_rotated", [diag_op], [db], out_dir))

    return results


def summarize_pdf(sample_name: str, cases: list[CaseResult]) -> PdfSummary:
    summary = PdfSummary(sample=sample_name, zero_ops_identity=False)
    for c in cases:
        if c.case == "zero_ops":
            summary.zero_ops_identity = bool(c.metrics.get("byte_equal")) and c.ok
        if "outside_bbox_max_diff" in c.metrics:
            summary.outside_bbox_max_diff[c.case] = int(c.metrics["outside_bbox_max_diff"])
        if c.metrics.get("fallback_glyph_count"):
            summary.fallback_glyph_counts[c.case] = int(c.metrics["fallback_glyph_count"])
        if c.metrics.get("overflow") or c.metrics.get("clipped"):
            flags = []
            if c.metrics.get("overflow"):
                flags.append("overflow")
            if c.metrics.get("clipped"):
                flags.append("clipped")
            summary.overflow_or_clipped.append(f"{c.case}: {','.join(flags)}")
        if c.hard_fail:
            summary.hard_fails.append(c.case)
        summary.notes.extend(c.notes)
    return summary


def print_pdf_report(summary: PdfSummary) -> None:
    print(f"  ── report ──")
    print(f"  zero_ops_identity: {summary.zero_ops_identity}")
    print(f"  outside_bbox_max_diff: {summary.outside_bbox_max_diff}")
    print(f"  fallback_glyph_counts: {summary.fallback_glyph_counts or '{}'}")
    print(f"  overflow/clipped: {summary.overflow_or_clipped or 'none'}")
    if summary.hard_fails:
        print(f"  HARD FAILS: {summary.hard_fails}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="PDF fidelity spike")
    parser.add_argument(
        "folder",
        nargs="?",
        default=str(DEFAULT_SAMPLES),
        help="Folder of PDFs (default: backend/data/samples)",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="Output directory (default: backend/data/spike_out or spike_out_real)",
    )
    args = parser.parse_args(argv)

    samples_dir = Path(args.folder).expanduser().resolve()
    if args.out:
        out_dir = Path(args.out).expanduser().resolve()
    elif samples_dir.name == "samples_real":
        out_dir = BACKEND / "data" / "spike_out_real"
    else:
        out_dir = DEFAULT_OUT
    out_dir.mkdir(parents=True, exist_ok=True)

    if not samples_dir.exists():
        print(f"Folder not found: {samples_dir}")
        print("Create it and drop PDFs there, e.g. backend/data/samples_real/")
        return 2

    samples = sorted(samples_dir.glob("*.pdf"))
    if not samples:
        print(f"No PDFs in {samples_dir}")
        print("Drop .pdf files into that folder and re-run.")
        return 2

    print(f"Running spike on {len(samples)} PDFs from {samples_dir}")
    print(f"Artifacts → {out_dir}\n")

    all_results: list[CaseResult] = []
    summaries: list[PdfSummary] = []

    for sample in samples:
        print(f"=== {sample.name} ===")
        try:
            cases = run_sample(sample, out_dir)
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            cases = [
                CaseResult(
                    sample=sample.name,
                    case="CRASH",
                    ok=False,
                    hard_fail=True,
                    notes=[str(exc)],
                )
            ]
        for c in cases:
            flag = "FAIL" if c.hard_fail else ("warn" if not c.ok else "ok  ")
            print(f"  [{flag}] {c.case}: {c.metrics}")
            for n in c.notes:
                print(f"         · {n}")
        summary = summarize_pdf(sample.name, cases)
        print_pdf_report(summary)
        summaries.append(summary)
        all_results.extend(cases)
        print()

    report = {
        "folder": str(samples_dir),
        "dpi": DPI,
        "thresholds": {
            "outside_max_diff_hard": OUTSIDE_MAX_DIFF_HARD,
            "outside_changed_ratio_hard": OUTSIDE_CHANGED_RATIO_HARD,
        },
        "summaries": [asdict(s) for s in summaries],
        "results": [asdict(r) for r in all_results],
    }
    report_path = out_dir / "report.json"
    report_path.write_text(json.dumps(report, indent=2))
    print(f"Wrote {report_path}")

    hard_fails = [r for r in all_results if r.hard_fail]
    soft_fails = [r for r in all_results if (not r.ok and not r.hard_fail)]
    print(
        f"\nSummary: {len(all_results)} cases across {len(samples)} PDFs, "
        f"{len(hard_fails)} hard fails, {len(soft_fails)} soft/warn"
    )

    # Markdown findings snippet for README (real folder only)
    findings_path = out_dir / "findings.md"
    lines = ["# Spike findings\n", f"Folder: `{samples_dir}`\n"]
    for s in summaries:
        lines.append(f"## {s.sample}\n")
        lines.append(f"- zero-ops identity: **{s.zero_ops_identity}**")
        lines.append(f"- outside_bbox_max_diff: `{s.outside_bbox_max_diff}`")
        fb = s.fallback_glyph_counts or {}
        lines.append(f"- fallback_glyph_counts: `{fb}`")
        lines.append(f"- overflow/clipped: {s.overflow_or_clipped or 'none'}")
        if s.hard_fails:
            lines.append(f"- **HARD FAILS:** {s.hard_fails}")
            action = (
                "Inspect `*_diff.png` in spike_out; tighten redaction bbox or "
                "skip span if text is drawn as paths / Type3."
            )
            lines.append(f"- action: {action}")
        lines.append("")
    findings_path.write_text("\n".join(lines))
    print(f"Wrote {findings_path}")

    if hard_fails:
        print("\nHard failures:")
        for r in hard_fails:
            print(f"  - {r.sample} / {r.case}: {r.notes}")
        return 1

    print("\nSpike PASSED (no hard failures).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
