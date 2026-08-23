"use client";

import { useRef, useState } from "react";
import { FilePlus, LoaderCircle, Upload, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { type AppCopy, UI_COPY } from "@/lib/copy";
import { validatePdfFile, type DocumentFileValidationError, formatDocumentFileSize } from "@/lib/document-file";
import { cn } from "@/lib/utils";

function validationMessage(error: DocumentFileValidationError, copy: AppCopy["overview"]) {
  return error === "invalidPdf" ? copy.invalidPdf : copy.fileTooLarge;
}

/** Documents owns persistence; parsing starts only from the Parse screen. */
export function DocumentUploadPanel() {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const { addDocument } = useDocumentPipeline();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<DocumentFileValidationError | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const labels = preferences.locale === "tr"
    ? { close: "Kapat", title: "PDF ekle", submit: "Dokümanı kaydet", selected: "Seçilen dosya", empty: "Henüz PDF seçilmedi", saving: "Kaydediliyor…", drop: "PDF'yi buraya bırakın" }
    : { close: "Close", title: "Add PDF", submit: "Save document", selected: "Selected file", empty: "No PDF selected yet", saving: "Saving…", drop: "Drop the PDF here" };

  function reset() {
    setFile(null);
    setValidationError(null);
    setSubmitError(null);
    setDragActive(false);
  }

  function chooseFile(nextFile: File | undefined) {
    if (!nextFile) return;
    setFile(nextFile);
    setValidationError(validatePdfFile(nextFile));
    setSubmitError(null);
  }

  async function submit() {
    if (!file || validationError || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await addDocument(file);
      setOpen(false);
      reset();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : copy.overview.unknownParseError);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="flex items-center justify-between gap-3" data-testid="document-upload-panel">
      <div><h2 className="text-sm font-semibold">{labels.title}</h2><p className="mt-1 text-xs text-slate-500">{copy.overview.fileRequirements}</p></div>
      <DialogPrimitive.Root onOpenChange={(next) => { if (isSubmitting) return; setOpen(next); if (next) reset(); }} open={open}>
        <DialogPrimitive.Trigger asChild><Button className="gap-2" type="button"><FilePlus aria-hidden="true" className="size-4" />{labels.title}</Button></DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/35" />
          <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-white p-5 shadow-xl focus:outline-none" onEscapeKeyDown={(event) => { if (isSubmitting) event.preventDefault(); }} onInteractOutside={(event) => { if (isSubmitting) event.preventDefault(); }}>
            <div className="flex items-start justify-between gap-4">
              <div><DialogPrimitive.Title className="text-base font-semibold">{labels.title}</DialogPrimitive.Title><DialogPrimitive.Description className="mt-1 text-sm leading-5 text-slate-600">{copy.overview.fileRequirements}</DialogPrimitive.Description></div>
              <DialogPrimitive.Close asChild><Button aria-label={labels.close} disabled={isSubmitting} size="icon-sm" type="button" variant="ghost"><X aria-hidden="true" className="size-4" /></Button></DialogPrimitive.Close>
            </div>
            <div
              data-testid="pdf-drop-zone"
              className={cn("mt-5 rounded-md border border-dashed p-5 text-center transition-colors", dragActive && "border-sky-500 bg-sky-50")}
              onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragLeave={(event) => { event.preventDefault(); if (event.currentTarget === event.target) setDragActive(false); }}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragActive(true); }}
              onDrop={(event) => { event.preventDefault(); setDragActive(false); chooseFile(event.dataTransfer.files?.[0]); }}
            >
              <Upload aria-hidden="true" className="mx-auto size-6 text-slate-500" />
              <p className="mt-2 text-sm text-slate-600">{dragActive ? labels.drop : copy.overview.choosePdf}</p>
              <input accept="application/pdf,.pdf" aria-label={copy.overview.choosePdf} className="sr-only" onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} ref={fileInputRef} type="file" />
              <Button autoFocus className="mt-3" onClick={() => fileInputRef.current?.click()} type="button" variant="outline">{copy.overview.choosePdf}</Button>
              <p className="mt-2 text-xs text-slate-500">{copy.overview.noFileSent}</p>
            </div>
            {file ? <div className="mt-4 flex items-center justify-between gap-3 border px-3 py-2 text-sm"><span className="min-w-0 truncate"><span className="font-medium">{labels.selected}: </span>{file.name}<span className="ml-2 text-xs text-slate-500">{formatDocumentFileSize(file.size, preferences.locale)}</span></span><Button aria-label={labels.close} onClick={() => { setFile(null); setValidationError(null); }} size="icon-xs" type="button" variant="ghost"><X aria-hidden="true" className="size-3.5" /></Button></div> : <p className="mt-4 text-sm text-slate-500">{labels.empty}</p>}
            {validationError ? <p className="mt-3 text-sm text-red-700" role="alert">{validationMessage(validationError, copy.overview)}</p> : null}
            {submitError ? <p className="mt-3 text-sm text-red-700" role="alert">{submitError}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <DialogPrimitive.Close asChild><Button disabled={isSubmitting} type="button" variant="outline">{labels.close}</Button></DialogPrimitive.Close>
              <Button aria-busy={isSubmitting} disabled={!file || Boolean(validationError) || isSubmitting} onClick={() => void submit()} type="button">{isSubmitting ? <><LoaderCircle aria-hidden="true" className="size-4 animate-spin" />{labels.saving}</> : labels.submit}</Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </section>
  );
}
