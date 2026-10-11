"use client";

import { useState } from "react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { usePreferences } from "@/components/preferences-provider";
import { AppIcon } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/copy";
import { sampleForLocale } from "@/lib/sample-documents";

export function SampleDocumentButton({ primary = false }: { primary?: boolean }) {
  const { preferences } = usePreferences();
  const labels = useCopy().documents.sample;
  const { addDocument } = useDocumentPipeline();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sample = sampleForLocale(preferences.locale);

  async function addSample() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(sample.path);
      if (!response.ok) throw new Error("sample_unavailable");
      const file = new File([await response.blob()], sample.fileName, { type: "application/pdf" });
      await addDocument(file);
    } catch {
      setError(labels.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button aria-busy={busy} data-testid="sample-document-button" disabled={busy} onClick={() => void addSample()} type="button" variant={primary ? "default" : "outline"}>
        <AppIcon className={busy ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} name={busy ? "loading" : "document"} />
        {busy ? labels.adding : labels.action}
      </Button>
      {error ? <p className="mt-2 text-sm text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
