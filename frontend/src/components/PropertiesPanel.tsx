"use client";

import { useMemo } from "react";
import { useEditorStore } from "@/store/editorStore";
import { WarningsPanel } from "./WarningsPanel";

export function PropertiesPanel() {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const fallbackSpanIds = useEditorStore((s) => s.fallbackSpanIds);
  const layout = useEditorStore((s) => s.layout);
  const ops = useEditorStore((s) => s.ops);
  const pageIndex = useEditorStore((s) => s.pageIndex);

  const span = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    return useEditorStore.getState().findVisualSpan(selectedIds[0]);
  }, [selectedIds, ops, pageIndex, layout]);

  return (
    <aside className="flex max-h-56 w-full shrink-0 flex-col overflow-y-auto border-t border-zinc-200 bg-white lg:max-h-none lg:w-72 lg:border-l lg:border-t-0 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex-1 overflow-y-auto p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Properties
        </h3>
        {!span && (
          <p className="mt-3 text-sm text-zinc-500">
            Select a text block to see its locked typography and position.
          </p>
        )}
        {span && (
          <dl className="mt-3 space-y-3 text-sm">
            <div>
              <dt className="text-xs text-zinc-500">Text</dt>
              <dd className="mt-0.5 break-words font-medium text-zinc-900 dark:text-zinc-50">
                {span.text}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Font (locked)</dt>
              <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">
                {span.font}
                {fallbackSpanIds.has(span.id) && (
                  <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-800 dark:bg-orange-950 dark:text-orange-200">
                    fallback
                  </span>
                )}
              </dd>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <dt className="text-xs text-zinc-500">Size</dt>
                <dd>{span.size.toFixed(1)} pt</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Color</dt>
                <dd className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-sm border border-zinc-300"
                    style={{
                      background: `rgb(${span.color.map((c) => Math.round(c * 255)).join(",")})`,
                    }}
                  />
                  rgb
                </dd>
              </div>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Position</dt>
              <dd className="font-mono text-xs text-zinc-600 dark:text-zinc-400">
                ({span.bbox[0].toFixed(1)}, {span.bbox[1].toFixed(1)}) → (
                {span.bbox[2].toFixed(1)}, {span.bbox[3].toFixed(1)})
              </dd>
            </div>
            <p className="rounded-md bg-zinc-50 p-2 text-[11px] text-zinc-500 dark:bg-zinc-900">
              Typography controls are intentionally locked so the PDF stays
              visually faithful to the original.
            </p>
          </dl>
        )}
        {selectedIds.length > 1 && (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
            {selectedIds.length} text blocks selected
          </p>
        )}
        {layout && !layout.has_text && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            {layout.message ||
              "This page has no text layer (likely a scan). OCR is out of scope."}
          </div>
        )}
      </div>
      <WarningsPanel />
    </aside>
  );
}
