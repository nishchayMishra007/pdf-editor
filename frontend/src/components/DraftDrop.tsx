"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, Lock } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useEditorStore } from "@/store/editorStore";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

export function DraftDrop({ draftId }: { draftId: string }) {
  const attachFile = useEditorStore((s) => s.attachFile);
  const loading = useEditorStore((s) => s.loading);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (pendingFile) passwordRef.current?.focus();
  }, [pendingFile]);

  const tryAttach = useCallback(
    async (file: File, pw?: string) => {
      try {
        await attachFile(draftId, file, pw);
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
            e.code === "invalid_password" ? "Incorrect password. Try again." : null,
          );
          if (e.code === "invalid_password") setPassword("");
        }
      }
    },
    [attachFile, draftId],
  );

  const onFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      const isPdf =
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (!isPdf) {
        useEditorStore.getState().setError("Please choose a PDF file.");
        return;
      }
      setPendingFile(null);
      setPassword("");
      setPasswordError(null);
      void tryAttach(file);
      if (inputRef.current) inputRef.current.value = "";
    },
    [tryAttach],
  );

  return (
    <div className="flex h-full flex-col items-center justify-center bg-zinc-50 p-8 dark:bg-zinc-950">
      <label
        htmlFor="draft-pdf-input"
        className={cn(
          "flex w-full max-w-xl cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-16",
          dragOver
            ? "border-sky-500 bg-sky-50/80 dark:bg-sky-950/40"
            : "border-zinc-300 bg-white hover:border-sky-400 dark:border-zinc-700 dark:bg-zinc-900",
          loading && "pointer-events-none opacity-70",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onFiles(e.dataTransfer.files);
        }}
      >
        <FileUp className="mb-3 h-10 w-10 text-sky-600" />
        <p className="text-lg font-medium">{loading ? "Opening…" : "Drop a PDF in this draft"}</p>
        <p className="mt-1 text-sm text-zinc-500">or click to browse</p>
        <span className="mt-5 inline-flex h-10 items-center rounded-md bg-sky-600 px-5 text-sm font-medium text-white">
          Choose PDF
        </span>
        <input
          ref={inputRef}
          id="draft-pdf-input"
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          disabled={loading}
          onChange={(e) => onFiles(e.target.files)}
        />
      </label>

      {pendingFile && (
        <form
          className="mt-4 flex w-full max-w-xl items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void tryAttach(pendingFile, password);
          }}
        >
          <label className="flex-1 text-sm">
            <span className="mb-1 flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
              <Lock className="h-3.5 w-3.5" />
              Password for {pendingFile.name}
            </span>
            <input
              ref={passwordRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
              placeholder="PDF password"
            />
            {passwordError && (
              <span className="mt-1 block text-xs text-rose-600">{passwordError}</span>
            )}
          </label>
          <Button type="submit" disabled={loading || !password}>
            Unlock
          </Button>
        </form>
      )}
    </div>
  );
}
