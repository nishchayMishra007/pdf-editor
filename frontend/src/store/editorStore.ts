"use client";

import { create } from "zustand";
import { toast } from "sonner";
import {
  ApiError,
  attachPdf,
  createDraft,
  deleteDocument,
  exportDocument,
  getLayout,
  getOps,
  listDocuments,
  putOps,
  renameDocument,
  uploadDocument,
} from "@/lib/api";
import type {
  BBox,
  DocumentMeta,
  EditOp,
  EditorWarning,
  OpMetrics,
  PageLayout,
  TextSpan,
} from "@/lib/types";
import {
  allLayoutSpans,
  estimateTextWidthPts,
  findVisualSpan as lookupVisualSpan,
} from "@/lib/spanGeometry";
import { uid } from "@/lib/utils";

const MAX_HISTORY = 80;

type HistorySnap = {
  ops: EditOp[];
};

type EditorState = {
  recent: DocumentMeta[];
  document: DocumentMeta | null;
  pageIndex: number; // 0-based
  layout: PageLayout | null;
  ops: EditOp[];
  past: HistorySnap[];
  future: HistorySnap[];
  selectedIds: string[];
  hoveredId: string | null;
  editingId: string | null;
  zoom: number;
  fitWidth: boolean;
  compareMode: boolean;
  compareSideBySide: boolean;
  warnings: EditorWarning[];
  fallbackSpanIds: Set<string>;
  workingBust: number;
  /** Bumps on every local ops change; used to ignore stale persist results. */
  opsEpoch: number;
  /** Last opsEpoch successfully applied to the working PDF. */
  persistedEpoch: number;
  loading: boolean;
  recentLoading: boolean;
  saving: boolean;
  error: string | null;
  dark: boolean;

  loadRecent: () => Promise<void>;
  renameDraft: (id: string, name: string) => Promise<void>;
  removeRecent: (id: string) => Promise<void>;
  startDraft: () => Promise<DocumentMeta>;
  attachFile: (docId: string, file: File, password?: string) => Promise<void>;
  openFile: (file: File, password?: string) => Promise<void>;
  openDocument: (doc: DocumentMeta) => Promise<void>;
  setPage: (index: number) => Promise<void>;
  refreshLayout: () => Promise<void>;
  setZoom: (z: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  setFitWidth: (v: boolean) => void;
  setCompareMode: (v: boolean) => void;
  setCompareSideBySide: (v: boolean) => void;
  setHovered: (id: string | null) => void;
  select: (ids: string[], additive?: boolean) => void;
  clearSelection: () => void;
  beginEdit: (spanId: string) => void;
  commitEdit: (spanId: string, text: string) => void;
  cancelEdit: () => void;
  moveSpans: (spanIds: string[], dx: number, dy: number) => void;
  duplicateSelected: () => void;
  deleteSelected: () => void;
  nudgeSelected: (dx: number, dy: number) => void;
  undo: () => void;
  redo: () => void;
  persistOps: () => Promise<void>;
  download: () => Promise<void>;
  setError: (msg: string | null) => void;
  toggleDark: () => void;
  findSpan: (spanId: string) => TextSpan | null;
  findVisualSpan: (spanId: string) => TextSpan | null;
};

function bboxFromSpan(span: TextSpan): BBox {
  const [x0, y0, x1, y1] = span.bbox;
  return { x0, y0, x1, y1 };
}

function translateBBox(b: BBox, dx: number, dy: number): BBox {
  return { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy };
}

function warningsFromResult(
  warnings: string[],
  metrics: OpMetrics[],
  docWarnings: string[] = [],
): { list: EditorWarning[]; fallbackIds: Set<string> } {
  const list: EditorWarning[] = [];
  const fallbackIds = new Set<string>();
  for (const w of docWarnings) {
    list.push({ id: uid("dw"), severity: "warn", message: w });
  }
  for (const w of warnings) {
    // Skip soft overflow strings already represented via metrics.overflow.
    if (/text overflow/i.test(w)) continue;
    const sev = /fail|error|encrypted|cannot/i.test(w) ? "error" : "warn";
    list.push({ id: uid("w"), severity: sev, message: w });
  }
  for (const m of metrics) {
    if (m.fallback_glyph_count > 0 || m.font_source === "bundled") {
      list.push({
        id: uid("fb"),
        severity: "warn",
        message:
          m.notes.find((n) => /glyph|fallback|font/i.test(n)) ||
          `Fallback font used for edit (${m.fallback_glyph_count} glyph(s))`,
        opId: m.op_id,
      });
    }
    if (m.overflow) {
      list.push({
        id: uid("ov"),
        severity: "warn",
        message:
          m.notes.find((n) => /overflow/i.test(n)) ||
          "Text overflow: content does not fit the original box at locked font size",
        opId: m.op_id,
      });
    }
    if (m.clipped) {
      list.push({
        id: uid("cl"),
        severity: "warn",
        message: "Text may be clipped (rotated / constrained span)",
        opId: m.op_id,
      });
    }
  }
  return { list, fallbackIds };
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

export const useEditorStore = create<EditorState>((set, get) => ({
  recent: [],
  document: null,
  pageIndex: 0,
  layout: null,
  ops: [],
  past: [],
  future: [],
  selectedIds: [],
  hoveredId: null,
  editingId: null,
  zoom: 1.25,
  fitWidth: true,
  compareMode: false,
  compareSideBySide: true,
  warnings: [],
  fallbackSpanIds: new Set(),
  workingBust: 0,
  opsEpoch: 0,
  persistedEpoch: 0,
  loading: false,
  recentLoading: true,
  saving: false,
  error: null,
  dark: false,

  setError: (msg) => set({ error: msg }),

  toggleDark: () => {
    const dark = !get().dark;
    document.documentElement.classList.toggle("dark", dark);
    set({ dark });
  },

  loadRecent: async () => {
    set({ recentLoading: true });
    try {
      const recent = await listDocuments();
      set({ recent, recentLoading: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load recent files";
      set({ error: msg, recentLoading: false });
    }
  },

  renameDraft: async (id, name) => {
    const updated = await renameDocument(id, name);
    const current = get().document;
    set({
      recent: get().recent.map((d) => (d.id === id ? updated : d)),
      document: current?.id === id ? { ...current, ...updated } : current,
    });
    toast.success("Name updated");
  },

  removeRecent: async (id) => {
    const prev = get().recent;
    const current = get().document;
    set({
      recent: prev.filter((d) => d.id !== id),
      document: current?.id === id ? null : current,
      layout: current?.id === id ? null : get().layout,
    });
    try {
      await deleteDocument(id);
      toast.success("Draft deleted");
    } catch (e) {
      set({ recent: prev, document: current });
      const msg = e instanceof Error ? e.message : "Failed to delete file";
      toast.error(msg);
      throw e;
    }
  },

  startDraft: async () => {
    const doc = await createDraft();
    set({ recent: [doc, ...get().recent.filter((d) => d.id !== doc.id)] });
    return doc;
  },

  attachFile: async (docId, file, password) => {
    set({ loading: true, error: null });
    try {
      const doc = await attachPdf(docId, file, password);
      await get().openDocument(doc);
      toast.success(`Opened ${doc.name}`);
      await get().loadRecent();
    } catch (e) {
      set({ loading: false });
      if (
        e instanceof ApiError &&
        (e.code === "password_required" || e.code === "invalid_password")
      ) {
        throw e;
      }
      const msg = e instanceof Error ? e.message : "Upload failed";
      set({ error: msg });
      toast.error(msg);
    }
  },

  openFile: async (file, password) => {
    set({ loading: true, error: null });
    try {
      const doc = await uploadDocument(file, password);
      await get().openDocument(doc);
      toast.success(`Opened ${doc.name}`);
      await get().loadRecent();
    } catch (e) {
      set({ loading: false });
      // Let the upload screen show a password field.
      if (
        e instanceof ApiError &&
        (e.code === "password_required" || e.code === "invalid_password")
      ) {
        throw e;
      }
      const msg = e instanceof Error ? e.message : "Upload failed";
      set({ error: msg });
      toast.error(msg);
    }
  },

  openDocument: async (doc) => {
    set({
      loading: true,
      error: null,
      document: doc,
      pageIndex: 0,
      ops: [],
      past: [],
      future: [],
      selectedIds: [],
      editingId: null,
      workingBust: Date.now(),
      opsEpoch: 0,
      persistedEpoch: 0,
      warnings: doc.warnings.map((m) => ({
        id: uid("dw"),
        severity: "warn" as const,
        message: m,
      })),
      fallbackSpanIds: new Set(),
    });
    const hasFile = doc.has_file !== false && doc.page_count > 0;
    if (!hasFile) {
      set({ layout: null, loading: false, ops: [] });
      return;
    }
    try {
      const [layout, ops] = await Promise.all([
        getLayout(doc.id, 1),
        getOps(doc.id).catch(() => [] as EditOp[]),
      ]);
      const warnings = [...get().warnings];
      if (!layout.has_text && layout.message) {
        warnings.push({
          id: uid("scan"),
          severity: "warn",
          message: layout.message,
        });
      }
      set({
        layout,
        ops,
        opsEpoch: ops.length ? 1 : 0,
        persistedEpoch: ops.length ? 1 : 0,
        loading: false,
        warnings,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load page layout";
      set({ error: msg, loading: false });
      toast.error(msg);
    }
  },

  setPage: async (index) => {
    const doc = get().document;
    if (!doc) return;
    if (index < 0 || index >= doc.page_count) return;
    set({ pageIndex: index, selectedIds: [], editingId: null, loading: true });
    try {
      const layout = await getLayout(doc.id, index + 1);
      set({ layout, loading: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load page";
      set({ error: msg, loading: false });
    }
  },

  refreshLayout: async () => {
    const doc = get().document;
    if (!doc) return;
    const layout = await getLayout(doc.id, get().pageIndex + 1);
    set({ layout });
  },

  setZoom: (z) => set({ zoom: Math.min(3, Math.max(0.4, z)), fitWidth: false }),
  zoomIn: () => get().setZoom(get().zoom + 0.15),
  zoomOut: () => get().setZoom(get().zoom - 0.15),
  setFitWidth: (v) => set({ fitWidth: v }),
  setCompareMode: (v) => set({ compareMode: v }),
  setCompareSideBySide: (v) => set({ compareSideBySide: v }),
  setHovered: (id) => set({ hoveredId: id }),

  select: (ids, additive = false) => {
    if (additive) {
      const cur = new Set(get().selectedIds);
      for (const id of ids) {
        if (cur.has(id)) cur.delete(id);
        else cur.add(id);
      }
      set({ selectedIds: [...cur], editingId: null });
    } else {
      set({ selectedIds: ids, editingId: null });
    }
  },

  clearSelection: () => set({ selectedIds: [], editingId: null }),

  findSpan: (spanId) => {
    const layout = get().layout;
    if (!layout) return null;
    for (const b of layout.blocks) {
      for (const l of b.lines) {
        for (const s of l.spans) {
          if (s.id === spanId) return s;
        }
      }
    }
    return null;
  },

  findVisualSpan: (spanId) => {
    const { layout, ops, pageIndex } = get();
    return lookupVisualSpan(allLayoutSpans(layout), ops, pageIndex, spanId);
  },

  beginEdit: (spanId) => {
    set({ editingId: spanId, selectedIds: [spanId] });
  },

  commitEdit: (spanId, text) => {
    const raw = get().findSpan(spanId);
    if (!raw) {
      set({ editingId: null });
      return;
    }
    const current = get().findVisualSpan(spanId);
    const next = text.replace(/\u00a0/g, " ").replace(/\n$/, "");
    const prev = (current?.text ?? raw.text).replace(/\u00a0/g, " ");
    if (next === prev) {
      set({ editingId: null });
      return;
    }
    pushHistory(set, get);
    const [x0, y0, x1, y1] = raw.bbox;
    const estW = estimateTextWidthPts(next, raw.font, raw.size);
    const expanded =
      estW > x1 - x0
        ? { x0, y0, x1: x0 + estW, y1 }
        : { x0, y0, x1, y1 };
    const op: EditOp = {
      id: uid("replace"),
      type: "replace_text",
      page: get().pageIndex,
      span_id: raw.id,
      // Always redact/rewrite at the original layout box; moves are separate ops.
      bbox: bboxFromSpan(raw),
      // Expanded hit/draw box so longer values stay on one line in the overlay.
      new_bbox: expanded,
      text: next,
      original_text: raw.text,
      font: raw.font,
      size: raw.size,
      color: raw.color,
    };
    // Replace any prior replace/delete for same span
    const ops = get().ops.filter(
      (o) => !(o.span_id === spanId && (o.type === "replace_text" || o.type === "delete")),
    );
    ops.push(op);
    set({ ops, editingId: null, opsEpoch: get().opsEpoch + 1 });
    schedulePersist(get, true);
  },

  cancelEdit: () => set({ editingId: null }),

  moveSpans: (spanIds, dx, dy) => {
    if (!dx && !dy) return;
    pushHistory(set, get);
    let ops = [...get().ops];
    for (const spanId of spanIds) {
      const span = get().findSpan(spanId);
      if (!span) continue;
      const existing = ops.find(
        (o) => o.span_id === spanId && (o.type === "move" || o.type === "duplicate"),
      );
      const base =
        existing?.new_bbox ||
        existing?.bbox ||
        bboxFromSpan(span);
      const new_bbox = translateBBox(base, dx, dy);
      ops = ops.filter((o) => !(o.span_id === spanId && o.type === "move"));
      ops.push({
        id: uid("move"),
        type: "move",
        page: get().pageIndex,
        span_id: span.id,
        bbox: bboxFromSpan(span),
        new_bbox,
        original_text: span.text,
        font: span.font,
        size: span.size,
        color: span.color,
        text: span.text,
      });
    }
    set({ ops, opsEpoch: get().opsEpoch + 1 });
    schedulePersist(get);
  },

  duplicateSelected: () => {
    const ids = get().selectedIds;
    if (!ids.length) return;
    pushHistory(set, get);
    const ops = [...get().ops];
    const newSelected: string[] = [];
    for (const spanId of ids) {
      const span = get().findSpan(spanId);
      if (!span) continue;
      const box = bboxFromSpan(span);
      const new_bbox = translateBBox(box, 24, 24);
      const op: EditOp = {
        id: uid("dup"),
        type: "duplicate",
        page: get().pageIndex,
        span_id: span.id,
        bbox: box,
        new_bbox,
        text: span.text,
        original_text: span.text,
        font: span.font,
        size: span.size,
        color: span.color,
      };
      ops.push(op);
      newSelected.push(span.id);
    }
    set({ ops, selectedIds: newSelected, opsEpoch: get().opsEpoch + 1 });
    schedulePersist(get);
    toast.message("Duplicated");
  },

  deleteSelected: () => {
    const ids = get().selectedIds;
    if (!ids.length) return;
    pushHistory(set, get);
    let ops = [...get().ops];
    for (const spanId of ids) {
      const span = get().findSpan(spanId);
      if (!span) continue;
      ops = ops.filter((o) => o.span_id !== spanId);
      ops.push({
        id: uid("del"),
        type: "delete",
        page: get().pageIndex,
        span_id: span.id,
        bbox: bboxFromSpan(span),
        original_text: span.text,
        font: span.font,
        size: span.size,
        color: span.color,
      });
    }
    set({ ops, selectedIds: [], editingId: null, opsEpoch: get().opsEpoch + 1 });
    schedulePersist(get);
  },

  nudgeSelected: (dx, dy) => get().moveSpans(get().selectedIds, dx, dy),

  undo: () => {
    const { past, ops, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({
      past: past.slice(0, -1),
      future: [{ ops }, ...future].slice(0, MAX_HISTORY),
      ops: prev.ops,
      opsEpoch: get().opsEpoch + 1,
    });
    schedulePersist(get, true);
  },

  redo: () => {
    const { past, ops, future } = get();
    if (!future.length) return;
    const next = future[0];
    set({
      future: future.slice(1),
      past: [...past, { ops }].slice(-MAX_HISTORY),
      ops: next.ops,
      opsEpoch: get().opsEpoch + 1,
    });
    schedulePersist(get, true);
  },

  persistOps: async () => {
    const doc = get().document;
    if (!doc) return;
    const epoch = get().opsEpoch;
    const opsSnapshot = get().ops;
    set({ saving: true });
    try {
      const result = await putOps(doc.id, opsSnapshot);
      // A newer edit landed while this request was in flight — drop stale result.
      if (get().opsEpoch !== epoch) {
        set({ saving: get().opsEpoch !== get().persistedEpoch });
        return;
      }
      const { list, fallbackIds } = warningsFromResult(
        result.warnings,
        result.op_metrics,
        doc.warnings,
      );
      // Map fallback ops → span ids; sync expanded draw boxes from server.
      const fb = new Set(fallbackIds);
      const ops = opsSnapshot.map((op) => {
        const m = result.op_metrics.find((x) => x.op_id === op.id);
        if (!m) return op;
        if (m.fallback_glyph_count > 0 || m.font_source === "bundled") {
          if (op.span_id) fb.add(op.span_id);
        }
        if (
          m.drawn_bbox &&
          (op.type === "replace_text" ||
            op.type === "move" ||
            op.type === "duplicate" ||
            op.type === "add_text")
        ) {
          const [x0, y0, x1, y1] = m.drawn_bbox;
          return { ...op, new_bbox: { x0, y0, x1, y1 } };
        }
        return op;
      });
      set({
        ops,
        warnings: list,
        fallbackSpanIds: fb,
        workingBust: Date.now(),
        persistedEpoch: epoch,
        saving: false,
      });
    } catch (e) {
      if (get().opsEpoch !== epoch) {
        set({ saving: get().opsEpoch !== get().persistedEpoch });
        return;
      }
      const msg = e instanceof Error ? e.message : "Failed to save edits";
      set({ error: msg, saving: false });
      toast.error(msg);
      console.error("[persistOps]", e);
    }
  },

  download: async () => {
    const doc = get().document;
    if (!doc) return;
    try {
      // Ensure latest ops are applied
      await get().persistOps();
      const { blob, filename } = await exportDocument(doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${filename}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Download failed";
      set({ error: msg });
      toast.error(msg);
      console.error("[download]", e);
    }
  },
}));

function pushHistory(
  set: (partial: Partial<EditorState>) => void,
  get: () => EditorState,
) {
  const { past, ops } = get();
  set({
    past: [...past, { ops: structuredClone(ops) }].slice(-MAX_HISTORY),
    future: [],
  });
}

let persistChain: Promise<void> = Promise.resolve();

function schedulePersist(get: () => EditorState, immediate = false) {
  const enqueue = () => {
    persistChain = persistChain
      .then(async () => {
        // Always persist the latest epoch; skip if already applied.
        if (get().opsEpoch === get().persistedEpoch && !get().saving) return;
        await get().persistOps();
      })
      .catch((e) => {
        console.error("[schedulePersist]", e);
      });
  };
  if (persistTimer) clearTimeout(persistTimer);
  if (immediate) {
    persistTimer = null;
    enqueue();
  } else {
    persistTimer = setTimeout(enqueue, 200);
  }
}
