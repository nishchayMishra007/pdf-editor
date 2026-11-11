"use client";

import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from "pdfjs-dist";

let workerReady = false;

export function ensurePdfWorker() {
  if (workerReady || typeof window === "undefined") return;
  GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  workerReady = true;
}

const cache = new Map<string, PDFDocumentProxy>();
/** Track in-flight renders so we never share one canvas across two ops. */
const activeRenders = new WeakMap<HTMLCanvasElement, RenderTask>();

export async function loadPdf(url: string): Promise<PDFDocumentProxy> {
  ensurePdfWorker();
  // Strip cache-buster for document identity, but keep distinct loads if needed
  const existing = cache.get(url);
  if (existing) return existing;
  const doc = await getDocument({
    url,
    withCredentials: false,
  }).promise;
  cache.set(url, doc);
  if (cache.size > 12) {
    const first = cache.keys().next().value;
    if (first && first !== url) {
      const old = cache.get(first);
      cache.delete(first);
      void (old as { destroy?: () => Promise<void> } | undefined)?.destroy?.();
    }
  }
  return doc;
}

export function cancelCanvasRender(canvas: HTMLCanvasElement | null | undefined) {
  if (!canvas) return;
  const task = activeRenders.get(canvas);
  if (task) {
    try {
      task.cancel();
    } catch {
      /* already finished */
    }
    activeRenders.delete(canvas);
  }
}

export async function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
): Promise<{ width: number; height: number }> {
  // Cancel any previous render on this canvas BEFORE resizing/clearing it.
  cancelCanvasRender(canvas);

  // Default viewport already applies page./Rotate so the page appears upright.
  const viewport = page.getViewport({ scale });
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D unavailable");

  const width = Math.floor(viewport.width);
  const height = Math.floor(viewport.height);
  canvas.width = width;
  canvas.height = height;

  // Reset any leftover transforms from a cancelled/corrupt prior paint.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // Do NOT pass `canvas` into render() — in pdf.js 4+ that enables a
  // single-owner canvas lock and causes the multi-render error + flipped output
  // when React Strict Mode / zoom re-renders overlap.
  const task = page.render({
    canvasContext: ctx,
    viewport,
  } as Parameters<PDFPageProxy["render"]>[0]);
  activeRenders.set(canvas, task);

  try {
    await task.promise;
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    const msg = e instanceof Error ? e.message : String(e);
    // Cancellation is expected when effect cleans up or zoom changes.
    if (name === "RenderingCancelledException" || /cancel/i.test(msg)) {
      return { width, height };
    }
    throw e;
  } finally {
    if (activeRenders.get(canvas) === task) {
      activeRenders.delete(canvas);
    }
  }

  return { width, height };
}

export function clearPdfCache() {
  for (const doc of cache.values()) {
    void (doc as { destroy?: () => Promise<void> }).destroy?.();
  }
  cache.clear();
}
