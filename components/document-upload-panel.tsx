"use client";

import { useRef, useState } from "react";
import { LoaderCircle, Plus, Upload, X } from "lucide-react";
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
    ? { add: "Doküman ekle", close: "Kapat", title: "PDF ekle", submit: "Dokümanı kaydet", selected: "Seçilen dosya", empty: "Henüz PDF seçilmedi", saving: "Kaydediliyor…", drop: "PDF'yi buraya bırakın" }
    : { add: "Add document", close: "Close", title: "Add PDF", submit: "Save document", selected: "Selected file", empty: "No PDF selected yet", saving: "Saving…", drop: "Drop the PDF here" };

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
    <DialogPrimitive.Root onOpenChange={(next) => { if (isSubmitting) return; setOpen(next); if (next) reset(); }} open={open}>
      <div className="relative" data-testid="document-upload-panel">
        <div className="absolute -top-[124px] right-0">
          <DialogPrimitive.Trigger asChild><Button aria-label={labels.title} className="h-[42px] w-[152px] gap-2 rounded-[10px] px-4 shadow-[0_1px_1px_rgba(0,0,0,0.12)]" type="button"><Plus aria-hidden="true" className="size-4" />{labels.add}</Button></DialogPrimitive.Trigger>
        </div>
        <section
          className={cn("mt-[33px] flex h-[210px] flex-col items-center justify-center rounded-[16px] border-[1.712px] border-dashed border-[#d8d2d5] bg-[#fbfafa] px-6 text-center transition-colors", dragActive && "border-[#711f3a] bg-[#fbf4f6]")}
          data-testid="pdf-drop-zone"
          onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
          onDragLeave={(event) => { event.preventDefault(); if (event.currentTarget === event.target) setDragActive(false); }}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragActive(true); }}
          onDrop={(event) => { event.preventDefault(); setDragActive(false); chooseFile(event.dataTransfer.files?.[0]); }}
        >
          <span className="grid size-12 place-items-center rounded-[14px] bg-white text-[#711f3a] shadow-[0_1px_1.5px_rgba(0,0,0,0.1),0_1px_1px_rgba(0,0,0,0.1)]"><Upload aria-hidden="true" className="size-[22px]" /></span>
          <p className="mt-4 text-[15px] font-medium leading-[22.5px] text-[#171416]">{dragActive ? labels.drop : preferences.locale === "tr" ? "PDF'yi buraya sürükleyin" : "Drag & drop a PDF here"}</p>
          <p className="mt-1 text-[13px] leading-[19.5px] text-[#6e676a]">{preferences.locale === "tr" ? "veya " : "or "}<button className="font-medium text-[#711f3a] underline-offset-4 hover:underline" onClick={() => fileInputRef.current?.click()} type="button">{preferences.locale === "tr" ? "dosyalarınıza göz atın" : "browse your files"}</button>{preferences.locale === "tr" ? ". Yalnızca PDF, en fazla 50 MB." : ". PDF only, up to 50 MB."}</p>
          <input accept="application/pdf,.pdf" aria-label={`${copy.overview.choosePdf} from drop zone`} className="sr-only" onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} ref={fileInputRef} type="file" />
        </section>
      </div>
      <div className="hidden">
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#171416]/35" />
          <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[12px] border border-[#e7e2e4] bg-white p-5 shadow-[0_20px_60px_rgba(23,20,22,0.16)] focus:outline-none sm:p-6" onEscapeKeyDown={(event) => { if (isSubmitting) event.preventDefault(); }} onInteractOutside={(event) => { if (isSubmitting) event.preventDefault(); }}>
            <div className="flex items-start justify-between gap-4">
              <div><DialogPrimitive.Title className="text-base font-semibold">{labels.title}</DialogPrimitive.Title><DialogPrimitive.Description className="mt-1 text-sm leading-5 text-[#6e676a]">{copy.overview.fileRequirements}</DialogPrimitive.Description></div>
              <DialogPrimitive.Close asChild><Button aria-label={labels.close} disabled={isSubmitting} size="icon-sm" type="button" variant="ghost"><X aria-hidden="true" className="size-4" /></Button></DialogPrimitive.Close>
            </div>
            <div className="mt-5 rounded-[10px] border border-dashed border-[#d8d2d5] bg-[#fbfafb] p-7 text-center">
              <Upload aria-hidden="true" className="mx-auto size-6 text-[#711f3a]" />
              <p className="mt-2 text-sm text-[#6e676a]">{dragActive ? labels.drop : copy.overview.choosePdf}</p>
              <input accept="application/pdf,.pdf" aria-label={copy.overview.choosePdf} className="sr-only" onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} type="file" />
              <Button autoFocus className="mt-3" onClick={() => fileInputRef.current?.click()} type="button" variant="outline">{copy.overview.choosePdf}</Button>
              <p className="mt-2 text-xs text-[#969093]">{copy.overview.noFileSent}</p>
            </div>
            {file ? <div className="mt-4 flex items-center justify-between gap-3 rounded-[8px] border border-[#e7e2e4] bg-[#fbfafb] px-3 py-2 text-sm"><span className="min-w-0 truncate"><span className="font-medium">{labels.selected}: </span>{file.name}<span className="ml-2 text-xs text-[#6e676a]">{formatDocumentFileSize(file.size, preferences.locale)}</span></span><Button aria-label={labels.close} onClick={() => { setFile(null); setValidationError(null); }} size="icon-xs" type="button" variant="ghost"><X aria-hidden="true" className="size-3.5" /></Button></div> : <p className="mt-4 text-sm text-[#969093]">{labels.empty}</p>}
            {validationError ? <p className="mt-3 text-sm text-[#a23b3b]" role="alert">{validationMessage(validationError, copy.overview)}</p> : null}
            {submitError ? <p className="mt-3 text-sm text-[#a23b3b]" role="alert">{submitError}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <DialogPrimitive.Close asChild><Button disabled={isSubmitting} type="button" variant="outline">{labels.close}</Button></DialogPrimitive.Close>
              <Button aria-busy={isSubmitting} disabled={!file || Boolean(validationError) || isSubmitting} onClick={() => void submit()} type="button">{isSubmitting ? <><LoaderCircle aria-hidden="true" className="size-4 animate-spin" />{labels.saving}</> : labels.submit}</Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </div>
    </DialogPrimitive.Root>
  );
}
