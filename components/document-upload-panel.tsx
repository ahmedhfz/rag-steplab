"use client";

import { IconSwap } from "@/components/ui/transitions";

import { useRef, useState } from "react";

import { ApiErrorText } from "@/components/api-error-message";
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

/**
 * Documents owns persistence; parsing starts only from the Parse screen.
 * The whole drop surface is one button (click = browse, drop = upload): a tall, dashed, centred area.
 */
export function DocumentUploadPanel() {
  const { preferences } = usePreferences();
  const copy = useCopy();
  const labels = copy.documents.upload;
  const { addDocument, documents } = useDocumentPipeline();
  const dropRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<DocumentFileValidationError | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const hasDocuments = documents.length > 0;
  const hasError = Boolean(validationError || submitError);

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
      setSubmitError(error ?? new Error(labels.failed));
    } finally {
      setIsSubmitting(false);
    }
  }

  const title = isSubmitting
    ? `${labels.uploading}${selectedFile ? ` ${selectedFile.name}` : ""}`
    : dragActive ? labels.dropActive : labels.dropTitle;

  return (
    <div className="relative min-w-0" data-testid="document-upload-panel">
      <button
        aria-busy={isSubmitting}
        aria-describedby={hasError ? "document-upload-feedback" : undefined}
        className={cn(
          "group/drop relative flex min-h-37 w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-control bg-secondary_alt px-6 py-6 text-center transition-[background-color,border-color] duration-150 ease-out",
          !isSubmitting && "cursor-pointer hover:border-control_hover hover:bg-primary_hover",
          dragActive && "border-brand bg-brand-primary hover:border-brand hover:bg-brand-primary",
          hasError && !dragActive && "border-error",
          isSubmitting && "cursor-wait",
        )}
        data-dragging={dragActive || undefined}
        data-testid="pdf-drop-zone"
        ref={dropRef}
        onClick={() => { if (!isSubmitting) fileInputRef.current?.click(); }}
        onDragEnter={(event) => { event.preventDefault(); if (!isSubmitting) setDragActive(true); }}
        onDragLeave={(event) => { event.preventDefault(); if (event.currentTarget === event.target) setDragActive(false); }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; if (!isSubmitting) setDragActive(true); }}
        onDrop={(event) => { event.preventDefault(); setDragActive(false); void addFile(event.dataTransfer.files?.[0]); }}
        type="button"
      >
        {/* The idle spinner rotates inside the swap, so its corners briefly exceed the 20px icon box. */}
        <span
          aria-hidden="true"
          data-overflow-intentional=""
          className={cn(
            "relative grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-fg-brand-primary shadow-xs ring-1 ring-secondary ring-inset transition-transform duration-200 ease-out",
            dragActive && "-translate-y-0.5 scale-105",
            !isSubmitting && !dragActive && "group-hover/drop:-translate-y-0.5",
          )}
        >
          <IconSwap active={isSubmitting} first={<AppIcon name="upload" className="size-5" />} second={<AppIcon name="loading" className="size-5 animate-spin motion-reduce:animate-none" />} />
        </span>
        <span className="flex max-w-full min-w-0 flex-col items-center gap-1">
          <span className="max-w-full text-sm font-semibold text-primary wrap-anywhere">{title}</span>
          <span className="text-sm text-tertiary">
            {labels.or} <span className="font-semibold text-brand-secondary">{labels.browse}</span> · {labels.requirements}
          </span>
          {selectedFile && !isSubmitting ? <span className="max-w-full truncate text-xs text-quaternary">{selectedFile.name} · {formatDocumentFileSize(selectedFile.size, preferences.locale)}</span> : null}
        </span>
      </button>
      <input
        accept="application/pdf,.pdf"
        aria-label={labels.choosePdf}
        className="sr-only"
        onChange={(event) => { void addFile(event.target.files?.[0]); event.target.value = ""; }}
        ref={fileInputRef}
        type="file"
      />
      {validationError ? <p className="mt-2 text-sm text-error-primary" id="document-upload-feedback" role="alert">{validationMessage(validationError, copy.errors)}</p> : null}
      {submitError ? (
        <div className="mt-2 text-sm text-error-primary" id="document-upload-feedback" role="alert">
          <ApiErrorText after={<span className="block text-xs text-tertiary">{labels.retry}</span>} error={submitError} fallback={labels.failed} />
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="flex max-w-xl items-start gap-1.5 text-xs text-tertiary" data-testid="upload-privacy-note">
          <AppIcon aria-hidden="true" className="mt-px size-3.5 shrink-0 text-fg-quaternary" name="lock" />
          {labels.privacy}
        </p>
        {/* While the library is empty its empty state carries the sample CTA instead. */}
        {hasDocuments ? <SampleDocumentButton size="sm" /> : null}
      </div>
    </div>
  );
}
