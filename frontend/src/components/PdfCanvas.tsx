"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { workingPdfUrl, originalPdfUrl } from "@/lib/api";
import { cancelCanvasRender, loadPdf, renderPageToCanvas } from "@/lib/pdf";
import {
  allLayoutSpans,
  changeMarksForPage,
  visualSpansForPage,
  type ChangeMark,
  type VisualSpan,
} from "@/lib/spanGeometry";
import { useEditorStore } from "@/store/editorStore";
import { cn } from "@/lib/utils";

const TextOverlay = dynamic(() => import("./TextOverlay"), {
  ssr: false,
  loading: () => null,
});

const MARK_STYLE: Record<
  ChangeMark["tone"],
  { box: string; label: string }
> = {
  before: {
    box: "border-amber-500 bg-amber-400/25",
    label: "Was here",
  },
  after: {
    box: "border-emerald-500 bg-emerald-400/25",
    label: "Changed",
  },
  removed: {
    box: "border-rose-500 bg-rose-400/25",
    label: "Removed",
  },
  added: {
    box: "border-sky-500 bg-sky-400/25",
    label: "Added",
  },
};

function ChangeHighlights({
  marks,
  scalePts,
}: {
  marks: ChangeMark[];
  scalePts: number;
}) {
  if (!marks.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {marks.map((mark) => {
        const [x0, y0, x1, y1] = mark.bbox;
        const style = MARK_STYLE[mark.tone];
        return (
          <div
            key={mark.id}
            className={cn("absolute rounded-sm border-2", style.box)}
            style={{
              left: x0 * scalePts,
              top: y0 * scalePts,
              width: Math.max(8, (x1 - x0) * scalePts),
              height: Math.max(8, (y1 - y0) * scalePts),
            }}
          >
            <span className="absolute -top-4 left-0 whitespace-nowrap rounded bg-zinc-900/90 px-1 py-0.5 text-[10px] font-medium text-white">
              {style.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PageView({
  url,
  pageIndex,
  scale,
  interactive,
  label,
  marks = [],
}: {
  url: string;
  pageIndex: number;
  scale: number;
  interactive: boolean;
  label?: string;
  marks?: ChangeMark[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [pagePts, setPagePts] = useState({ w: 612, h: 792 });
  const dragOrigin = useRef<{ ids: string[]; start: { x: number; y: number } } | null>(
    null,
  );
  const editRef = useRef<HTMLDivElement>(null);

  const layout = useEditorStore((s) => s.layout);
  const ops = useEditorStore((s) => s.ops);
  const pageIndexStore = useEditorStore((s) => s.pageIndex);
  const editingId = useEditorStore((s) => s.editingId);
  const opsEpoch = useEditorStore((s) => s.opsEpoch);
  const persistedEpoch = useEditorStore((s) => s.persistedEpoch);
  const commitEdit = useEditorStore((s) => s.commitEdit);
  const cancelEdit = useEditorStore((s) => s.cancelEdit);
  const findVisualSpan = useEditorStore((s) => s.findVisualSpan);
  const commitGuard = useRef(false);

  const baseSpans = useMemo(() => allLayoutSpans(layout), [layout]);
  const pendingPreview = opsEpoch !== persistedEpoch;
  const spans: VisualSpan[] = useMemo(
    () =>
      visualSpansForPage(baseSpans, ops, pageIndexStore, { pendingPreview }).filter(
        (s) => !s.deleted,
      ),
    [baseSpans, ops, pageIndexStore, pendingPreview],
  );
  const scalePts = size.w > 0 ? size.w / pagePts.w : scale;

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    (async () => {
      try {
        const doc = await loadPdf(url);
        if (cancelled) return;
        const page = await doc.getPage(pageIndex + 1);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        if (!cancelled) setPagePts({ w: base.width, h: base.height });
        const target = canvasRef.current;
        if (!target || cancelled) return;
        const rendered = await renderPageToCanvas(page, target, scale);
        if (!cancelled) setSize({ w: rendered.width, h: rendered.height });
      } catch (e) {
        if (cancelled) return;
        console.error("[PageView render]", e);
      }
    })();
    return () => {
      cancelled = true;
      cancelCanvasRender(canvas);
      cancelCanvasRender(canvasRef.current);
    };
  }, [url, pageIndex, scale]);

  const editingSpan = editingId ? findVisualSpan(editingId) : null;

  // Seed contentEditable once per edit session — never as React children,
  // or zoom/hover re-renders wipe in-progress typing.
  useEffect(() => {
    if (!editingId || !editRef.current) return;
    commitGuard.current = false;
    const visual = useEditorStore.getState().findVisualSpan(editingId);
    const el = editRef.current;
    el.textContent = visual?.text ?? "";
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editingId]);

  const finishEdit = (raw: string) => {
    if (!editingSpan || commitGuard.current) return;
    commitGuard.current = true;
    commitEdit(editingSpan.id, raw);
  };

  return (
    <div className="relative" ref={wrapRef}>
      {label && (
        <div className="mb-2 text-center text-xs font-medium uppercase tracking-wide text-zinc-500">
          {label}
        </div>
      )}
      <div
        className="relative inline-block bg-white shadow-lg ring-1 ring-zinc-200 dark:ring-zinc-700"
        style={{ width: size.w || undefined, height: size.h || undefined }}
      >
        <canvas ref={canvasRef} className="block" />
        {size.w > 0 && <ChangeHighlights marks={marks} scalePts={scalePts} />}
        {interactive && size.w > 0 && (
          <div className="absolute inset-0">
            <TextOverlay
              width={size.w}
              height={size.h}
              scalePts={scalePts}
              spans={spans}
              dragOrigin={dragOrigin}
            />

            {editingSpan && (
              <div
                ref={editRef}
                contentEditable
                suppressContentEditableWarning
                className="absolute z-20 border border-sky-500 bg-white p-0.5 outline-none dark:bg-zinc-900"
                style={{
                  left: editingSpan.bbox[0] * scalePts,
                  top: editingSpan.bbox[1] * scalePts,
                  minWidth: Math.max(
                    40,
                    (editingSpan.bbox[2] - editingSpan.bbox[0]) * scalePts,
                  ),
                  minHeight:
                    (editingSpan.bbox[3] - editingSpan.bbox[1]) * scalePts,
                  fontSize: editingSpan.size * scalePts,
                  lineHeight: 1.15,
                  color: `rgb(${editingSpan.color
                    .map((c) => Math.round(c * 255))
                    .join(",")})`,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
                onBlur={(e) => finishEdit(e.currentTarget.innerText)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    commitGuard.current = true;
                    cancelEdit();
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    finishEdit(e.currentTarget.innerText);
                    return;
                  }
                  e.stopPropagation();
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function PdfCanvas() {
  const document = useEditorStore((s) => s.document);
  const pageIndex = useEditorStore((s) => s.pageIndex);
  const zoom = useEditorStore((s) => s.zoom);
  const fitWidth = useEditorStore((s) => s.fitWidth);
  const setZoom = useEditorStore((s) => s.setZoom);
  const workingBust = useEditorStore((s) => s.workingBust);
  const compareMode = useEditorStore((s) => s.compareMode);
  const compareSideBySide = useEditorStore((s) => s.compareSideBySide);
  const layout = useEditorStore((s) => s.layout);
  const ops = useEditorStore((s) => s.ops);
  const containerRef = useRef<HTMLDivElement>(null);
  const [switchShowEdited, setSwitchShowEdited] = useState(true);
  const baseSpans = useMemo(() => allLayoutSpans(layout), [layout]);
  const originalMarks = useMemo(
    () =>
      compareMode
        ? changeMarksForPage(baseSpans, ops, pageIndex, "original")
        : [],
    [compareMode, baseSpans, ops, pageIndex],
  );
  const editedMarks = useMemo(
    () =>
      compareMode ? changeMarksForPage(baseSpans, ops, pageIndex, "edited") : [],
    [compareMode, baseSpans, ops, pageIndex],
  );
  const changeCount = editedMarks.length;

  useEffect(() => {
    if (!fitWidth || !containerRef.current || !document) return;
    const el = containerRef.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const apply = () => {
      const pad = compareMode && compareSideBySide ? 96 : 48;
      const avail = el.clientWidth - pad;
      const pageWidth = 612;
      const next = Math.min(2.5, Math.max(0.5, avail / pageWidth));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setZoom(next), 50);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      ro.disconnect();
    };
  }, [fitWidth, document, setZoom, compareMode, compareSideBySide]);

  if (!document) return null;

  const editedUrl = workingPdfUrl(document.id, workingBust);
  const originalUrl = originalPdfUrl(document.id);

  return (
    <div
      ref={containerRef}
      className="flex flex-1 flex-col overflow-auto bg-zinc-100/80 p-6 dark:bg-zinc-900/40"
    >
      {compareMode && (
        <div className="mb-3 flex shrink-0 flex-wrap items-center justify-center gap-3 text-[11px] text-zinc-600 dark:text-zinc-300">
          <span className="rounded bg-amber-400/30 px-2 py-0.5">Original field</span>
          <span className="rounded bg-emerald-400/30 px-2 py-0.5">Edited field</span>
          <span className="rounded bg-rose-400/30 px-2 py-0.5">Removed</span>
          <span className="rounded bg-sky-400/30 px-2 py-0.5">Added</span>
          <span>
            {changeCount === 0
              ? "No changes on this page"
              : `${changeCount} change${changeCount === 1 ? "" : "s"} on this page`}
          </span>
        </div>
      )}
      <div
        className={cn(
          "flex flex-1",
          compareMode && compareSideBySide ? "gap-6" : "justify-center",
        )}
      >
      {compareMode && compareSideBySide ? (
        <>
          <PageView
            url={originalUrl}
            pageIndex={pageIndex}
            scale={zoom}
            interactive={false}
            label="Original"
            marks={originalMarks}
          />
          <PageView
            url={editedUrl}
            pageIndex={pageIndex}
            scale={zoom}
            interactive
            label="Edited"
            marks={editedMarks}
          />
        </>
      ) : compareMode && !compareSideBySide ? (
        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-2">
            <button
              type="button"
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium",
                !switchShowEdited
                  ? "bg-sky-600 text-white"
                  : "bg-zinc-200 dark:bg-zinc-800",
              )}
              onClick={() => setSwitchShowEdited(false)}
            >
              Original
            </button>
            <button
              type="button"
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium",
                switchShowEdited
                  ? "bg-sky-600 text-white"
                  : "bg-zinc-200 dark:bg-zinc-800",
              )}
              onClick={() => setSwitchShowEdited(true)}
            >
              Edited
            </button>
          </div>
          <PageView
            url={switchShowEdited ? editedUrl : originalUrl}
            pageIndex={pageIndex}
            scale={zoom}
            interactive={switchShowEdited}
            label={switchShowEdited ? "Edited" : "Original"}
            marks={switchShowEdited ? editedMarks : originalMarks}
          />
        </div>
      ) : (
        <PageView
          url={editedUrl}
          pageIndex={pageIndex}
          scale={zoom}
          interactive
        />
      )}
      </div>
    </div>
  );
}
