"use client";

import { AlertTriangle, Info } from "lucide-react";
import { useEditorStore } from "@/store/editorStore";
import { cn } from "@/lib/utils";

export function WarningsPanel() {
  const warnings = useEditorStore((s) => s.warnings);

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Warnings
        </h3>
        <p className="mt-0.5 text-[11px] text-zinc-400">
          Issues from your edits (fonts, overflow, scanned pages)
        </p>
      </div>
      <ul className="max-h-48 space-y-2 overflow-y-auto px-3 pb-3">
        {warnings.length === 0 && (
          <li className="rounded-md bg-emerald-50 px-2 py-2 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            No warnings — edits look clean.
          </li>
        )}
        {warnings.map((w) => (
          <li
            key={w.id}
            className={cn(
              "flex gap-2 rounded-md px-2 py-2 text-xs",
              w.severity === "error"
                ? "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
                : w.severity === "warn"
                  ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
                  : "bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100",
            )}
          >
            {w.severity === "info" ? (
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <span>{w.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
