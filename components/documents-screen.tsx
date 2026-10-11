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
    <div className="min-w-0 bg-background" data-testid="documents-screen">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <PageHeader data-testid="documents-page-header" description={copy.documents.description} title={copy.nav.documents} />
        <DocumentUploadPanel />
        {uploadNotice ? (
          <p aria-live="polite" className="mt-4 flex items-center gap-2 text-sm text-foreground" data-notice={uploadNotice} role="status">
            <AppIcon name="completed" className={cn("size-4 shrink-0", uploadNotice === "created" ? "text-success" : "text-muted-foreground")} />
            {uploadNotice === "reused" ? copy.documents.notice.reused : copy.documents.notice.added}
          </p>
        ) : null}
        <DocumentLibrary />
      </div>
    </div>
  );
}
