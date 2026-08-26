"use client";

import { AlertCircle, CheckCircle2, Clock3, History, LoaderCircle, LockKeyhole, Play } from "lucide-react";
import { motion } from "motion/react";

import { Badge } from "@/components/ui/badge";
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
  locked: "border-slate-200 bg-slate-50 text-slate-500",
  ready: "border-blue-200 bg-blue-50 text-blue-700",
  processing: "border-amber-200 bg-amber-50 text-amber-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  skipped: "border-slate-200 bg-slate-50 text-slate-500",
  error: "border-red-200 bg-red-50 text-red-700",
  stale: "border-orange-200 bg-orange-50 text-orange-700",
};

function StatusIcon({ status }: { status: PipelineOperationStatus }) {
  if (status === "processing") return <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />;
  if (status === "completed") return <CheckCircle2 aria-hidden="true" className="size-3" />;
  if (status === "skipped") return <span aria-hidden="true" className="size-3 text-center">–</span>;
  if (status === "error") return <AlertCircle aria-hidden="true" className="size-3" />;
  if (status === "stale") return <History aria-hidden="true" className="size-3" />;
  if (status === "ready") return <Play aria-hidden="true" className="size-3" />;
  return <LockKeyhole aria-hidden="true" className="size-3" />;
}

export function OperationStatusBadge({ status, locale }: { status: PipelineOperationStatus; locale: AppLocale }) {
  return (
    <Badge className={cn("gap-1 rounded-md font-medium", statusStyles[status])} variant="outline">
      <StatusIcon status={status} />
      {statusCopy[locale][status]}
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
    <motion.section
      animate={{ opacity: 1, y: 0 }}
      className="border-t px-4 py-6 sm:px-7"
      initial={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">{description}</p>
        </div>
        <OperationStatusBadge locale={locale} status={status} />
      </div>
      <div className="mt-5">{children}</div>
    </motion.section>
  );
}

export function RunMetadata({ run, locale }: { run: RunSummary; locale: AppLocale }) {
  const labels = locale === "tr"
    ? { run: "Çalıştırma", duration: "Süre", lineage: "Lineage", config: "Teknik ayrıntılar", compatible: "Uyumlu", incompatible: "Bu lineage mevcut uyumluluk kurallarıyla kullanılamıyor." }
    : { run: "Run", duration: "Duration", lineage: "Lineage", config: "Technical details", compatible: "Compatible", incompatible: "This lineage is not compatible with the current contract." };
  const upstream = Object.entries(run.upstream).filter((entry): entry is [string, string] => Boolean(entry[1]));
  return (
    <div className="grid gap-3 border bg-slate-50/60 p-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <div><div className="text-slate-500">{labels.run}</div><div className="mt-1 font-medium">{run.status === "completed" ? labels.compatible : run.status}</div><details className="mt-2"><summary className="cursor-pointer text-[10px] text-slate-500">{locale === "tr" ? "Teknik kimlik" : "Technical ID"}</summary><p className="mt-1 break-all font-mono text-[10px] text-slate-500">{run.id}</p></details></div>
      <div><div className="text-slate-500">{labels.duration}</div><div className="mt-1 font-medium">{run.timing.durationMs === null ? "—" : `${run.timing.durationMs} ms`}</div></div>
      <div><div className="text-slate-500">{labels.lineage}</div><div className="mt-1">{upstream.length ? `${upstream.length} ${locale === "tr" ? "üst akış çıktısı" : `upstream artifact${upstream.length === 1 ? "" : "s"}`}` : "—"}</div><details className="mt-2"><summary className="cursor-pointer text-[10px] text-slate-500">{locale === "tr" ? "Kaynakları göster" : "Show sources"}</summary><div className="mt-1 space-y-1 break-all font-mono text-[10px]">{upstream.length ? upstream.map(([key, value]) => <div key={key}>{key}: {value}</div>) : "—"}</div></details></div>
      <details>
        <summary className="cursor-pointer font-medium text-slate-600">{labels.config}</summary>
        <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5">{JSON.stringify(run.config, null, 2)}</pre>
      </details>
      {!run.isCompatible && <p className="text-orange-700 sm:col-span-2 lg:col-span-4" role="status"><History aria-hidden="true" className="mr-1 inline size-3.5" />{labels.incompatible}</p>}
    </div>
  );
}

export function LearningHint({ locale, children }: { locale: AppLocale; children: React.ReactNode }) {
  const { preferences } = usePreferences();
  if (!preferences.showLearningHints) return null;
  return <aside className="border-l-2 border-sky-300 bg-sky-50/60 px-3 py-2 text-xs leading-5 text-sky-900" role="note"><span className="font-semibold">{locale === "tr" ? "Öğrenme ipucu: " : "Learning hint: "}</span>{children}</aside>;
}

export function PipelineErrorMessage({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <p className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">{message}</p>;
}

export function DisabledReason({ id, children }: { id: string; children: React.ReactNode }) {
  return <p className="mt-2 text-xs leading-5 text-slate-500" id={id}>{children}</p>;
}

export function MetricCard({ label, value, description }: { label: string; value: string; description?: string }) {
  return (
    <div className="border p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
      {description ? <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p> : null}
    </div>
  );
}

export function EmptyPipelineState({ children }: { children: React.ReactNode }) {
  return (
    <div aria-live="polite" className="flex min-h-24 items-center justify-center border-y px-5 py-7 text-center text-sm text-slate-500">
      <Clock3 aria-hidden="true" className="mr-2 size-4" />{children}
    </div>
  );
}
