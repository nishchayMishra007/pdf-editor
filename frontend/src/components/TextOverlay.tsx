"use client";

import { useState, type MutableRefObject } from "react";
import { Stage, Layer, Rect, Line, Circle, Text, Group } from "react-konva";
import type { VisualSpan } from "@/lib/spanGeometry";
import { useEditorStore } from "@/store/editorStore";

type Guide = { orientation: "v" | "h"; pos: number };

type Props = {
  width: number;
  height: number;
  scalePts: number;
  spans: VisualSpan[];
  dragOrigin: MutableRefObject<{ ids: string[]; start: { x: number; y: number } } | null>;
};

export default function TextOverlay({
  width,
  height,
  scalePts,
  spans,
  dragOrigin,
}: Props) {
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);

  const hoveredId = useEditorStore((s) => s.hoveredId);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const editingId = useEditorStore((s) => s.editingId);
  const fallbackSpanIds = useEditorStore((s) => s.fallbackSpanIds);
  const setHovered = useEditorStore((s) => s.setHovered);
  const select = useEditorStore((s) => s.select);
  const beginEdit = useEditorStore((s) => s.beginEdit);
  const moveSpans = useEditorStore((s) => s.moveSpans);

  const computeGuides = (
    movingIds: string[],
    dx: number,
    dy: number,
  ): { guides: Guide[]; snapDx: number; snapDy: number } => {
    const SNAP = 4 / scalePts;
    let snapDx = dx;
    let snapDy = dy;
    const g: Guide[] = [];
    const movers = spans.filter((s) => movingIds.includes(s.id));
    const others = spans.filter((s) => !movingIds.includes(s.id));
    for (const m of movers) {
      const mx0 = m.bbox[0] + dx;
      const my0 = m.bbox[1] + dy;
      const mx1 = m.bbox[2] + dx;
      const my1 = m.bbox[3] + dy;
      const mcx = (mx0 + mx1) / 2;
      const mcy = (my0 + my1) / 2;
      for (const o of others) {
        const [ox0, oy0, ox1, oy1] = o.bbox;
        const ocx = (ox0 + ox1) / 2;
        const ocy = (oy0 + oy1) / 2;
        for (const [target, cur] of [
          [ox0, mx0],
          [ox1, mx0],
          [ox0, mx1],
          [ox1, mx1],
          [ocx, mcx],
        ] as const) {
          if (Math.abs(cur - target) < SNAP) {
            snapDx = dx + (target - cur);
            g.push({ orientation: "v", pos: target * scalePts });
          }
        }
        for (const [target, cur] of [
          [oy0, my0],
          [oy1, my0],
          [oy0, my1],
          [oy1, my1],
          [ocy, mcy],
        ] as const) {
          if (Math.abs(cur - target) < SNAP) {
            snapDy = dy + (target - cur);
            g.push({ orientation: "h", pos: target * scalePts });
          }
        }
      }
    }
    return { guides: g, snapDx, snapDy };
  };

  return (
    <Stage
      width={width}
      height={height}
      onMouseDown={(e) => {
        const stage = e.target.getStage();
        if (!stage) return;
        const pos = stage.getPointerPosition();
        if (!pos) return;
        if (e.target === stage) {
          if (!(e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey)) {
            select([]);
          }
          setMarquee({ x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y });
        }
      }}
      onMouseMove={(e) => {
        if (!marquee) return;
        const stage = e.target.getStage();
        const pos = stage?.getPointerPosition();
        if (!pos) return;
        setMarquee({ ...marquee, x1: pos.x, y1: pos.y });
      }}
      onMouseUp={() => {
        if (!marquee) return;
        const x0 = Math.min(marquee.x0, marquee.x1) / scalePts;
        const y0 = Math.min(marquee.y0, marquee.y1) / scalePts;
        const x1 = Math.max(marquee.x0, marquee.x1) / scalePts;
        const y1 = Math.max(marquee.y0, marquee.y1) / scalePts;
        if (Math.abs(x1 - x0) > 2 || Math.abs(y1 - y0) > 2) {
          const hit = spans
            .filter((s) => {
              const [sx0, sy0, sx1, sy1] = s.bbox;
              return !(sx1 < x0 || sx0 > x1 || sy1 < y0 || sy0 > y1);
            })
            .map((s) => s.id);
          select(hit);
        }
        setMarquee(null);
      }}
    >
      <Layer>
        {spans.map((span) => {
          const [x0, y0, x1, y1] = span.bbox;
          const selected = selectedIds.includes(span.id);
          const hovered = hoveredId === span.id;
          const fallback = fallbackSpanIds.has(span.id);
          const w = (x1 - x0) * scalePts;
          const h = (y1 - y0) * scalePts;
          const showPending =
            Boolean(span.pending) && editingId !== span.id && !span.isDuplicate;
          return (
            <Group key={span.id}>
              {showPending && (
                <>
                  <Rect
                    x={x0 * scalePts}
                    y={y0 * scalePts}
                    width={Math.max(w, 4)}
                    height={Math.max(h, 4)}
                    fill="#ffffff"
                    listening={false}
                  />
                  <Text
                    x={x0 * scalePts}
                    y={y0 * scalePts}
                    width={Math.max(w, 40)}
                    height={Math.max(h, span.size * scalePts)}
                    text={span.text}
                    fontSize={span.size * scalePts}
                    fontFamily="Helvetica, Arial, sans-serif"
                    fill={`rgb(${span.color
                      .map((c) => Math.round(c * 255))
                      .join(",")})`}
                    listening={false}
                    wrap="none"
                  />
                </>
              )}
              <Rect
                x={x0 * scalePts}
                y={y0 * scalePts}
                width={w}
                height={h}
                fill={
                  selected
                    ? "rgba(14,165,233,0.18)"
                    : hovered
                      ? "rgba(14,165,233,0.10)"
                      : "rgba(0,0,0,0)"
                }
                stroke={
                  selected
                    ? "#0ea5e9"
                    : hovered
                      ? "#38bdf8"
                      : fallback
                        ? "#f97316"
                        : undefined
                }
                strokeWidth={selected || hovered || fallback ? 1.5 : 0}
                draggable={selected && !editingId && !span.isDuplicate}
                onMouseEnter={() => setHovered(span.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={(e) => {
                  e.cancelBubble = true;
                  select([span.id], e.evt.shiftKey);
                }}
                onDblClick={(e) => {
                  e.cancelBubble = true;
                  if (span.isDuplicate) return;
                  beginEdit(span.id);
                }}
                onDragStart={(e) => {
                  const ids = selectedIds.includes(span.id)
                    ? selectedIds.filter((id) => !id.includes("::dup::"))
                    : span.isDuplicate
                      ? []
                      : [span.id];
                  dragOrigin.current = {
                    ids: ids.length ? ids : span.isDuplicate ? [] : [span.id],
                    start: { x: 0, y: 0 },
                  };
                  if (!span.isDuplicate && !selectedIds.includes(span.id)) {
                    select([span.id]);
                  }
                  if (e.evt.altKey && !span.isDuplicate) {
                    useEditorStore.getState().duplicateSelected();
                  }
                }}
                onDragMove={(e) => {
                  if (span.isDuplicate) {
                    e.target.position({ x: x0 * scalePts, y: y0 * scalePts });
                    return;
                  }
                  const dx = e.target.x() / scalePts - x0;
                  const dy = e.target.y() / scalePts - y0;
                  const ids = dragOrigin.current?.ids || [span.id];
                  const { guides: g, snapDx, snapDy } = computeGuides(ids, dx, dy);
                  setGuides(g);
                  e.target.position({
                    x: (x0 + snapDx) * scalePts,
                    y: (y0 + snapDy) * scalePts,
                  });
                }}
                onDragEnd={(e) => {
                  if (span.isDuplicate) {
                    e.target.position({ x: x0 * scalePts, y: y0 * scalePts });
                    return;
                  }
                  const dx = e.target.x() / scalePts - x0;
                  const dy = e.target.y() / scalePts - y0;
                  const ids = dragOrigin.current?.ids || [span.id];
                  const { snapDx, snapDy } = computeGuides(ids, dx, dy);
                  e.target.position({ x: x0 * scalePts, y: y0 * scalePts });
                  setGuides([]);
                  if (ids.length) moveSpans(ids, snapDx, snapDy);
                  dragOrigin.current = null;
                }}
              />
            </Group>
          );
        })}
        {spans
          .filter((s) => fallbackSpanIds.has(s.id))
          .map((span) => (
            <Circle
              key={`fb-${span.id}`}
              x={span.bbox[2] * scalePts + 4}
              y={span.bbox[1] * scalePts - 4}
              radius={4}
              fill="#f97316"
              stroke="#fff"
              strokeWidth={1}
              listening={false}
            />
          ))}
        {guides.map((g, i) =>
          g.orientation === "v" ? (
            <Line
              key={`g-${i}`}
              points={[g.pos, 0, g.pos, height]}
              stroke="#f43f5e"
              strokeWidth={1}
              dash={[4, 4]}
              listening={false}
            />
          ) : (
            <Line
              key={`g-${i}`}
              points={[0, g.pos, width, g.pos]}
              stroke="#f43f5e"
              strokeWidth={1}
              dash={[4, 4]}
              listening={false}
            />
          ),
        )}
        {marquee && (
          <Rect
            x={Math.min(marquee.x0, marquee.x1)}
            y={Math.min(marquee.y0, marquee.y1)}
            width={Math.abs(marquee.x1 - marquee.x0)}
            height={Math.abs(marquee.y1 - marquee.y0)}
            fill="rgba(14,165,233,0.08)"
            stroke="#0ea5e9"
            dash={[4, 4]}
            listening={false}
          />
        )}
      </Layer>
    </Stage>
  );
}
