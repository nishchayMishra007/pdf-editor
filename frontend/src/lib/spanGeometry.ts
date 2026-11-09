import type { BBox, EditOp, TextSpan } from "./types";

export type VisualSpan = TextSpan & {
  deleted?: boolean;
  isDuplicate?: boolean;
  opId?: string;
  /** True when local ops changed text/pos and PDF may still be stale. */
  pending?: boolean;
};

function asTuple(b: BBox): [number, number, number, number] {
  return [b.x0, b.y0, b.x1, b.y1];
}

/** Rough PDF-point width for overlay hit-boxes before server metrics arrive. */
export function estimateTextWidthPts(
  text: string,
  font: string,
  size: number,
): number {
  if (typeof document === "undefined") {
    return Math.max(text.length * size * 0.55, size);
  }
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return Math.max(text.length * size * 0.55, size);
    // size is PDF points; canvas "pt" maps to CSS px — convert back to points.
    ctx.font = `${size}pt "${font}", Helvetica, Arial, sans-serif`;
    const px = ctx.measureText(text).width;
    return Math.max(px * (72 / 96) + 2, size);
  } catch {
    return Math.max(text.length * size * 0.55, size);
  }
}

export function allLayoutSpans(layout: {
  blocks: { lines: { spans: TextSpan[] }[] }[];
} | null): TextSpan[] {
  if (!layout) return [];
  const out: TextSpan[] = [];
  for (const b of layout.blocks) {
    for (const l of b.lines) out.push(...l.spans);
  }
  return out;
}

/** Apply page ops onto layout spans for overlay alignment with the working PDF. */
export function visualSpansForPage(
  spans: TextSpan[],
  ops: EditOp[],
  pageIndex: number,
  opts?: { pendingPreview?: boolean },
): VisualSpan[] {
  const pageOps = ops.filter((o) => o.page === pageIndex);
  const bySpan = new Map<string, EditOp[]>();
  for (const op of pageOps) {
    if (!op.span_id) continue;
    const list = bySpan.get(op.span_id) || [];
    list.push(op);
    bySpan.set(op.span_id, list);
  }

  const pendingPreview = opts?.pendingPreview ?? false;
  const out: VisualSpan[] = [];
  for (const span of spans) {
    const related = bySpan.get(span.id) || [];
    const deleted = related.some((o) => o.type === "delete");
    if (deleted) {
      out.push({ ...span, deleted: true, pending: pendingPreview });
      continue;
    }
    const move = [...related].reverse().find((o) => o.type === "move");
    const replace = [...related].reverse().find((o) => o.type === "replace_text");
    let bbox = span.bbox;
    let text = span.text;
    if (move?.new_bbox) bbox = asTuple(move.new_bbox);
    if (replace?.text != null) text = replace.text;
    // Prefer expanded draw box from replace (wider text stays one line).
    if (replace?.new_bbox) bbox = asTuple(replace.new_bbox);
    else if (replace?.text != null && !move?.new_bbox) {
      const [x0, y0, x1, y1] = bbox;
      const est = estimateTextWidthPts(text, span.font, span.size);
      if (est > x1 - x0) bbox = [x0, y0, x0 + est, y1];
    }
    const changed = Boolean(move || replace);
    out.push({
      ...span,
      bbox,
      text,
      pending: pendingPreview && changed,
    });

    for (const dup of related.filter((o) => o.type === "duplicate" && o.new_bbox)) {
      out.push({
        ...span,
        id: `${span.id}::dup::${dup.id}`,
        bbox: asTuple(dup.new_bbox!),
        text: dup.text ?? span.text,
        isDuplicate: true,
        opId: dup.id,
        pending: pendingPreview,
      });
    }
  }
  return out;
}

export type ChangeMark = {
  id: string;
  bbox: [number, number, number, number];
  tone: "before" | "after" | "removed" | "added";
};

function bboxMoved(
  a: [number, number, number, number],
  b: [number, number, number, number],
) {
  return a.some((n, i) => Math.abs(n - b[i]) > 0.5);
}

/** Boxes that differ from the original layout. Shown only in Compare. */
export function changeMarksForPage(
  spans: TextSpan[],
  ops: EditOp[],
  pageIndex: number,
  side: "original" | "edited",
): ChangeMark[] {
  const visual = visualSpansForPage(spans, ops, pageIndex);
  const marks: ChangeMark[] = [];
  for (const item of visual) {
    if (item.isDuplicate) {
      if (side === "edited") {
        marks.push({ id: `${item.id}-added`, bbox: item.bbox, tone: "added" });
      }
      continue;
    }
    const base = spans.find((s) => s.id === item.id);
    if (!base) continue;
    if (item.deleted) {
      if (side === "original") {
        marks.push({ id: `${item.id}-removed`, bbox: base.bbox, tone: "removed" });
      }
      continue;
    }
    const textChanged = item.text !== base.text;
    const moved = bboxMoved(item.bbox, base.bbox);
    if (!textChanged && !moved) continue;
    if (side === "original") {
      marks.push({
        id: `${item.id}-before`,
        bbox: base.bbox,
        tone: "before",
      });
    } else {
      marks.push({
        id: `${item.id}-after`,
        bbox: item.bbox,
        tone: "after",
      });
    }
  }
  return marks;
}

export function findVisualSpan(
  spans: TextSpan[],
  ops: EditOp[],
  pageIndex: number,
  spanId: string,
): VisualSpan | null {
  return (
    visualSpansForPage(spans, ops, pageIndex).find((s) => s.id === spanId) ||
    null
  );
}
