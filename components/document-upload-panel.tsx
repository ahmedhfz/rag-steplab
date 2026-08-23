"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FilePlus, Upload, X } from "lucide-react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { type AppCopy, UI_COPY } from "@/lib/copy";
import { validatePdfFile, type DocumentFileValidationError, formatDocumentFileSize } from "@/lib/document-file";

function validationMessage(error: DocumentFileValidationError, copy: AppCopy["overview"]) {
  if (error === "invalidPdf") return copy.invalidPdf;
  return copy.fileTooLarge;
}

/** Documents owns persistence; parsing starts only from the Parse screen. */
export function DocumentUploadPanel() {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const { addDocument } = useDocumentPipeline();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<DocumentFileValidationError | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const closeDialog = useCallback(() => {
    if (isSubmitting) return;
    setOpen(false);
    setFile(null);
    setValidationError(null);
    setSubmitError(null);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, [isSubmitting]);

  useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => chooseRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeDialog, open]);

  function openDialog() {
    setFile(null);
    setValidationError(null);
    setSubmitError(null);
    setOpen(true);
  }

  function chooseFile(nextFile: File | undefined) {
    if (!nextFile) return;
    const error = validatePdfFile(nextFile);
    setFile(nextFile);
    setValidationError(error);
    setSubmitError(null);
  }

  async function submit() {
    if (!file || validationError || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await addDocument(file);
      setOpen(false);
      setFile(null);
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : copy.overview.unknownParseError);
    } finally {
      setIsSubmitting(false);
    }
  }

  const dialogLabels = preferences.locale === "tr"
    ? { close: "Kapat", title: "PDF ekle", submit: "Dokümanı kaydet", selected: "Seçilen dosya", empty: "Henüz PDF seçilmedi", saving: "Kaydediliyor…" }
    : { close: "Close", title: "Add PDF", submit: "Save document", selected: "Selected file", empty: "No PDF selected yet", saving: "Saving…" };

  return (
    <section className="flex items-center justify-between gap-3" data-testid="document-upload-panel">
      <div>
        <h2 className="text-sm font-semibold">{preferences.locale === "tr" ? "PDF ekle" : "Add PDF"}</h2>
        <p className="mt-1 text-xs text-slate-500">{copy.overview.fileRequirements}</p>
      </div>
      <Button className="gap-2" onClick={openDialog} ref={triggerRef} type="button">
        <FilePlus aria-hidden="true" className="size-4" />
        {preferences.locale === "tr" ? "PDF ekle" : "Add PDF"}
      </Button>

      {open ? (
        <div aria-describedby="add-pdf-description" aria-labelledby="add-pdf-title" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4" role="dialog" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
          <div className="w-full max-w-lg rounded-lg border bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold" id="add-pdf-title">{dialogLabels.title}</h2>
                <p className="mt-1 text-sm leading-5 text-slate-600" id="add-pdf-description">{copy.overview.fileRequirements}</p>
              </div>
              <Button aria-label={dialogLabels.close} disabled={isSubmitting} onClick={closeDialog} size="icon-sm" type="button" variant="ghost"><X aria-hidden="true" className="size-4" /></Button>
            </div>
            <div className="mt-5 rounded-md border border-dashed p-5 text-center">
              <Upload aria-hidden="true" className="mx-auto size-6 text-slate-500" />
              <p className="mt-2 text-sm text-slate-600">{copy.overview.choosePdf}</p>
              <input accept="application/pdf,.pdf" aria-describedby="add-pdf-description" aria-label={copy.overview.choosePdf} className="sr-only" onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} ref={fileInputRef} type="file" />
              <Button className="mt-3" onClick={() => fileInputRef.current?.click()} ref={chooseRef} type="button" variant="outline">{copy.overview.choosePdf}</Button>
              <p className="mt-2 text-xs text-slate-500">{copy.overview.noFileSent}</p>
            </div>
            {file ? <div className="mt-4 flex items-center justify-between gap-3 border px-3 py-2 text-sm"><span className="min-w-0 truncate"><span className="font-medium">{dialogLabels.selected}: </span>{file.name}<span className="ml-2 text-xs text-slate-500">{formatDocumentFileSize(file.size, preferences.locale)}</span></span><Button aria-label={dialogLabels.close} onClick={() => { setFile(null); setValidationError(null); }} size="icon-xs" type="button" variant="ghost"><X aria-hidden="true" className="size-3.5" /></Button></div> : <p className="mt-4 text-sm text-slate-500">{dialogLabels.empty}</p>}
            {validationError ? <p className="mt-3 text-sm text-red-700" role="alert">{validationMessage(validationError, copy.overview)}</p> : null}
            {submitError ? <p className="mt-3 text-sm text-red-700" role="alert">{submitError}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button disabled={isSubmitting} onClick={closeDialog} type="button" variant="outline">{dialogLabels.close}</Button>
              <Button aria-busy={isSubmitting} disabled={!file || Boolean(validationError) || isSubmitting} onClick={() => void submit()} type="button">{isSubmitting ? dialogLabels.saving : dialogLabels.submit}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
