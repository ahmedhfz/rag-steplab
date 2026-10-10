"use client";

import { IconSwap } from "@/components/ui/transitions";

import { useRef, useState } from "react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { usePreferences } from "@/components/preferences-provider";
import { SampleDocumentButton } from "@/components/sample-document-button";
import { AppIcon } from "@/components/ui/app-icon";
import { type AppCopy, useCopy } from "@/lib/copy";
import { formatDocumentFileSize, validatePdfFile, type DocumentFileValidationError } from "@/lib/document-file";
import { shakeValidation } from "@/lib/transitions";
import { cn } from "@/lib/utils";

function validationMessage(error: DocumentFileValidationError, copy: AppCopy["errors"]) {
  return error === "invalidPdf" ? copy.invalidPdf : copy.fileTooLarge;
}

/** Documents owns persistence; parsing starts only from the Parse screen. */
export function DocumentUploadPanel() {
  const { preferences } = usePreferences();
  const copy = useCopy();
  const labels = copy.documents.upload;
  const { addDocument } = useDocumentPipeline();
  const dropRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<DocumentFileValidationError | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  async function addFile(nextFile: File | undefined) {
    if (!nextFile || isSubmitting) return;

    const nextValidationError = validatePdfFile(nextFile);
    setSelectedFile(nextFile);
    setValidationError(nextValidationError);
    setSubmitError(null);
    if (nextValidationError) { shakeValidation(dropRef.current); return; }

    setIsSubmitting(true);
    try {
      await addDocument(nextFile);
      setSelectedFile(null);
    } catch (error) {
      setSubmitError(error instanceof Error && error.message ? error.message : labels.failed);
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
          "mt-6 flex min-h-[148px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-input bg-surface-subtle px-6 py-6 text-center transition-colors",
          dragActive && "border-brand bg-accent",
          !isSubmitting && "cursor-pointer hover:border-hover-border hover:bg-secondary",
          isSubmitting && "cursor-wait",
        )}
        data-testid="pdf-drop-zone"
        ref={dropRef}
        onClick={() => { if (!isSubmitting) fileInputRef.current?.click(); }}
        onDragEnter={(event) => { event.preventDefault(); if (!isSubmitting) setDragActive(true); }}
        onDragLeave={(event) => { event.preventDefault(); if (event.currentTarget === event.target) setDragActive(false); }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; if (!isSubmitting) setDragActive(true); }}
        onDrop={(event) => { event.preventDefault(); setDragActive(false); void addFile(event.dataTransfer.files?.[0]); }}
        type="button"
      >
        <span className="grid size-10 place-items-center rounded-lg bg-card text-brand shadow-xs">
          <IconSwap active={isSubmitting} first={<AppIcon name="upload" className="size-5" />} second={<AppIcon name="loading" className="size-5 animate-spin" />} />
        </span>
        <span className="mt-3 max-w-full text-base font-medium text-foreground [overflow-wrap:anywhere]">
          {isSubmitting
            ? `${labels.uploading}${selectedFile ? ` ${selectedFile.name}` : ""}`
            : dragActive ? labels.dropActive : labels.dropTitle}
        </span>
        <span className="mt-1 text-sm text-muted-foreground">
          {labels.or} <span className="font-medium text-brand underline-offset-4">{labels.browse}</span> · {labels.requirements}
        </span>
        {selectedFile && !isSubmitting ? <span className="mt-3 max-w-full truncate text-xs text-muted-foreground">{selectedFile.name} · {formatDocumentFileSize(selectedFile.size, preferences.locale)}</span> : null}
      </button>
      <input
        accept="application/pdf,.pdf"
        aria-label={labels.choosePdf}
        className="sr-only"
        onChange={(event) => { void addFile(event.target.files?.[0]); event.target.value = ""; }}
        ref={fileInputRef}
        type="file"
      />
      {validationError ? <p className="mt-3 text-sm text-destructive" id="document-upload-feedback" role="alert">{validationMessage(validationError, copy.errors)}</p> : null}
      {submitError ? <p className="mt-3 text-sm text-destructive" id="document-upload-feedback" role="alert">{submitError} <span className="block text-xs">{labels.retry}</span></p> : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[520px] text-xs leading-5 text-muted-foreground" data-testid="upload-privacy-note">{labels.privacy}</p>
        <SampleDocumentButton />
      </div>
    </div>
  );
}
