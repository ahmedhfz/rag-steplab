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
  locked: "border-[#e7e2e4] bg-[#f7f5f6] text-[#969093]",
  ready: "border-[#d8b5c2] bg-[#fbf4f6] text-[#711f3a]",
  processing: "border-[#eadfc9] bg-[#fffaf1] text-[#8d651e]",
  completed: "border-[#c6ddcc] bg-[#eef4ef] text-[#3f7a55]",
  skipped: "border-[#e7e2e4] bg-[#f7f5f6] text-[#969093]",
  error: "border-[#edcfcf] bg-[#fbefef] text-[#a23b3b]",
  stale: "border-[#eadfc9] bg-[#fffaf1] text-[#8d651e]",
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
      className="border-t border-[#e7e2e4] px-4 py-7 sm:px-8"
      initial={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[#6e676a]">{description}</p>
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
    <div className="grid gap-3 border border-[#e7e2e4] bg-[#fbfafb] p-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <div><div className="text-[#969093]">{labels.run}</div><div className="mt-1 font-medium text-[#171416]">{run.status === "completed" ? labels.compatible : run.status}</div><details className="mt-2"><summary className="cursor-pointer text-[10px] text-[#6e676a]">{locale === "tr" ? "Teknik kimlik" : "Technical ID"}</summary><p className="mt-1 break-all font-mono text-[10px] text-[#6e676a]">{run.id}</p></details></div>
      <div><div className="text-[#969093]">{labels.duration}</div><div className="mt-1 font-medium text-[#171416]">{run.timing.durationMs === null ? "—" : `${run.timing.durationMs} ms`}</div></div>
      <div><div className="text-[#969093]">{labels.lineage}</div><div className="mt-1 text-[#171416]">{upstream.length ? `${upstream.length} ${locale === "tr" ? "üst akış çıktısı" : `upstream artifact${upstream.length === 1 ? "" : "s"}`}` : "—"}</div><details className="mt-2"><summary className="cursor-pointer text-[10px] text-[#6e676a]">{locale === "tr" ? "Kaynakları göster" : "Show sources"}</summary><div className="mt-1 space-y-1 break-all font-mono text-[10px] text-[#6e676a]">{upstream.length ? upstream.map(([key, value]) => <div key={key}>{key}: {value}</div>) : "—"}</div></details></div>
      <details>
        <summary className="cursor-pointer font-medium text-[#6e676a]">{labels.config}</summary>
        <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-[#6e676a]">{JSON.stringify(run.config, null, 2)}</pre>
      </details>
      {!run.isCompatible && <p className="text-[#8d651e] sm:col-span-2 lg:col-span-4" role="status"><History aria-hidden="true" className="mr-1 inline size-3.5" />{labels.incompatible}</p>}
    </div>
  );
}

export function LearningHint({ locale, children }: { locale: AppLocale; children: React.ReactNode }) {
  const { preferences } = usePreferences();
  if (!preferences.showLearningHints) return null;
  return <aside className="border-l-2 border-[#711f3a] bg-[#fbf4f6] px-3 py-2 text-xs leading-5 text-[#501329]" role="note"><span className="font-semibold">{locale === "tr" ? "Öğrenme ipucu: " : "Learning hint: "}</span>{children}</aside>;
}

export function PipelineErrorMessage({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <p className="border border-[#edcfcf] bg-[#fbefef] px-3 py-2 text-xs text-[#a23b3b]" role="alert">{message}</p>;
}

export function DisabledReason({ id, children }: { id: string; children: React.ReactNode }) {
  return <p className="mt-2 text-xs leading-5 text-[#6e676a]" id={id}>{children}</p>;
}

export function MetricCard({ label, value, description }: { label: string; value: string; description?: string }) {
  return (
    <div className="border border-[#e7e2e4] bg-white p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[#969093]">{label}</div>
      <div className="mt-2 text-xl font-semibold text-[#171416]">{value}</div>
      {description ? <p className="mt-1 text-xs leading-5 text-[#6e676a]">{description}</p> : null}
    </div>
  );
}

export function EmptyPipelineState({ children }: { children: React.ReactNode }) {
  return (
    <div aria-live="polite" className="flex min-h-24 items-center justify-center border-y border-[#e7e2e4] px-5 py-7 text-center text-sm text-[#6e676a]">
      <Clock3 aria-hidden="true" className="mr-2 size-4" />{children}
    </div>
  );
}
