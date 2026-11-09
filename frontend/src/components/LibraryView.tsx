"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { exportDocument } from "@/lib/api";
import type { DocumentMeta } from "@/lib/types";
import { useEditorStore } from "@/store/editorStore";
import { Button } from "./ui/button";
import { NameField } from "./NameField";

function formatWhen(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export function LibraryView() {
  const router = useRouter();
  const recent = useEditorStore((s) => s.recent);
  const recentLoading = useEditorStore((s) => s.recentLoading);
  const loadRecent = useEditorStore((s) => s.loadRecent);
  const removeRecent = useEditorStore((s) => s.removeRecent);
  const renameDraft = useEditorStore((s) => s.renameDraft);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const download = async (id: string, hasFile: boolean) => {
    if (!hasFile) {
      toast.error("This draft has no PDF yet");
      return;
    }
    setBusyId(id);
    try {
      const { blob, filename } = await exportDocument(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    try {
      await removeRecent(id);
    } catch {
      /* toast already shown */
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-zinc-200 px-4 py-4 sm:px-6 sm:py-5 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Library</h1>
          {recentLoading && recent.length > 0 && (
            <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
          )}
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          Every playground draft. Rename, download, or open one to keep editing.
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        {recentLoading && recent.length === 0 ? (
          <div className="flex h-40 items-center justify-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading drafts…
          </div>
        ) : (
          <>
            <ul className="grid gap-3 md:hidden">
              {recent.map((doc) => (
                <LibraryCard
                  key={doc.id}
                  doc={doc}
                  busy={busyId === doc.id}
                  deleting={deletingId === doc.id}
                  onOpen={() => router.push(`/playground/${doc.id}`)}
                  onDownload={() =>
                    void download(doc.id, doc.has_file !== false && doc.page_count > 0)
                  }
                  onDelete={() => void remove(doc.id)}
                  onRename={(name) => renameDraft(doc.id, name)}
                />
              ))}
            </ul>
            <table className="hidden w-full border-collapse text-sm md:table">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="hidden px-3 py-2 font-medium lg:table-cell">Updated</th>
                  <th className="px-3 py-2 font-medium">Pages</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((doc) => {
                  const hasFile = doc.has_file !== false && doc.page_count > 0;
                  return (
                    <tr
                      key={doc.id}
                      className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/80 dark:hover:bg-zinc-900"
                      onClick={() => router.push(`/playground/${doc.id}`)}
                    >
                      <td className="max-w-[240px] px-3 py-3 font-medium">
                        <NameField
                          value={doc.name}
                          onSave={(name) => renameDraft(doc.id, name)}
                        />
                      </td>
                      <td className="px-3 py-3 text-zinc-500">{formatWhen(doc.created_at)}</td>
                      <td className="hidden px-3 py-3 text-zinc-500 lg:table-cell">
                        {formatWhen(doc.updated_at)}
                      </td>
                      <td className="px-3 py-3 text-zinc-500">{hasFile ? doc.page_count : "—"}</td>
                      <td className="px-3 py-3">
                        <ActionButtons
                          name={doc.name}
                          hasFile={hasFile}
                          busy={busyId === doc.id}
                          deleting={deletingId === doc.id}
                          onDownload={() => void download(doc.id, hasFile)}
                          onDelete={() => void remove(doc.id)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {recent.length === 0 && (
              <p className="px-3 py-10 text-center text-sm text-zinc-500">
                No drafts yet. Click Playground in the sidebar to start one.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LibraryCard({
  doc,
  busy,
  deleting,
  onOpen,
  onDownload,
  onDelete,
  onRename,
}: {
  doc: DocumentMeta;
  busy: boolean;
  deleting: boolean;
  onOpen: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onRename: (name: string) => Promise<void>;
}) {
  const hasFile = doc.has_file !== false && doc.page_count > 0;
  return (
    <li className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <NameField value={doc.name} onSave={onRename} className="font-medium" />
      <button type="button" className="mt-2 w-full text-left" onClick={onOpen}>
        <p className="text-xs text-zinc-500">Created {formatWhen(doc.created_at)}</p>
        <p className="text-xs text-zinc-500">Updated {formatWhen(doc.updated_at)}</p>
        <p className="mt-1 text-xs text-zinc-500">{hasFile ? `${doc.page_count} pages` : "No PDF yet"}</p>
      </button>
      <ActionButtons
        name={doc.name}
        hasFile={hasFile}
        busy={busy}
        deleting={deleting}
        onDownload={onDownload}
        onDelete={onDelete}
      />
    </li>
  );
}

function ActionButtons({
  name,
  hasFile,
  busy,
  deleting,
  onDownload,
  onDelete,
}: {
  name: string;
  hasFile: boolean;
  busy: boolean;
  deleting: boolean;
  onDownload: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title="Download"
        aria-label={`Download ${name}`}
        disabled={!hasFile || busy || deleting}
        onClick={(e) => {
          e.stopPropagation();
          onDownload();
        }}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title="Delete"
        aria-label={`Delete ${name}`}
        className="text-zinc-400 hover:text-rose-600"
        disabled={deleting || busy}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </Button>
    </div>
  );
}
