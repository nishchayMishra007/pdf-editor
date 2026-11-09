"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, Lock, Moon, Sun, Trash2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useEditorStore } from "@/store/editorStore";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

export function UploadScreen() {
  const openFile = useEditorStore((s) => s.openFile);
  const openDocument = useEditorStore((s) => s.openDocument);
  const recent = useEditorStore((s) => s.recent);
  const loadRecent = useEditorStore((s) => s.loadRecent);
  const removeRecent = useEditorStore((s) => s.removeRecent);
  const loading = useEditorStore((s) => s.loading);
  const error = useEditorStore((s) => s.error);
  const dark = useEditorStore((s) => s.dark);
  const toggleDark = useEditorStore((s) => s.toggleDark);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  useEffect(() => {
    if (pendingFile) {
      passwordRef.current?.focus();
    }
  }, [pendingFile]);

  const tryOpen = useCallback(
    async (file: File, pw?: string) => {
      try {
        await openFile(file, pw);
        setPendingFile(null);
        setPassword("");
        setPasswordError(null);
      } catch (e) {
        if (
          e instanceof ApiError &&
          (e.code === "password_required" || e.code === "invalid_password")
        ) {
          setPendingFile(file);
          setPasswordError(
            e.code === "invalid_password"
              ? "Incorrect password. Try again."
              : null,
          );
          if (e.code === "invalid_password") setPassword("");
          return;
        }
      }
    },
    [openFile],
  );

  const onFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      const isPdf =
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf");
      if (!isPdf) {
        useEditorStore.getState().setError("Please choose a PDF file.");
        return;
      }
      setPendingFile(null);
      setPassword("");
      setPasswordError(null);
      void tryOpen(file);
      // Allow selecting the same file again later
      if (inputRef.current) inputRef.current.value = "";
    },
    [tryOpen],
  );

  return (
    <div className="relative flex min-h-screen flex-col bg-[radial-gradient(ellipse_at_top,_#e8f3ff_0%,_#f8fafc_45%,_#eef2ff_100%)] dark:bg-[radial-gradient(ellipse_at_top,_#0b1220_0%,_#09090b_50%,_#111827_100%)]">
      <div className="absolute right-4 top-4 z-10">
        <Button variant="ghost" size="icon" onClick={toggleDark} aria-label="Toggle theme">
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-16">
        <p className="mb-2 text-sm font-medium tracking-wide text-sky-700 dark:text-sky-300">
          Local PDF Editor
        </p>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-5xl">
          Edit PDF text. Keep everything else identical.
        </h1>
        <p className="mt-3 max-w-xl text-base text-zinc-600 dark:text-zinc-400">
          Open a PDF, change words, move or duplicate text, then download. No cloud.
          Images and graphics stay untouched.
        </p>

        {/* Native <label> opens the file dialog reliably (no JS .click() needed). */}
        <label
          htmlFor="pdf-input"
          className={cn(
            "relative mt-10 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-16 transition",
            dragOver
              ? "border-sky-500 bg-sky-50/80 dark:bg-sky-950/40"
              : "border-zinc-300 bg-white/70 hover:border-sky-400 hover:bg-sky-50/40 dark:border-zinc-700 dark:bg-zinc-900/50 dark:hover:border-sky-600",
            loading && "pointer-events-none opacity-70",
          )}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
            onFiles(e.dataTransfer.files);
          }}
        >
          <FileUp className="mb-3 h-10 w-10 text-sky-600" />
          <p className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
            {loading ? "Opening…" : "Drop a PDF here"}
          </p>
          <p className="mt-1 text-sm text-zinc-500">or click anywhere in this box to browse</p>
          <span className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-sky-600 px-5 text-sm font-medium text-white shadow-sm">
            Choose PDF
          </span>
          <input
            ref={inputRef}
            id="pdf-input"
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            disabled={loading}
            onChange={(e) => onFiles(e.target.files)}
          />
        </label>

        {pendingFile && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/90 p-4 dark:border-amber-900 dark:bg-amber-950/40">
            <div className="flex items-start gap-3">
              <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-amber-950 dark:text-amber-100">
                  Password required
                </p>
                <p className="mt-0.5 truncate text-xs text-amber-800/80 dark:text-amber-200/70">
                  {pendingFile.name} is password-protected
                </p>
                <form
                  className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!password) {
                      setPasswordError("Enter the PDF password");
                      return;
                    }
                    void tryOpen(pendingFile, password);
                  }}
                >
                  <input
                    ref={passwordRef}
                    type="password"
                    autoComplete="current-password"
                    placeholder="Enter PDF password"
                    value={password}
                    disabled={loading}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setPasswordError(null);
                    }}
                    className="h-10 w-full flex-1 rounded-md border border-amber-300 bg-white px-3 text-sm text-zinc-900 outline-none ring-sky-500 focus:ring-2 dark:border-amber-800 dark:bg-zinc-900 dark:text-zinc-50"
                  />
                  <div className="flex gap-2">
                    <Button type="submit" disabled={loading || !password}>
                      Unlock
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={loading}
                      onClick={() => {
                        setPendingFile(null);
                        setPassword("");
                        setPasswordError(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
                {passwordError && (
                  <p className="mt-2 text-sm text-rose-700 dark:text-rose-300">
                    {passwordError}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
            {error}
          </div>
        )}

        {recent.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Recent files
            </h2>
            <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white/80 dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/60">
              {recent.map((doc) => (
                <li
                  key={doc.id}
                  className="group flex items-center gap-1 pr-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/80"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center justify-between px-4 py-3 text-left"
                    onClick={() => void openDocument(doc)}
                  >
                    <span className="truncate font-medium text-zinc-900 dark:text-zinc-50">
                      {doc.name}
                    </span>
                    <span className="ml-3 shrink-0 text-xs text-zinc-500">
                      {doc.page_count} page{doc.page_count === 1 ? "" : "s"}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400"
                    aria-label={`Delete ${doc.name}`}
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeRecent(doc.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
