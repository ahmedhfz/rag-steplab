"use client";

import { SuccessCheck, TransitionDetails, TransitionPanel, TransitionText } from "@/components/ui/transitions";


import { Badge } from "@/components/ui/badge";
import { AppIcon } from "@/components/ui/app-icon";
import type { AppLocale } from "@/lib/copy";
import type { PipelineOperationStatus } from "@/components/document-pipeline-provider";
import type { RunSummary } from "@/lib/rag-api-types";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/components/preferences-provider";

const statusCopy = {
  en: { locked: "Locked", ready: "Ready", processing: "Processing", completed: "Completed", skipped: "Skipped", error: "Error", stale: "Stale" },
  tr: { locked: "Kilitli", ready: "Hazır", processing: "İşleniyor", completed: "Tamamlandı", skipped: "Atlandı", error: "Hata", stale: "Eski" },
} as const;

const statusStyles: Record<PipelineOperationStatus, string> = {
  locked: "border-border bg-muted text-subtle-foreground",
  ready: "border-accent-border bg-accent text-brand",
  processing: "border-warning-border bg-warning-subtle text-warning",
  completed: "border-success-border bg-success-subtle text-success",
  skipped: "border-border bg-muted text-subtle-foreground",
  error: "border-destructive-border bg-destructive-subtle text-destructive",
  stale: "border-warning-border bg-warning-subtle text-warning",
};

function StatusIcon({ status }: { status: PipelineOperationStatus }) {
  if (status === "processing") return <AppIcon name="loading" className="size-3 animate-spin" />;
  if (status === "completed") return <SuccessCheck className="size-3" />;
  if (status === "skipped") return <AppIcon name="minus" className="size-3" />;
  if (status === "error") return <AppIcon name="warning" className="size-3" />;
  if (status === "stale") return <AppIcon name="history" className="size-3" />;
  if (status === "ready") return <AppIcon name="play" className="size-3" />;
  return <AppIcon name="lock" className="size-3" />;
}

export function OperationStatusBadge({ status, locale }: { status: PipelineOperationStatus; locale: AppLocale }) {
  return (
    <Badge className={cn("gap-1 rounded-md font-medium", statusStyles[status])} variant="outline">
      <StatusIcon status={status} />
      <TransitionText>{statusCopy[locale][status]}</TransitionText>
    </Badge>
  );
}

export function StageSection({
  title,
  description,
  status,
  locale,
  children,
}: {
  title: string;
  description: string;
  status: PipelineOperationStatus;
  locale: AppLocale;
  children: React.ReactNode;
}) {
  return (
    <TransitionPanel as="section"
      className="border-t border-border px-4 py-7 sm:px-8"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <OperationStatusBadge locale={locale} status={status} />
      </div>
      <div className="mt-5">{children}</div>
    </TransitionPanel>
  );
}

export function RunMetadata({ run, locale }: { run: RunSummary; locale: AppLocale }) {
  const labels = locale === "tr"
    ? { run: "Çalıştırma", duration: "Süre", lineage: "Lineage", config: "Teknik ayrıntılar", compatible: "Uyumlu", incompatible: "Bu lineage mevcut uyumluluk kurallarıyla kullanılamıyor." }
    : { run: "Run", duration: "Duration", lineage: "Lineage", config: "Technical details", compatible: "Compatible", incompatible: "This lineage is not compatible with the current contract." };
  const upstream = Object.entries(run.upstream).filter((entry): entry is [string, string] => Boolean(entry[1]));
  return (
    <div className="grid gap-3 border border-border bg-technical p-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <div><div className="text-subtle-foreground">{labels.run}</div><div className="mt-1 font-medium text-foreground">{run.status === "completed" ? labels.compatible : run.status}</div><TransitionDetails className="mt-2"><summary className="cursor-pointer text-[10px] text-muted-foreground">{locale === "tr" ? "Teknik kimlik" : "Technical ID"}</summary><p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{run.id}</p></TransitionDetails></div>
      <div><div className="text-subtle-foreground">{labels.duration}</div><div className="mt-1 font-medium text-foreground">{run.timing.durationMs === null ? "—" : `${run.timing.durationMs} ms`}</div></div>
      <div><div className="text-subtle-foreground">{labels.lineage}</div><div className="mt-1 text-foreground">{upstream.length ? `${upstream.length} ${locale === "tr" ? "üst akış çıktısı" : `upstream output${upstream.length === 1 ? "" : "s"}`}` : "—"}</div><TransitionDetails className="mt-2"><summary className="cursor-pointer text-[10px] text-muted-foreground">{locale === "tr" ? "Kaynakları göster" : "Show sources"}</summary><div className="mt-1 space-y-1 break-all font-mono text-[10px] text-muted-foreground">{upstream.length ? upstream.map(([key, value]) => <div key={key}>{key}: {value}</div>) : "—"}</div></TransitionDetails></div>
      <TransitionDetails>
        <summary className="cursor-pointer font-medium text-muted-foreground">{labels.config}</summary>
        <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-muted-foreground">{JSON.stringify(run.config, null, 2)}</pre>
      </TransitionDetails>
      {!run.isCompatible && <p className="text-warning sm:col-span-2 lg:col-span-4" role="status"><AppIcon name="history" className="mr-1 inline size-3.5" />{labels.incompatible}</p>}
    </div>
  );
}

export function LearningHint({ locale, children }: { locale: AppLocale; children: React.ReactNode }) {
  const { preferences } = usePreferences();
  if (!preferences.showLearningHints) return null;
  return (
    <TransitionDetails className="rounded-[10px] border border-brand-subtle bg-accent">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/25">
        <span>{locale === "tr" ? "Bu neden önemli?" : "Why this matters"}</span>
        <AppIcon name="chevronDown" className="size-3.5 shrink-0 text-subtle-foreground" />
      </summary>
      <div className="border-t border-brand-subtle px-3 py-2 text-xs leading-5 text-accent-foreground/75" role="note">{children}</div>
    </TransitionDetails>
  );
}

export function PipelineErrorMessage({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <p className="border border-destructive-border bg-destructive-subtle px-3 py-2 text-xs text-destructive" role="alert">{message}</p>;
}

export function DisabledReason({ id, children }: { id: string; children: React.ReactNode }) {
  return <p className="mt-2 text-xs leading-5 text-muted-foreground" id={id}>{children}</p>;
}

export function MetricCard({ label, value, description }: { label: string; value: string; description?: string }) {
  return (
    <div className="border border-border bg-card p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">{label}</div>
      <div className="mt-2 text-xl font-semibold text-foreground">{value}</div>
      {description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function EmptyPipelineState({ children }: { children: React.ReactNode }) {
  return (
    <div aria-live="polite" className="flex min-h-24 items-center justify-center border-y border-border px-5 py-7 text-center text-sm text-muted-foreground">
      <AppIcon name="clock" className="mr-2 size-4" />{children}
    </div>
  );
}

