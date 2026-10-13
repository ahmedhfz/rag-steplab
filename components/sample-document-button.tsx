"use client";

import { useState } from "react";

import { ApiErrorText } from "@/components/api-error-message";
import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { usePreferences } from "@/components/preferences-provider";
import { AppIcon } from "@/components/ui/app-icon";
import { Button, type ButtonSize } from "@/components/ui/button";
import { useCopy } from "@/lib/copy";
import { sampleForLocale } from "@/lib/sample-documents";

/** `primary` is the hero/empty-state CTA (pearl); otherwise a quiet secondary action. */
export function SampleDocumentButton({ primary = false, size = "md" }: { primary?: boolean; size?: ButtonSize }) {
  const { preferences } = usePreferences();
  const labels = useCopy().documents.sample;
  const { addDocument } = useDocumentPipeline();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
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
    } catch (caught) {
      // A quota, a paused server or a busy service explains itself; anything else is "could not be added".
      setError(caught ?? new Error(labels.failed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button aria-busy={busy} data-testid="sample-document-button" disabled={busy} onClick={() => void addSample()} size={size} type="button" variant={primary ? "pearl" : "secondary"}>
        <AppIcon className={busy ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} name={busy ? "loading" : "document"} />
        {busy ? labels.adding : labels.action}
      </Button>
      {error ? <div className="text-sm text-error-primary" role="alert"><ApiErrorText error={error} fallback={labels.failed} /></div> : null}
    </div>
  );
}
