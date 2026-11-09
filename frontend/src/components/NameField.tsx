"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

export function NameField({
  value,
  onSave,
  className,
  inputClassName,
}: {
  value: string;
  onSave: (name: string) => Promise<void>;
  className?: string;
  inputClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const save = async () => {
    const next = draft.trim();
    if (!next || next === value) {
      setEditing(false);
      setDraft(value);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not rename");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        className={cn(
          "group inline-flex max-w-full items-center gap-1.5 text-left",
          className,
        )}
        title="Rename"
        onClick={(e) => {
          e.stopPropagation();
          setDraft(value);
          setEditing(true);
        }}
      >
        <span className="truncate">{value}</span>
        <Pencil className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
      </button>
    );
  }

  return (
    <form
      className="flex min-w-0 items-center gap-1"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <input
        autoFocus
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        className={cn(
          "h-8 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900",
          inputClassName,
        )}
      />
      <Button type="submit" size="icon" variant="ghost" disabled={saving} aria-label="Save name">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={saving}
        aria-label="Cancel rename"
        onClick={() => {
          setDraft(value);
          setEditing(false);
        }}
      >
        <X className="h-4 w-4" />
      </Button>
    </form>
  );
}
