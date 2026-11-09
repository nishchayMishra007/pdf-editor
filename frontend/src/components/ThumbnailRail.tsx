"use client";

import { useEffect, useState } from "react";
import { originalPdfUrl, workingPdfUrl } from "@/lib/api";
import { cancelCanvasRender, loadPdf, renderPageToCanvas } from "@/lib/pdf";
import { useEditorStore } from "@/store/editorStore";
import { cn } from "@/lib/utils";

function Thumb({
  url,
  pageIndex,
  active,
  onClick,
}: {
  url: string;
  pageIndex: number;
  active: boolean;
  onClick: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = document.createElement("canvas");
    (async () => {
      try {
        const doc = await loadPdf(url);
        if (cancelled) return;
        const page = await doc.getPage(pageIndex + 1);
        if (cancelled) return;
        await renderPageToCanvas(page, canvas, 0.25);
        if (!cancelled) setSrc(canvas.toDataURL("image/jpeg", 0.7));
      } catch (e) {
        if (cancelled) return;
        console.error("[thumb]", e);
      }
    })();
    return () => {
      cancelled = true;
      cancelCanvasRender(canvas);
    };
  }, [url, pageIndex]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "mb-0 w-16 shrink-0 overflow-hidden rounded-md border bg-white p-1 md:mb-2 md:w-full dark:bg-zinc-900",
        active
          ? "border-sky-500 ring-2 ring-sky-500/30"
          : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700",
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={`Page ${pageIndex + 1}`} className="w-full" />
      ) : (
        <div className="flex aspect-[3/4] items-center justify-center text-xs text-zinc-400">
          …
        </div>
      )}
      <span className="mt-1 block text-center text-[10px] text-zinc-500">
        {pageIndex + 1}
      </span>
    </button>
  );
}

export function ThumbnailRail() {
  const document = useEditorStore((s) => s.document);
  const pageIndex = useEditorStore((s) => s.pageIndex);
  const setPage = useEditorStore((s) => s.setPage);
  const workingBust = useEditorStore((s) => s.workingBust);

  if (!document) return null;
  const url = workingPdfUrl(document.id, workingBust) || originalPdfUrl(document.id);

  return (
    <aside className="flex h-28 w-full shrink-0 flex-row gap-2 overflow-x-auto border-b border-zinc-200 bg-zinc-50 p-2 md:h-auto md:w-28 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r dark:border-zinc-800 dark:bg-zinc-950">
      <p className="hidden px-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 md:block">
        Pages
      </p>
      {Array.from({ length: document.page_count }, (_, i) => (
        <Thumb
          key={`${document.id}-${i}-${workingBust}`}
          url={url}
          pageIndex={i}
          active={i === pageIndex}
          onClick={() => void setPage(i)}
        />
      ))}
    </aside>
  );
}
