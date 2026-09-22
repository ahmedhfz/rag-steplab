"use client";

import { useRef, useState } from "react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { usePreferences } from "@/components/preferences-provider";
import { SampleDocumentButton } from "@/components/sample-document-button";
import { AppIcon } from "@/components/ui/app-icon";
import { type AppCopy, UI_COPY } from "@/lib/copy";
import { formatDocumentFileSize, validatePdfFile, type DocumentFileValidationError } from "@/lib/document-file";
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<DocumentFileValidationError | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const labels = preferences.locale === "tr"
    ? { saving: "Yükleniyor…", drop: "PDF'yi buraya bırakın", retry: "Yeniden denemek için tıklayın veya PDF'yi bırakın." }
    : { saving: "Uploading…", drop: "Drop the PDF here", retry: "Click or drop the PDF to try again." };

  async function addFile(nextFile: File | undefined) {
    if (!nextFile || isSubmitting) return;

    const nextValidationError = validatePdfFile(nextFile);
    setSelectedFile(nextFile);
    setValidationError(nextValidationError);
    setSubmitError(null);
    if (nextValidationError) return;

    setIsSubmitting(true);
    try {
      await addDocument(nextFile);
      setSelectedFile(null);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : copy.overview.unknownParseError);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="relative" data-testid="document-upload-panel">
      <button
        aria-busy={isSubmitting}
        aria-describedby={validationError || submitError ? "document-upload-feedback" : undefined}
        className={cn(
          "mt-7 flex min-h-[148px] w-full flex-col items-center justify-center rounded-[16px] border-[1.712px] border-dashed border-input bg-surface-subtle px-6 py-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2",
          dragActive && "border-brand bg-accent",
          !isSubmitting && "cursor-pointer hover:border-brand hover:bg-accent",
          isSubmitting && "cursor-wait",
        )}
        data-testid="pdf-drop-zone"
        onClick={() => { if (!isSubmitting) fileInputRef.current?.click(); }}
        onDragEnter={(event) => { event.preventDefault(); if (!isSubmitting) setDragActive(true); }}
        onDragLeave={(event) => { event.preventDefault(); if (event.currentTarget === event.target) setDragActive(false); }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; if (!isSubmitting) setDragActive(true); }}
        onDrop={(event) => { event.preventDefault(); setDragActive(false); void addFile(event.dataTransfer.files?.[0]); }}
        type="button"
      >
        <span className="grid size-10 place-items-center rounded-[12px] bg-card text-brand shadow-[0_1px_1.5px_rgba(0,0,0,0.08)]">
          {isSubmitting ? <AppIcon name="loading" className="size-[22px] animate-spin" /> : <AppIcon name="upload" className="size-[22px]" />}
        </span>
        <span className="mt-3 text-[15px] font-medium leading-[22.5px] text-foreground">
          {isSubmitting
            ? `${labels.saving}${selectedFile ? ` ${selectedFile.name}` : ""}`
            : dragActive
              ? labels.drop
              : preferences.locale === "tr"
                ? "PDF'yi buraya sürükleyin"
                : "Drag & drop a PDF here"}
        </span>
        <span className="mt-1 text-[13px] leading-[19.5px] text-muted-foreground">
          {preferences.locale === "tr" ? "veya " : "or "}
          <span className="font-medium text-brand underline-offset-4">
            {preferences.locale === "tr" ? "dosyalarınıza göz atın" : "browse your files"}
          </span>
          {preferences.locale === "tr" ? " · PDF · en fazla 50 MB" : " · PDF · up to 50 MB"}
        </span>
        {selectedFile && !isSubmitting ? <span className="mt-3 max-w-full truncate text-xs text-muted-foreground">{selectedFile.name} · {formatDocumentFileSize(selectedFile.size, preferences.locale)}</span> : null}
      </button>
      <input
        accept="application/pdf,.pdf"
        aria-label={copy.overview.choosePdf}
        className="sr-only"
        onChange={(event) => { void addFile(event.target.files?.[0]); event.target.value = ""; }}
        ref={fileInputRef}
        type="file"
      />
      {validationError ? <p className="mt-3 text-sm text-destructive" id="document-upload-feedback" role="alert">{validationMessage(validationError, copy.overview)}</p> : null}
      {submitError ? <p className="mt-3 text-sm text-destructive" id="document-upload-feedback" role="alert">{submitError} <span className="block text-xs">{labels.retry}</span></p> : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[520px] text-xs leading-5 text-muted-foreground">{preferences.locale === "tr" ? "Yüklediğiniz PDF hesabınıza kaydedilir. Kişisel veya gizli içerik yerine örnek doküman kullanabilirsiniz." : "Uploaded PDFs are saved to your account. Use the sample instead of personal or confidential content."}</p>
        <SampleDocumentButton />
      </div>
    </div>
  );
}
