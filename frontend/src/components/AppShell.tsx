"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Library, Loader2, Menu, SquarePen, X } from "lucide-react";
import { useEditorStore } from "@/store/editorStore";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const startDraft = useEditorStore((s) => s.startDraft);
  const [creating, setCreating] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const onNewPlayground = async () => {
    if (creating) return;
    setCreating(true);
    setNavOpen(false);
    try {
      const doc = await startDraft();
      router.push(`/playground/${doc.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start a draft";
      useEditorStore.getState().setError(msg);
    } finally {
      setCreating(false);
    }
  };

  const libraryActive = pathname.startsWith("/library");

  return (
    <div className="flex h-screen flex-col bg-zinc-50 text-zinc-900 md:flex-row dark:bg-zinc-950 dark:text-zinc-50">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-200 px-3 md:hidden dark:border-zinc-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
          Local PDF Editor
        </p>
        <button
          type="button"
          className="rounded-md p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label={navOpen ? "Close menu" : "Open menu"}
          onClick={() => setNavOpen((v) => !v)}
        >
          {navOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>
      {navOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setNavOpen(false)}
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-white transition-transform md:static md:translate-x-0 dark:border-zinc-800 dark:bg-zinc-950",
          navOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="hidden px-4 py-4 md:block">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
            Local PDF Editor
          </p>
        </div>
        <nav className="mt-14 flex flex-col gap-1 px-2 md:mt-0">
          <button
            type="button"
            onClick={() => void onNewPlayground()}
            disabled={creating}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:hover:bg-zinc-800",
              pathname.startsWith("/playground") &&
                "bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200",
            )}
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SquarePen className="h-4 w-4" />
            )}
            {creating ? "Starting draft…" : "Playground"}
          </button>
          <Link
            href="/library"
            onClick={() => setNavOpen(false)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800",
              libraryActive &&
                "bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200",
            )}
          >
            <Library className="h-4 w-4" />
            Library
          </Link>
        </nav>
      </aside>
      <div className="min-h-0 min-w-0 flex-1">{children}</div>
    </div>
  );
}
