"use client";

import { useId, useRef, useState, type DragEvent, type ReactNode } from "react";

import { AppIcon } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { ProgressBar } from "@/components/ui/progress";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

/*
 * FileDropzone + FileItem — adapted from Untitled UI React
 * `components/application/file-upload/file-upload-base.tsx` (MIT): same accept/size validation
 * and drag states, native <input type=file> (keyboard: the "browse" button), StepLab copy via
 * props (no hard-coded English), AppIcon instead of @untitledui/icons, no motion dependency.
 */

function matchesAccept(file: File, accept?: string) {
  if (!accept) return true;
  return accept.split(",").map((type) => type.trim().toLowerCase()).some((type) => {
    if (type.startsWith(".")) return file.name.toLowerCase().endsWith(type);
    if (type.endsWith("/*")) return file.type.toLowerCase().startsWith(type.slice(0, -1));
    return file.type.toLowerCase() === type;
  });
}

export function formatFileSize(bytes: number) {
  if (bytes <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export type FileDropzoneProps = {
  /** Main line, e.g. "Drop a PDF here". */
  title: ReactNode;
  /** Label of the browse button inside the title row, e.g. "Choose file". */
  browseLabel: ReactNode;
  /** Constraint line, e.g. "PDF up to 20 MB". */
  hint?: ReactNode;
  accept?: string;
  maxSize?: number;
  allowsMultiple?: boolean;
  isDisabled?: boolean;
  /** Compact single row (when a list of files is already shown). */
  compact?: boolean;
  onDropFiles: (files: File[]) => void;
  onDropUnacceptedFiles?: (files: File[]) => void;
  onSizeLimitExceed?: (files: File[]) => void;
  className?: string;
};

export function FileDropzone({ title, browseLabel, hint, accept, maxSize, allowsMultiple = false, isDisabled = false, compact = false, onDropFiles, onDropUnacceptedFiles, onSizeLimitExceed, className }: FileDropzoneProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const handleFiles = (list: File[]) => {
    const files = allowsMultiple ? list : list.slice(0, 1);
    const oversized = files.filter((file) => maxSize !== undefined && file.size > maxSize);
    const rest = files.filter((file) => !oversized.includes(file));
    const accepted = rest.filter((file) => matchesAccept(file, accept));
    const rejected = rest.filter((file) => !matchesAccept(file, accept));
    setInvalid(oversized.length > 0 || rejected.length > 0);
    if (oversized.length) onSizeLimitExceed?.(oversized);
    if (rejected.length) onDropUnacceptedFiles?.(rejected);
    if (accepted.length) onDropFiles(accepted);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onDrag = (event: DragEvent<HTMLDivElement>, over: boolean) => {
    if (isDisabled) return;
    event.preventDefault();
    event.stopPropagation();
    setDragging(over);
  };

  return (
    <div
      className={cn(
        "relative flex rounded-xl bg-primary ring-1 ring-secondary ring-inset transition-[background-color,box-shadow] duration-150 ease-out",
        compact ? "items-center gap-3 px-4 py-3" : "flex-col items-center gap-3 px-6 py-6 text-center",
        dragging && "bg-brand-primary ring-2 ring-brand",
        invalid && !dragging && "ring-error_subtle",
        isDisabled && "cursor-not-allowed bg-secondary opacity-70",
        className,
      )}
      data-dragging={dragging || undefined}
      data-slot="file-dropzone"
      onDragEnter={(event) => onDrag(event, true)}
      onDragLeave={(event) => onDrag(event, false)}
      onDragOver={(event) => onDrag(event, true)}
      onDrop={(event) => { onDrag(event, false); if (!isDisabled) handleFiles(Array.from(event.dataTransfer.files)); }}
    >
      <FeaturedIcon className={cn("transition-transform duration-200 ease-out", dragging && "-translate-y-0.5 scale-105")} color={dragging ? "brand" : "gray"} icon="cloudUpload" size={compact ? "sm" : "md"} theme="modern" />
      <div className={cn("flex min-w-0 flex-col gap-1", compact && "flex-1")}>
        <div className={cn("flex flex-wrap items-center gap-x-1 text-sm", !compact && "justify-center")}>
          <input accept={accept} className="peer sr-only" disabled={isDisabled} id={id} multiple={allowsMultiple} onChange={(event) => handleFiles(Array.from(event.target.files ?? []))} ref={inputRef} tabIndex={-1} type="file" />
          <Button disabled={isDisabled} onClick={() => inputRef.current?.click()} size="sm" variant="link">{browseLabel}</Button>
          <span className="text-tertiary">{title}</span>
        </div>
        {hint ? <p className={cn("text-xs", invalid ? "text-error-primary" : "text-quaternary")}>{hint}</p> : null}
      </div>
    </div>
  );
}

export type FileItemProps = {
  name: string;
  size?: number;
  /** 0–100 while uploading; omit when done. */
  progress?: number;
  status?: Status;
  statusLabel?: ReactNode;
  removeLabel?: string;
  onRemove?: () => void;
  className?: string;
};

/** One uploaded/uploading file row. */
export function FileItem({ name, size, progress, status, statusLabel, removeLabel, onRemove, className }: FileItemProps) {
  return (
    <div className={cn("flex items-start gap-3 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset", status === "error" && "ring-error_subtle", className)} data-slot="file-item">
      <FeaturedIcon color={status === "error" ? "error" : "gray"} icon="document" size="sm" theme="modern" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-secondary">{name}</p>
            <div className="mt-0.5 flex items-center gap-2 text-sm text-tertiary">
              {size !== undefined ? <span className="tabular-nums">{formatFileSize(size)}</span> : null}
              {status && statusLabel ? <StatusBadge status={status}>{statusLabel}</StatusBadge> : null}
            </div>
          </div>
          {onRemove ? (
            <Button aria-label={removeLabel} className="-mt-1 -mr-1" onClick={onRemove} size="icon-sm" variant="tertiary">
              <AppIcon name="trash" />
            </Button>
          ) : null}
        </div>
        {progress !== undefined ? <ProgressBar label={name} showValue value={progress} /> : null}
      </div>
    </div>
  );
}
