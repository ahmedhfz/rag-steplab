"use client";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { DocumentLibrary } from "@/components/document-library";
import { DocumentUploadPanel } from "@/components/document-upload-panel";
import { AppIcon } from "@/components/ui/app-icon";
import { PageHeader } from "@/components/ui/page-header";
import { useCopy } from "@/lib/copy";
import { cn } from "@/lib/utils";

export function DocumentsScreen() {
  const copy = useCopy();
  const { uploadNotice } = useDocumentPipeline();

  return (
    <div className="min-w-0" data-testid="documents-screen">
      <div className="mx-auto w-full max-w-container p-10 max-md:p-4">
        <PageHeader data-testid="documents-page-header" title={copy.nav.documents} />
        <div className="mt-8 flex flex-col gap-10">
          <div className="min-w-0">
            <DocumentUploadPanel />
            {uploadNotice ? (
              <p aria-live="polite" className="mt-3 flex items-center gap-2 text-sm font-medium text-secondary" data-notice={uploadNotice} role="status">
                <AppIcon name={uploadNotice === "created" ? "completed" : "info"} className={cn("size-4 shrink-0", uploadNotice === "created" ? "text-fg-success-primary" : "text-fg-quaternary")} />
                {uploadNotice === "reused" ? copy.documents.notice.reused : copy.documents.notice.added}
              </p>
            ) : null}
          </div>
          <DocumentLibrary />
        </div>
      </div>
    </div>
  );
}
