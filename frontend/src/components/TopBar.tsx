"use client";

import {
  Download,
  Loader2,
  Moon,
  Redo2,
  Sun,
  Undo2,
  ZoomIn,
  ZoomOut,
  Columns2,
  Eye,
} from "lucide-react";
import { useState } from "react";
import { useEditorStore } from "@/store/editorStore";
import { Button } from "./ui/button";
import { NameField } from "./NameField";
import { cn } from "@/lib/utils";

export function TopBar() {
  const document = useEditorStore((s) => s.document);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const past = useEditorStore((s) => s.past);
  const future = useEditorStore((s) => s.future);
  const zoomIn = useEditorStore((s) => s.zoomIn);
  const zoomOut = useEditorStore((s) => s.zoomOut);
  const zoom = useEditorStore((s) => s.zoom);
  const setFitWidth = useEditorStore((s) => s.setFitWidth);
  const download = useEditorStore((s) => s.download);
  const saving = useEditorStore((s) => s.saving);
  const compareMode = useEditorStore((s) => s.compareMode);
  const setCompareMode = useEditorStore((s) => s.setCompareMode);
  const compareSideBySide = useEditorStore((s) => s.compareSideBySide);
  const setCompareSideBySide = useEditorStore((s) => s.setCompareSideBySide);
  const dark = useEditorStore((s) => s.dark);
  const toggleDark = useEditorStore((s) => s.toggleDark);
  const renameDraft = useEditorStore((s) => s.renameDraft);
  const loading = useEditorStore((s) => s.loading);
  const [downloading, setDownloading] = useState(false);

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-200 bg-white/90 px-2 py-2 backdrop-blur sm:px-3 dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="min-w-0 flex-1 basis-40">
        <div className="text-left">
          {document ? (
            <NameField
              value={document.name}
              className="text-sm font-semibold text-zinc-900 dark:text-zinc-50"
              onSave={(name) => renameDraft(document.id, name)}
            />
          ) : (
            <p className="truncate text-sm font-semibold">PDF Editor</p>
          )}
          <p className="text-[11px] text-zinc-500">
            {loading ? "Loading…" : saving ? "Saving…" : "Local only · autosave on"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)">
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={redo} disabled={!future.length} title="Redo (Ctrl+Shift+Z)">
          <Redo2 className="h-4 w-4" />
        </Button>
        <div className="mx-1 h-6 w-px bg-zinc-200 dark:bg-zinc-700" />
        <Button variant="ghost" size="icon" onClick={zoomOut} title="Zoom out">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <button
          type="button"
          className="min-w-14 rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          onClick={() => setFitWidth(true)}
          title="Fit to width"
        >
          {Math.round(zoom * 100)}%
        </button>
        <Button variant="ghost" size="icon" onClick={zoomIn} title="Zoom in">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <div className="mx-1 h-6 w-px bg-zinc-200 dark:bg-zinc-700" />
        <Button
          variant={compareMode ? "default" : "secondary"}
          size="sm"
          onClick={() => setCompareMode(!compareMode)}
          title="Compare original vs edited"
        >
          <Eye className="h-4 w-4" />
          <span className="hidden sm:inline">Compare</span>
        </Button>
        {compareMode && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCompareSideBySide(!compareSideBySide)}
            title={compareSideBySide ? "Switch view" : "Side by side"}
          >
            <Columns2 className={cn("h-4 w-4", compareSideBySide && "text-sky-600")} />
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={toggleDark}>
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>

      <Button
        size="sm"
        className="font-semibold shadow-sm sm:h-11 sm:px-6 sm:text-base"
        disabled={downloading || !document || document.page_count < 1}
        onClick={() => {
          setDownloading(true);
          void download().finally(() => setDownloading(false));
        }}
      >
        {downloading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        <span className="hidden sm:inline">{downloading ? "Downloading…" : "Download"}</span>
      </Button>
    </header>
  );
}
