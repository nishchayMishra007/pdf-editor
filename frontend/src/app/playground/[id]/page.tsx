"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getDocument } from "@/lib/api";
import { useEditorStore } from "@/store/editorStore";
import { EditorShell } from "@/components/EditorShell";

export default function PlaygroundPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const document = useEditorStore((s) => s.document);
  const openDocument = useEditorStore((s) => s.openDocument);
  const setError = useEditorStore((s) => s.setError);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    if (useEditorStore.getState().document?.id === id) return;
    let cancelled = false;
    setFailed(null);
    (async () => {
      try {
        const doc = await getDocument(id);
        if (!cancelled) await openDocument(doc);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Draft not found";
        if (!cancelled) {
          setFailed(msg);
          setError(msg);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, openDocument, setError]);

  if (failed && document?.id !== id) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-rose-600">
        {failed}
      </div>
    );
  }

  if (!document || document.id !== id) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-zinc-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Opening draft…
      </div>
    );
  }

  return <EditorShell />;
}
