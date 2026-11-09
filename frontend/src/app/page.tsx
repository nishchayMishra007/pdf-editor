"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, SquarePen } from "lucide-react";
import { useEditorStore } from "@/store/editorStore";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  const router = useRouter();
  const startDraft = useEditorStore((s) => s.startDraft);
  const [creating, setCreating] = useState(false);

  const onNew = async () => {
    setCreating(true);
    try {
      const doc = await startDraft();
      router.push(`/playground/${doc.id}`);
    } catch (e) {
      useEditorStore
        .getState()
        .setError(e instanceof Error ? e.message : "Could not start a draft");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <SquarePen className="h-10 w-10 text-sky-600" />
      <h1 className="text-2xl font-semibold">Playground</h1>
      <p className="max-w-md text-sm text-zinc-500">
        Each click starts a new draft, the same way a new chat starts a conversation.
        Upload a PDF inside that draft and edit it.
      </p>
      <Button onClick={() => void onNew()} disabled={creating}>
        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {creating ? "Starting draft…" : "New playground"}
      </Button>
    </div>
  );
}
