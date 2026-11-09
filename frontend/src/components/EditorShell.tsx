"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useEditorStore } from "@/store/editorStore";
import { TopBar } from "./TopBar";
import { ThumbnailRail } from "./ThumbnailRail";
import { PdfCanvas } from "./PdfCanvas";
import { PropertiesPanel } from "./PropertiesPanel";
import { DraftDrop } from "./DraftDrop";

export function EditorShell() {
  const error = useEditorStore((s) => s.error);
  const setError = useEditorStore((s) => s.setError);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const nudgeSelected = useEditorStore((s) => s.nudgeSelected);
  const editingId = useEditorStore((s) => s.editingId);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const cancelEdit = useEditorStore((s) => s.cancelEdit);
  const document = useEditorStore((s) => s.document);
  const loading = useEditorStore((s) => s.loading);
  const hasFile = Boolean(document && document.page_count > 0 && document.has_file !== false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA");

      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }
      if (typing) return;

      if ((mod && e.key.toLowerCase() === "d") || (e.altKey && e.key === "Drag")) {
        // Cmd/Ctrl+D handled below; Alt+drag is in canvas
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (e.key === "Escape") {
        if (editingId) cancelEdit();
        else clearSelection();
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        nudgeSelected(-step, 0);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        nudgeSelected(step, 0);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        nudgeSelected(0, -step);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        nudgeSelected(0, step);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    undo,
    redo,
    duplicateSelected,
    deleteSelected,
    nudgeSelected,
    editingId,
    clearSelection,
    cancelEdit,
  ]);

  return (
    <div className="flex h-full flex-col bg-zinc-50 dark:bg-zinc-950">
      <TopBar />
      {error && (
        <div className="flex items-center justify-between gap-3 border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
          <span>{error}</span>
          <button
            type="button"
            className="text-xs font-medium underline"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      {loading && (
        <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-800">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading page…
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {hasFile ? (
          <>
            <ThumbnailRail />
            <PdfCanvas />
            <PropertiesPanel />
          </>
        ) : (
          document && <DraftDrop draftId={document.id} />
        )}
      </div>
      <footer className="flex h-8 items-center justify-between gap-3 border-t border-zinc-200 px-3 text-[11px] text-zinc-500 dark:border-zinc-800">
        <span className="truncate">
          Tip: double-click to edit · drag to move · Ctrl/Cmd+D duplicate · Delete · arrows nudge
        </span>
        <span className="hidden shrink-0 sm:inline">Orange marker = fallback font</span>
      </footer>
    </div>
  );
}
