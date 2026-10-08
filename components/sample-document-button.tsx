"use client";

import { useState } from "react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { usePreferences } from "@/components/preferences-provider";
import { AppIcon } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { sampleForLocale } from "@/lib/sample-documents";

export function SampleDocumentButton({ primary = false }: { primary?: boolean }) {
  const { preferences } = usePreferences();
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
      setError(preferences.locale === "tr" ? "Örnek PDF eklenemedi. Tekrar deneyin." : "The sample PDF could not be added. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button aria-busy={busy} className="gap-2" data-testid="sample-document-button" disabled={busy} onClick={() => void addSample()} type="button" variant={primary ? "default" : "outline"}>
        <AppIcon className="size-4" name={busy ? "loading" : "document"} />
        {busy ? (preferences.locale === "tr" ? "Örnek ekleniyor…" : "Adding sample…") : (preferences.locale === "tr" ? "Örnek PDF ile dene" : "Try a sample PDF")}
      </Button>
      {error ? <p className="mt-2 text-sm text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
