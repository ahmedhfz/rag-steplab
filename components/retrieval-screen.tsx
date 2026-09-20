"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { LearningHint } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { SourceInspector } from "@/components/source-inspector";
import { AppIcon } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { UI_COPY } from "@/lib/copy";
import type { ExperimentRun, ExperimentSummary, ExperimentTargetStage, RetrievalMode, StageReuseMetadata } from "@/lib/rag-api-types";
import { firstBlocker } from "@/lib/blockers";

type PlaygroundStage = "retrieval" | "reranking" | "context" | "generation";
type Locale = "en" | "tr";

function ExperimentStageTrace({
  activeStage,
  locale,
  onSelect,
  rerankerEnabled,
  run,
}: {
  activeStage: PlaygroundStage;
  locale: Locale;
  onSelect: (stage: PlaygroundStage) => void;
  rerankerEnabled: boolean;
  run: ExperimentRun | null;
}) {
  const labels = locale === "tr"
    ? { query: "Soru", retrieval: "Retrieval", reranking: "Reranking", context: "Context", answer: "Answer", queued: "Sırada", waiting: "Bekliyor", running: "Çalışıyor", completed: "Tamamlandı", skipped: "Atlandı", reused: "Yeniden kullanıldı", failed: "Başarısız" }
    : { query: "Query", retrieval: "Retrieval", reranking: "Reranking", context: "Context", answer: "Answer", queued: "Queued", waiting: "Waiting", running: "Running", completed: "Completed", skipped: "Skipped", reused: "Reused", failed: "Failed" };
  const stages = ["retrieval", "reranking", "context", "generation"] as const;
  const completedCount = stages.filter((stage) => Boolean(run?.stageResults[stage])).length;
  const statusFor = (stage: PlaygroundStage) => {
    const result = run?.stageResults[stage];
    if (result) {
      if (stage === "reranking" && "executed" in result && !result.executed) return labels.skipped;
      return result.reuse?.reused ? labels.reused : labels.completed;
    }
    if (run?.status === "queued") return stages.indexOf(stage) === 0 ? labels.queued : labels.waiting;
    if (run?.status === "running" && stages.indexOf(stage) === completedCount) return labels.running;
    if (run?.status === "failed" && stages.indexOf(stage) === completedCount) return labels.failed;
    if (stage === "reranking" && !rerankerEnabled && run?.status === "completed") return labels.skipped;
    return labels.waiting;
  };

  return (
    <ol aria-label={locale === "tr" ? "Experiment aşamaları" : "Experiment stages"} className="relative" data-testid="experiment-stage-trace">
      <li className="relative flex min-h-[37px] items-center gap-2 rounded-[10px] px-1.5 py-1.5">
        <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground"><AppIcon name="retrieve" className="size-3" /></span>
        <div className="min-w-0"><p className="text-[13px] font-medium text-foreground">{labels.query}</p><span className="sr-only">{run?.query || (locale === "tr" ? "Çalıştırılmayı bekliyor" : "Waiting to run")}</span></div>
      </li>
      {stages.map((stage) => {
        const result = run?.stageResults[stage];
        const skipped = Boolean(result && stage === "reranking" && "executed" in result && !result.executed);
        const state = statusFor(stage);
        const textClass = skipped ? "text-subtle-foreground" : result ? "text-success" : state === labels.failed ? "text-destructive" : "text-muted-foreground";
        return (
          <li className="relative min-h-[37px]" key={stage}>
            <span aria-hidden="true" className="absolute bottom-0 left-[13px] top-0 w-px bg-border" />
            <button aria-pressed={activeStage === stage} className={`relative z-10 flex min-h-[37px] w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left ${activeStage === stage ? "bg-accent" : "hover:bg-technical"}`} onClick={() => onSelect(stage)} type="button">
              <span aria-hidden="true" className={`size-3 shrink-0 rounded-full border-2 border-card ${skipped ? "bg-subtle-foreground" : result ? "bg-success" : state === labels.failed ? "bg-destructive" : "bg-brand"}`} />
              <span className={`min-w-0 flex-1 truncate text-[13px] ${activeStage === stage ? "font-medium text-accent-foreground" : "font-normal text-foreground"}`}>{stage === "generation" ? labels.answer : labels[stage]}</span>
              <span className={`shrink-0 font-mono text-[12px] ${textClass}`}>{skipped ? state : result && typeof result.durationMs === "number" ? `${result.durationMs} ms` : state}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

const DEFAULT_TOP_K = "5";
const DEFAULT_MODE: RetrievalMode = "hybrid";

function formatScore(value: number | null) {
  return value === null ? "—" : value.toFixed(4);
}

function formatDisplayScore(value: number | null) {
  return value === null ? "—" : value.toFixed(2);
}

function experimentRetrievalMode(config: Record<string, unknown>) {
  const retrieval = config.retrieval;
  if (retrieval && typeof retrieval === "object" && !Array.isArray(retrieval)) {
    const mode = (retrieval as Record<string, unknown>).mode;
    if (typeof mode === "string") return mode;
  }
  return typeof config.retrievalMode === "string" ? config.retrievalMode : typeof config.mode === "string" ? config.mode : "—";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatRunDate(run: { createdAt?: string | null; timing: { startedAt: string | null } }, locale: Locale) {
  const value = run.createdAt ?? run.timing.startedAt;
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(date);
}

function formatRunTimestamp(run: { createdAt?: string | null; timing: { startedAt: string | null } }, locale: Locale) {
  const value = run.createdAt ?? run.timing.startedAt;
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function experimentIdentity(run: { runNumber?: number | null }, fallbackNumber: number) {
  return `Experiment ${run.runNumber ?? fallbackNumber}`;
}

function savedRunMatchesDraft(
  run: ExperimentRun,
  draft: { question: string; topK: string; mode: RetrievalMode; rerankerEnabled: boolean; candidateCount: number; tokenBudget: number; temperature: number; targetStage: ExperimentTargetStage },
) {
  const config = objectValue(run.config);
  const retrieval = objectValue(config.retrieval);
  const reranking = objectValue(config.reranking);
  const context = objectValue(config.context);
  const generation = objectValue(config.generation);
  return run.query === draft.question.trim()
    && run.targetStage === draft.targetStage
    && String(retrieval.mode ?? "") === draft.mode
    && numberValue(retrieval.topK, -1) === Number(draft.topK)
    && Boolean(reranking.enabled) === draft.rerankerEnabled
    && numberValue(reranking.candidateCount, -1) === draft.candidateCount
    && numberValue(context.tokenBudget, -1) === draft.tokenBudget
    && numberValue(generation.temperature, -1) === draft.temperature;
}

function isExperimentDetail(run: ExperimentRun | ExperimentSummary): run is ExperimentRun {
  return "stageResults" in run;
}

function StageReuseBadge({
  reuse,
  stage,
  reusedLabel,
  executedLabel,
  detailsLabel,
}: {
  reuse?: StageReuseMetadata | null;
  stage: string;
  reusedLabel: string;
  executedLabel: string;
  detailsLabel: string;
}) {
  if (!reuse) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground" data-testid={`stage-reuse-${stage}`}>
      <span className={reuse.reused ? "text-brand" : "text-success"}>{reuse.reused ? reusedLabel : executedLabel}</span>
      {reuse.sourceExperimentId ? <details><summary className="cursor-pointer text-[10px] text-subtle-foreground">{detailsLabel}</summary><span className="font-mono text-[10px]">{reuse.sourceExperimentId}</span></details> : null}
    </span>
  );
}

function TopKControl({
  locale,
  onChange,
  value,
}: {
  locale: Locale;
  onChange: (value: string) => void;
  value: string;
}) {
  const numericValue = Number(value);
  const decrease = () => onChange(String(Math.max(3, numericValue - 1)));
  const increase = () => onChange(String(Math.min(10, numericValue + 1)));

  return (
    <div className="flex h-9 items-center rounded-[10px] border border-input bg-card">
      <button aria-label={locale === "tr" ? "Top-K azalt" : "Decrease Top-K"} className="grid h-full w-8 place-items-center text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:text-input" disabled={numericValue <= 3} onClick={decrease} type="button"><AppIcon name="minus" className="size-3.5" /></button>
      <Select onValueChange={onChange} value={value}>
        <SelectTrigger aria-label="Top-K" className="h-8 w-8 justify-center border-0 bg-transparent px-0 text-[13px] shadow-none [&>svg]:hidden">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="3">3</SelectItem>
          <SelectItem value="4">4</SelectItem>
          <SelectItem value="5">5</SelectItem>
          <SelectItem value="6">6</SelectItem>
          <SelectItem value="7">7</SelectItem>
          <SelectItem value="8">8</SelectItem>
          <SelectItem value="9">9</SelectItem>
          <SelectItem value="10">10</SelectItem>
        </SelectContent>
      </Select>
      <button aria-label={locale === "tr" ? "Top-K artır" : "Increase Top-K"} className="grid h-full w-8 place-items-center text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:text-input" disabled={numericValue >= 10} onClick={increase} type="button"><AppIcon name="plus" className="size-3.5" /></button>
    </div>
  );
}

function BlockerState({
  href,
  message,
  locale,
}: {
  href: string | null;
  message: string;
  locale: Locale;
}) {
  const labels = locale === "tr"
    ? { title: "Aksiyon bekliyor", action: "Git", documents: "Dokümanlar", parse: "Parse", chunking: "Chunking", embeddings: "Embeddings" }
    : { title: "Action blocked", action: "Go to", documents: "Documents", parse: "Parsing", chunking: "Chunking", embeddings: "Embeddings" };
  const destination = href === "/embeddings" ? labels.embeddings : href === "/chunking" ? labels.chunking : href === "/parse" ? labels.parse : labels.documents;

  return (
    <section aria-live="polite" className="mt-5 flex min-h-12 max-w-[760px] items-center gap-3 rounded-[12px] border border-warning-border bg-warning-subtle px-3 py-2.5" data-testid="playground-blocker" role="status">
      <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-warning-icon text-xs text-warning"><AppIcon name="warning" className="size-3.5" /></span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-warning">{labels.title}</h2>
          <p className="text-xs leading-5 text-warning">{message}</p>
        </div>
        {href ? <Link className="shrink-0 text-xs font-medium text-brand underline underline-offset-2 hover:text-accent-foreground" href={href}>{labels.action} {destination}</Link> : null}
      </div>
    </section>
  );
}

function ExperimentErrorSurface({
  error,
  locale,
}: {
  error: { code?: string | null; message?: string | null } | null;
  locale: Locale;
}) {
  if (error?.code === "run_poll_timeout") return (
    <section className="mt-8 rounded-[16px] border border-warning-border bg-warning-subtle p-5 text-sm text-warning" data-testid="playground-tracking-paused" role="status">
      {locale === "tr" ? "Tarayıcı takibi duraklatıldı. Run arka planda devam ediyor olabilir; güncel durumu görmek için takibi sürdürün." : "Browser tracking paused. The run may still be active; resume tracking to check its current status."}
    </section>
  );
  const labels = locale === "tr"
    ? { title: "Deney tamamlanamadı", message: "Bu deney tamamlanamadı. Tekrar deneyin veya ayrıntıları inceleyin.", details: "Ayrıntılar", code: "Kod", messageLabel: "Mesaj" }
    : { title: "Experiment couldn’t be completed", message: "We couldn’t complete this experiment. Try again or review the details.", details: "Details", code: "Code", messageLabel: "Message" };

  return (
    <section aria-live="assertive" className="mt-8 rounded-[16px] border border-destructive-border bg-destructive-panel p-5" data-testid="playground-error" role="alert">
      <h2 className="text-[15px] font-semibold text-destructive">{labels.title}</h2>
      <p className="mt-1 text-sm leading-5 text-destructive">{labels.message}</p>
      {error?.code || error?.message ? <details className="mt-3 rounded-[10px] border border-destructive-border bg-card/60 px-3 py-2 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium text-destructive">{labels.details}</summary><dl className="mt-2 grid gap-1"><div><dt className="inline font-medium">{labels.code}: </dt><dd className="inline font-mono">{error.code || "—"}</dd></div><div><dt className="inline font-medium">{labels.messageLabel}: </dt><dd className="inline break-words">{error.message || "—"}</dd></div></dl></details> : null}
    </section>
  );
}

function ExperimentDetails({ run, locale }: { run: ExperimentRun; locale: Locale }) {
  const labels = locale === "tr"
    ? { details: "Ayrıntılar", configuration: "Yapılandırma", provenance: "Provenance", output: "Output", identifiers: "Identifiers", mode: "Mod", topK: "Top K", reranker: "Reranker", target: "Hedef aşama", candidates: "Aday sayısı", budget: "Token bütçesi", temperature: "Temperature", status: "Durum", duration: "Süre", reuse: "Reuse", current: "Aktif pipeline", historical: "Geçmiş run", document: "Doküman", chunk: "Chunk", embedding: "Embedding", fingerprint: "Fingerprint", result: "Sonuç", contextUsage: "Context kullanımı", citations: "Citations", answerReady: "Cevap hazır", insufficientContext: "Yeterli context yok", contextBuilt: "Context oluşturuldu", rerankingComplete: "Adaylar yeniden sıralandı", retrievalComplete: "Adaylar getirildi" }
    : { details: "Details", configuration: "Configuration", provenance: "Provenance", output: "Output", identifiers: "Identifiers", mode: "Mode", topK: "Top K", reranker: "Reranker", target: "Target stage", candidates: "Candidate count", budget: "Token budget", temperature: "Temperature", status: "Status", duration: "Duration", reuse: "Reuse", current: "Current pipeline", historical: "Historical run", document: "Document", chunk: "Chunk", embedding: "Embedding", fingerprint: "Fingerprint", result: "Result", contextUsage: "Context usage", citations: "Citations", answerReady: "Answer available", insufficientContext: "Insufficient context", contextBuilt: "Context built", rerankingComplete: "Candidates reranked", retrievalComplete: "Candidates retrieved" };
  const retrieval = objectValue(run.config.retrieval);
  const reranking = objectValue(run.config.reranking);
  const context = objectValue(run.config.context);
  const generation = objectValue(run.config.generation);
  const duration = run.timing.durationMs === null ? "—" : `${run.timing.durationMs} ms`;
  const outputResult = run.stageResults.generation
    ? run.stageResults.generation.insufficientContext ? labels.insufficientContext : labels.answerReady
    : run.stageResults.context ? labels.contextBuilt
      : run.stageResults.reranking?.executed ? labels.rerankingComplete
        : labels.retrievalComplete;
  const contextUsage = run.stageResults.context ? `${run.stageResults.context.tokenCount} / ${run.stageResults.context.tokenBudget}` : "—";
  const citationCount = run.stageResults.generation ? String(run.stageResults.generation.citations.length) : "—";

  return (
    <details className="mt-4 rounded-[12px] border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13px] font-medium text-foreground"><span>{labels.details}</span><AppIcon name="chevronDown" className="size-4 text-subtle-foreground" /></summary>
      <div className="grid gap-5 border-t border-border p-4 text-xs sm:grid-cols-2">
        <section>
          <h3 className="font-semibold text-foreground">{labels.configuration}</h3>
          <dl className="mt-2 grid gap-1.5 text-muted-foreground">
            <div className="flex justify-between gap-3"><dt>{labels.mode}</dt><dd className="font-mono text-foreground">{String(retrieval.mode ?? experimentRetrievalMode(run.config))}</dd></div>
            <div className="flex justify-between gap-3"><dt>{labels.topK}</dt><dd className="font-mono text-foreground">{String(retrieval.topK ?? "—")}</dd></div>
            <div className="flex justify-between gap-3"><dt>{labels.reranker}</dt><dd className="text-foreground">{Boolean(reranking.enabled) ? "On" : "Off"}</dd></div>
            <div className="flex justify-between gap-3"><dt>{labels.target}</dt><dd className="text-foreground">{run.targetStage}</dd></div>
            <div className="flex justify-between gap-3"><dt>{labels.candidates}</dt><dd className="font-mono text-foreground">{String(reranking.candidateCount ?? "—")}</dd></div>
            <div className="flex justify-between gap-3"><dt>{labels.budget}</dt><dd className="font-mono text-foreground">{String(context.tokenBudget ?? "—")}</dd></div>
            <div className="flex justify-between gap-3"><dt>{labels.temperature}</dt><dd className="font-mono text-foreground">{String(generation.temperature ?? "—")}</dd></div>
          </dl>
        </section>
        <section>
          <h3 className="font-semibold text-foreground">{labels.provenance}</h3>
          <dl className="mt-2 grid gap-1.5 text-muted-foreground">
            <div className="flex justify-between gap-3"><dt>{labels.status}</dt><dd className="text-foreground">{run.historicalLineage ? labels.historical : labels.current}</dd></div>
            <div className="flex justify-between gap-3"><dt>{labels.target}</dt><dd className="text-foreground">{run.targetStage}</dd></div>
            <div className="flex justify-between gap-3"><dt>{labels.duration}</dt><dd className="font-mono text-foreground">{duration}</dd></div>
            <div className="flex justify-between gap-3"><dt>{labels.reuse}</dt><dd className="text-foreground">{run.reusedExperiment ? "Reused" : "Executed"}</dd></div>
          </dl>
          <details className="mt-3 rounded-[10px] border border-border px-3 py-2">
            <summary className="cursor-pointer font-medium text-muted-foreground">{labels.identifiers}</summary>
            <dl className="mt-2 grid gap-1.5 break-all font-mono text-[11px] text-muted-foreground">
              <div><dt className="inline font-sans font-medium">{labels.document}: </dt><dd className="inline">{run.documentId}</dd></div>
              <div><dt className="inline font-sans font-medium">{labels.chunk}: </dt><dd className="inline">{run.chunkRunId}</dd></div>
              <div><dt className="inline font-sans font-medium">{labels.embedding}: </dt><dd className="inline">{run.embeddingRunId || "—"}</dd></div>
              <div><dt className="inline font-sans font-medium">{labels.fingerprint}: </dt><dd className="inline">{run.experimentFingerprint || "—"}</dd></div>
            </dl>
          </details>
        </section>
        <section className="sm:col-span-2">
          <h3 className="font-semibold text-foreground">{labels.output}</h3>
          <dl className="mt-2 grid gap-1.5 text-muted-foreground sm:grid-cols-3">
            <div className="flex justify-between gap-3 sm:block"><dt>{labels.result}</dt><dd className="text-foreground sm:mt-1">{outputResult}</dd></div>
            <div className="flex justify-between gap-3 sm:block"><dt>{labels.contextUsage}</dt><dd className="font-mono text-foreground sm:mt-1">{contextUsage}</dd></div>
            <div className="flex justify-between gap-3 sm:block"><dt>{labels.citations}</dt><dd className="font-mono text-foreground sm:mt-1">{citationCount}</dd></div>
          </dl>
        </section>
      </div>
    </details>
  );
}

export function RetrievalScreen() {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const {
    activeDocument,
    parseResult,
    selectedChunkRunId,
    selectedEmbeddingRunId,
    experimentStatus,
    experimentRun,
    experimentError,
    experimentHistory,
    runExperiment,
    loadExperiment,
    resumeRunTracking,
    continueExperiment,
    rerunGeneration,
  } = useDocumentPipeline();
  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(DEFAULT_TOP_K);
  const [mode, setMode] = useState<RetrievalMode>(DEFAULT_MODE);
  const [rerankerEnabled, setRerankerEnabled] = useState(false);
  const [candidateCount, setCandidateCount] = useState(10);
  const [tokenBudget, setTokenBudget] = useState(3000);
  const [temperature, setTemperature] = useState(0.1);
  const [targetStage, setTargetStage] = useState<ExperimentTargetStage>("generation");
  const [activeStage, setActiveStage] = useState<PlaygroundStage>("retrieval");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const draftRunIdRef = useRef<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const restoreDraft = useCallback((run: ExperimentRun) => {
    const retrieval = objectValue(run.config.retrieval);
    setQuestion(run.query);
    setTopK(String(numberValue(retrieval.topK, 5)));
    const savedMode = experimentRetrievalMode(run.config);
    setMode(savedMode === "keyword" || savedMode === "dense" ? savedMode : "hybrid");
    setRerankerEnabled(Boolean(objectValue(run.config.reranking).enabled));
    setCandidateCount(numberValue(objectValue(run.config.reranking).candidateCount, 10));
    setTokenBudget(numberValue(objectValue(run.config.context).tokenBudget, 3000));
    setTemperature(numberValue(objectValue(run.config.generation).temperature, 0.1));
    setTargetStage(run.targetStage);
  }, []);
  // Hydrate only when the selected run changes, never on polling updates.
  useEffect(() => {
    if (!experimentRun || experimentRun.id === draftRunIdRef.current) return;
    draftRunIdRef.current = experimentRun.id;
    restoreDraft(experimentRun);
    setCopyStatus("idle");
  }, [experimentRun, restoreDraft]);
  useEffect(() => {
    if (copyStatus === "idle") return;
    const timeout = window.setTimeout(() => setCopyStatus("idle"), 2_000);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);
  async function copyTrace() {
    setCopyStatus("idle");
    try {
      await navigator.clipboard.writeText(JSON.stringify(experimentRun, null, 2));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }
  const hasChanges = question.length > 0 || topK !== DEFAULT_TOP_K || mode !== DEFAULT_MODE || rerankerEnabled || candidateCount !== 10 || tokenBudget !== 3000 || temperature !== 0.1 || targetStage !== "generation";
  const needsEmbedding = mode !== "keyword";
  const askBlocker = firstBlocker(preferences.locale, [
    [experimentStatus === "processing", "processing"],
    [!activeDocument?.id, "missing_document"],
    [!selectedChunkRunId, "missing_chunk"],
    [!question.trim(), "missing_question"],
    [needsEmbedding && !selectedEmbeddingRunId, "missing_embedding"],
  ]);
  const canAsk = !askBlocker;
  const labels = preferences.locale === "tr" ? {
    target: "Hedef aşama", retrieval: "Retrieval", retrievalControl: "Retrieval", reranking: "Reranking", context: "Context construction", generation: "Generation", runExperiment: "Deneyi çalıştır", advanced: "Gelişmiş ayarlar",
    candidateCount: "Rerank aday sayısı", tokenBudget: "Context token bütçesi", temperature: "Temperature", originalRank: "İlk sıra", rerankedPosition: "Reranked pozisyon", selected: "Seçildi", excluded: "Elendi", reason: "Karar", tokens: "Token",
    answer: "Cevap", citations: "Citations", citationValid: "Citation reference valid", citationInvalid: "Citation reference incelenmeli", history: "Run history", compare: "Karşılaştır", selectedRuns: "Seçili run", candidates: "Aday", skipped: "Atlandı", details: "Ayrıntılar", configuration: "Yapılandırma", provenance: "Provenance", output: "Output", identifiers: "Identifiers",
    reused: "Yeniden kullanıldı", executed: "Çalıştırıldı", load: "Yükle", continue: "Devam et", runAgain: "Generation'ı tekrar çalıştır", exactReuse: "Aynı experiment yüklendi", viewing: "Görüntüleniyor", unsaved: "Kaydedilmemiş değişiklikler", running: "Deney çalışıyor…", blocked: "Aksiyon bekliyor", goTo: "Git", currentActions: "Aksiyonlar", noRun: "Bu aşama için henüz çıktı yok.", noAnswer: "Bu experiment için cevap çıktısı yok.", noCandidates: "Bu aşama için aday çıktısı yok.",
  } : {
    target: "Target stage", retrieval: "Retrieval", retrievalControl: "Retrieval", reranking: "Reranking", context: "Context construction", generation: "Generation", runExperiment: "Run experiment", advanced: "Advanced settings",
    candidateCount: "Rerank candidate count", tokenBudget: "Context token budget", temperature: "Temperature", originalRank: "Original rank", rerankedPosition: "Reranked position", selected: "Selected", excluded: "Excluded", reason: "Decision", tokens: "Tokens",
    answer: "Answer", citations: "Citations", citationValid: "Citation reference valid", citationInvalid: "Citation reference needs review", history: "Run history", compare: "Compare", selectedRuns: "Selected runs", candidates: "Candidates", skipped: "Skipped", details: "Details", configuration: "Configuration", provenance: "Provenance", output: "Output", identifiers: "Identifiers",
    reused: "Reused", executed: "Executed", load: "Load", continue: "Continue", runAgain: "Run generation again", exactReuse: "Exact experiment loaded", viewing: "Viewing", unsaved: "Unsaved changes", running: "Running experiment…", blocked: "Action blocked", goTo: "Go to", currentActions: "Actions", noRun: "No output for this stage yet.", noAnswer: "No answer output is available for this experiment.", noCandidates: "No candidate output is available for this stage.",
  };
  const workspaceCopy = preferences.locale === "tr"
    ? {
        description: "Bir soru sorun ve RAG sisteminizin cevaba nasıl ulaştığını inceleyin.", placeholder: "Dokümanınıza sorun…", questionHelp: "Aynı soruyu farklı retrieval ayarlarıyla çalıştırarak aday ve cevap değişimini karşılaştırın.", stageTrace: "STAGE TRACE", retrievedTitle: "Getirilen adaylar", retrievedDescription: "En olası chunk'lar; henüz final context değiller.", contextTitle: "Context oluştur", contextDescription: "Token bütçesine uyan içerik modele gönderilir.", answerDescription: "Cevap final context'e dayanır ve kaynaklara bağlanır.", readyTitle: "RAG'inizi test etmeye hazır", readyDescription: "Başlamak için bir soru sorun.", viewSource: "Kaynağı görüntüle", finalContext: "Final context", expandContext: "Output'u göster", sources: "Kaynaklar", complete: "Tamamlandı", candidate: "Aday", included: "Dahil edildi", excluded: "Çıkarıldı", noStageResult: "Bu aşama için henüz çıktı yok.", sourceDocument: "Kaynak doküman",
      }
    : {
        description: "Ask a question and inspect how your RAG system reaches the answer.", placeholder: "Ask your document…", questionHelp: "Run the same question with different retrieval settings to compare candidate and answer changes.", stageTrace: "STAGE TRACE", retrievedTitle: "Retrieved candidates", retrievedDescription: "The most likely chunks; not yet the final context.", contextTitle: "Build context", contextDescription: "Only content that fits the token budget reaches the model.", answerDescription: "The answer uses final context and links to its sources.", readyTitle: "Ready to test your RAG", readyDescription: "Ask a question to begin.", viewSource: "View source", finalContext: "Final context", expandContext: "Show output", sources: "Sources", complete: "Complete", candidate: "Candidate", included: "Included", excluded: "Excluded", noStageResult: "No output for this stage yet.", sourceDocument: "Source document",
      };
  const selectedComparisonRuns = useMemo(() => experimentHistory.filter((run): run is ExperimentRun => compareIds.includes(run.id) && isExperimentDetail(run)), [compareIds, experimentHistory]);
  const results = experimentRun?.stageResults;
  const resultMode = experimentRun ? experimentRetrievalMode(experimentRun.config) : mode;
  const blockerMessage = (() => {
    if (!askBlocker) return "";
    if (askBlocker.code === "processing") return preferences.locale === "tr" ? "Mevcut deney tamamlanana kadar bekleyin." : "Wait for the current experiment to finish.";
    if (askBlocker.code === "missing_document") return preferences.locale === "tr" ? "Bir doküman seçin ve indexing kurulumunu tamamlayın." : "Select a document and complete indexing setup first.";
    if (askBlocker.code === "missing_parse") return preferences.locale === "tr" ? "Devam etmeden önce dokümanı ayrıştırın." : "Parse the document before continuing.";
    if (askBlocker.code === "missing_chunk") return preferences.locale === "tr" ? "Deney çalıştırmadan önce chunking'i tamamlayın." : "Complete chunking before running an experiment.";
    if (askBlocker.code === "missing_embedding") return preferences.locale === "tr" ? "Dense ve hybrid retrieval için embedding oluşturun veya Keyword seçin." : "Dense and hybrid retrieval require embeddings. Create embeddings first, or switch to Keyword.";
    if (askBlocker.code === "missing_question") return preferences.locale === "tr" ? "Deneyi çalıştırmak için bir soru girin." : "Enter a question to run an experiment.";
    if (askBlocker.code === "missing_pipeline") return preferences.locale === "tr" ? "Devam etmek için bir indexing pipeline seçin." : "Select an indexing pipeline to continue.";
    return preferences.locale === "tr" ? "Devam etmeden önce gerekli ayarı tamamlayın." : "Complete the required setup before continuing.";
  })();
  const blockerHref = askBlocker?.code === "missing_embedding"
    ? "/embeddings"
    : askBlocker?.code === "missing_chunk"
      ? "/chunking"
      : askBlocker?.code === "missing_parse"
        ? "/parse"
        : askBlocker?.code === "missing_document"
          ? "/documents"
          : askBlocker?.code === "missing_pipeline"
            ? "/"
            : null;
  const savedRunMatches = experimentRun ? savedRunMatchesDraft(experimentRun, { question, topK, mode, rerankerEnabled, candidateCount, tokenBudget, temperature, targetStage }) : false;
  const canContinue = Boolean(experimentRun && experimentRun.status === "completed" && experimentRun.targetStage !== "generation" && experimentStatus !== "processing");
  const canRerunGeneration = Boolean(experimentRun && experimentRun.status === "completed" && results?.generation && experimentStatus !== "processing");
  const hasRunError = Boolean(experimentError || experimentRun?.status === "failed");

  function reset() {
    setQuestion("");
    setTopK(DEFAULT_TOP_K);
    setMode(DEFAULT_MODE);
    setRerankerEnabled(false);
    setCandidateCount(10);
    setTokenBudget(3000);
    setTemperature(0.1);
    setTargetStage("generation");
  }

  function submit() {
    if (!canAsk) return;
    setActiveStage(targetStage);
    void runExperiment({
      query: question.trim(),
      targetStage,
      retrieval: { mode, topK: Number(topK) },
      reranking: { enabled: rerankerEnabled, candidateCount },
      context: { tokenBudget },
      generation: { temperature, maxOutputTokens: 1024 },
    });
  }

  function toggleCompare(runId: string) {
    setCompareIds((current) => current.includes(runId) ? current.filter((id) => id !== runId) : current.length < 2 ? [...current, runId] : [current[1], runId]);
  }

  return (
    <div className="min-w-0 overflow-x-clip bg-background" data-testid="playground-screen">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <header className="h-[92px]" data-testid="playground-page-header">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-brand">TEST</p>
          <h1 className="mt-1 text-[30px] font-semibold leading-9 tracking-[-0.02em] text-foreground">{copy.retrieval.title}</h1>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{workspaceCopy.description}</p>
        </header>

        <section aria-label={copy.retrieval.title} className="mt-8 rounded-[16px] border border-border bg-card p-3" data-testid="playground-input">
          <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <div className="flex items-center gap-3 max-md:flex-col max-md:items-stretch">
              <div className="relative min-w-0 flex-1">
                <label className="sr-only" htmlFor="retrieval-question">{copy.retrieval.question}</label>
                <textarea aria-label={copy.retrieval.question} className="block h-[60px] w-full resize-none rounded-[10px] border-0 px-3 py-2 text-base leading-6 text-foreground outline-none placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-ring/15" data-testid="playground-question" id="retrieval-question" onChange={(event) => setQuestion(event.target.value)} placeholder={workspaceCopy.placeholder} value={question} />
                {question ? <div className="absolute right-1.5 top-1.5"><Button aria-label={copy.retrieval.clearQuestion} onClick={() => setQuestion("")} size="icon-xs" type="button" variant="ghost"><AppIcon name="close" className="size-3.5" /></Button></div> : null}
              </div>
              <Button aria-busy={experimentStatus === "processing"} aria-describedby={!canAsk ? "ask-disabled-reason" : undefined} className="h-10 min-w-[164px] gap-2 rounded-[9px] px-4 text-[13px] max-md:w-full" data-testid="playground-run-cta" disabled={!canAsk} type="submit">
                <AppIcon name="generate" className="size-4" />{labels.runExperiment}
              </Button>
            </div>
            {!canAsk ? <span className="sr-only" id="ask-disabled-reason">{blockerMessage}</span> : null}
          </form>

          <div className="mt-3 grid grid-cols-[max-content_max-content_max-content] items-end gap-3 border-t border-border px-3 pt-3 max-sm:grid-cols-2" data-testid="playground-primary-controls">
            <fieldset className="min-w-0 max-sm:col-span-2">
              <legend className="mb-1.5 block text-[12px] font-medium leading-4 text-muted-foreground">{labels.retrievalControl}</legend>
              <div aria-label={copy.retrieval.mode} className="flex h-9 min-w-0 items-center rounded-[9px] border border-border bg-secondary p-1 max-sm:w-full" data-testid="playground-mode-control" role="group">
                {(["dense", "hybrid", "keyword"] as const).map((value) => <button aria-pressed={mode === value} className={mode === value ? "h-full rounded-[7px] bg-card px-3 text-[12px] font-medium text-foreground shadow-sm max-sm:flex-1" : "h-full rounded-[7px] px-2.5 text-[12px] font-medium text-muted-foreground hover:bg-card/70 max-sm:flex-1"} key={value} onClick={() => setMode(value)} type="button">{copy.retrieval.modes[value]}</button>)}
              </div>
            </fieldset>
            <div>
              <span className="mb-1.5 block text-[12px] font-medium leading-4 text-muted-foreground">{copy.retrieval.topK}</span>
              <div data-testid="playground-top-k-control"><TopKControl locale={preferences.locale} onChange={setTopK} value={topK} /></div>
            </div>
            <div>
              <span className="mb-1.5 block text-[12px] font-medium leading-4 text-muted-foreground">{copy.retrieval.reranker}</span>
              <label className="flex h-9 min-w-[108px] items-center justify-between gap-3 rounded-[9px] border border-input bg-card pl-3 pr-1 text-[12px] font-medium text-muted-foreground" data-testid="playground-reranker-control" htmlFor="reranker-enabled">
                <span>{rerankerEnabled ? (preferences.locale === "tr" ? "Açık" : "On") : (preferences.locale === "tr" ? "Kapalı" : "Off")}</span>
                <Switch aria-label={copy.retrieval.reranker} checked={rerankerEnabled} className="h-9" id="reranker-enabled" onCheckedChange={setRerankerEnabled} />
              </label>
            </div>
          </div>

          <div className="mx-3 mt-3 grid gap-2 md:grid-flow-col md:auto-cols-fr" data-testid="playground-utilities">
            {preferences.showLearningHints ? <div data-testid="playground-question-help"><LearningHint locale={preferences.locale}>{workspaceCopy.questionHelp}</LearningHint></div> : null}
            <details className="rounded-[10px] border border-border bg-card" data-testid="playground-advanced">
              <summary className="flex h-10 cursor-pointer list-none items-center justify-between px-3.5 text-[12.5px] font-medium text-foreground"><span>{labels.advanced}</span><AppIcon name="chevronDown" className="size-3.5 text-subtle-foreground" /></summary>
              <div className="grid gap-3 border-t border-border p-3.5 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-xs font-medium text-foreground" htmlFor="target-stage">{labels.target}<Select onValueChange={(value) => setTargetStage(value as ExperimentTargetStage)} value={targetStage}><SelectTrigger className="mt-1.5 h-9 text-[13px]" id="target-stage"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="retrieval">{labels.retrieval}</SelectItem><SelectItem value="reranking">{labels.reranking}</SelectItem><SelectItem value="context">{labels.context}</SelectItem><SelectItem value="generation">{labels.generation}</SelectItem></SelectContent></Select></label>
                <label className="text-xs font-medium text-foreground" htmlFor="candidate-count">{labels.candidateCount}<Input className="mt-1.5 h-9 text-[13px]" disabled={!rerankerEnabled} id="candidate-count" max={20} min={1} onChange={(event) => setCandidateCount(Number(event.target.value))} type="number" value={candidateCount} /></label>
                <label className="text-xs font-medium text-foreground" htmlFor="context-budget">{labels.tokenBudget}<Input className="mt-1.5 h-9 text-[13px]" id="context-budget" max={12000} min={256} onChange={(event) => setTokenBudget(Number(event.target.value))} type="number" value={tokenBudget} /></label>
                <label className="text-xs font-medium text-foreground" htmlFor="generation-temperature">{labels.temperature}<Input className="mt-1.5 h-9 text-[13px]" id="generation-temperature" max={2} min={0} onChange={(event) => setTemperature(Number(event.target.value))} step="0.1" type="number" value={temperature} /></label>
              </div>
              <div className="flex justify-end border-t border-border px-3.5 py-2.5"><Button aria-describedby={!hasChanges ? "retrieval-reset-disabled-reason" : undefined} className="gap-2" disabled={!hasChanges} onClick={reset} size="sm" variant="ghost"><AppIcon name="reset" className="size-4" />{copy.retrieval.reset}</Button></div>
              {!hasChanges ? <span className="sr-only" id="retrieval-reset-disabled-reason">{copy.retrieval.nothingToReset}</span> : null}
            </details>
          </div>

          {!hasRunError && experimentStatus === "processing" && experimentRun ? <div className="mx-3 mt-2 rounded-[9px] border border-accent-border bg-accent px-3 py-2 text-xs text-brand" data-testid="playground-run-state" role="status"><span className="font-medium">{labels.running}</span></div> : null}
          {!hasRunError && experimentStatus !== "processing" && experimentRun?.status === "completed" ? <div className={savedRunMatches ? "mx-3 mt-2 rounded-[9px] border border-success-border bg-success-subtle px-3 py-2 text-xs text-success" : "mx-3 mt-2 rounded-[9px] border border-warning-border bg-warning-subtle px-3 py-2 text-xs text-warning"} data-testid="playground-run-state" role="status"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-medium">{labels.viewing}</span><strong>{experimentIdentity(experimentRun, 1)}</strong>{formatRunDate(experimentRun, preferences.locale) ? <span>· {formatRunDate(experimentRun, preferences.locale)}</span> : null}{!savedRunMatches ? <><span>·</span><span>{labels.unsaved}</span></> : null}</div>{experimentRun.reusedExperiment ? <span className="sr-only">{labels.exactReuse}</span> : null}</div> : null}
        </section>

        {hasRunError ? <ExperimentErrorSurface error={experimentError} locale={preferences.locale} /> : null}
        {!experimentRun && !hasRunError && askBlocker ? <BlockerState href={blockerHref} locale={preferences.locale} message={blockerMessage} /> : null}
        {!experimentRun && !hasRunError && !askBlocker ? <section className="mt-5 flex min-h-[210px] items-center justify-center rounded-[16px] border border-border bg-card px-5 text-center"><div className="max-w-[360px]"><span aria-hidden="true" className="mx-auto grid size-12 place-items-center rounded-[14px] bg-accent text-brand"><AppIcon name="retrieve" className="size-5" /></span><h2 className="mt-4 text-[17px] font-semibold text-foreground">{workspaceCopy.readyTitle}</h2><p className="mt-2 text-sm leading-5 text-muted-foreground">{workspaceCopy.readyDescription}</p></div></section> : null}

        {experimentRun ? <>
          <div className="mt-7 grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]" data-testid="playground-stage-layout">
            <aside className="min-w-0" data-testid="playground-stage-rail">
              <p className="text-[13px] font-semibold uppercase tracking-[0.05em] text-subtle-foreground">{workspaceCopy.stageTrace}</p>
              <div className="mt-3 rounded-[16px] border border-border bg-card p-4"><ExperimentStageTrace activeStage={activeStage} locale={preferences.locale} onSelect={setActiveStage} rerankerEnabled={rerankerEnabled} run={experimentRun} /></div>
            </aside>

            <section className="min-w-0" data-testid="playground-stage-content">
              {activeStage === "retrieval" ? <>
                <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-[18px] font-semibold text-foreground">{workspaceCopy.retrievedTitle}</h2><p className="mt-1 max-w-[560px] text-[13.5px] leading-5 text-muted-foreground">{workspaceCopy.retrievedDescription}</p></div>{results?.retrieval ? <span className="rounded-full bg-success-subtle px-3 py-1 text-[12px] font-medium text-success">{resultMode} · {results.retrieval.candidates.length} {labels.candidates.toLowerCase()}</span> : null}</div>
                <div className="mt-5 overflow-hidden rounded-[16px] border border-border bg-card">
                  {results?.retrieval?.candidates.length ? <div className="divide-y divide-border">{results.retrieval.candidates.map((candidate) => <article className="p-4 sm:p-5" key={candidate.chunkId}><div className="flex min-w-0 items-start gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-secondary font-mono text-[12px] text-foreground">{candidate.rank}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 text-[13px] font-medium text-brand">{candidate.headingPath?.join(" › ") || workspaceCopy.sourceDocument}</p><span className="shrink-0 font-mono text-[12px] text-muted-foreground">{formatDisplayScore(candidate.score)} · p.{candidate.pageNumbers.join(", ") || "—"}</span></div><p className="mt-2 line-clamp-3 break-words text-sm leading-5 text-muted-foreground">{candidate.text}</p><div className="mt-3"><SourceInspector documentId={activeDocument?.id ?? null} headingPath={candidate.headingPath} pageNumbers={candidate.pageNumbers} parseResult={parseResult} sourceElementIds={candidate.sourceElementIds} triggerAriaLabel={preferences.locale === "tr" ? "Kaynağı incele" : "Inspect source"} triggerLabel={workspaceCopy.viewSource} /></div><details className="mt-3 border-t border-border pt-3"><summary className="flex cursor-pointer list-none items-center justify-between text-[12px] font-medium text-muted-foreground"><span>{labels.details}</span><AppIcon name="chevronDown" className="size-4 text-subtle-foreground" /></summary><div className="mt-2 text-[11px] leading-5 text-muted-foreground"><p>{labels.provenance}: {candidate.sourceElementIds.join(", ") || "—"}</p><p className="font-mono">Dense {formatScore(candidate.denseScore)} (#{candidate.denseRank ?? "—"}) · Keyword {formatScore(candidate.keywordScore)} (#{candidate.keywordRank ?? "—"}) · Fusion {formatScore(candidate.fusionScore)} · RRF {formatScore(candidate.rrfScore)}</p></div></details></div></div></article>)}</div> : <div className="p-6 text-sm text-muted-foreground">{labels.noCandidates}</div>}
                </div>
                <StageReuseBadge detailsLabel={labels.details} executedLabel={labels.executed} reusedLabel={labels.reused} stage="retrieval" reuse={results?.retrieval?.reuse} />
              </> : null}

              {activeStage === "reranking" ? <>
                <div><h2 className="text-[18px] font-semibold text-foreground">{labels.reranking}</h2><p className="mt-1 text-[13.5px] leading-5 text-muted-foreground">{preferences.locale === "tr" ? `Opsiyonel reranking, ${results?.reranking?.inputCandidates?.length ?? results?.reranking?.candidates.length ?? 0} girdi adayını ${results?.reranking?.candidates.length ?? 0} sıralı sonuç olarak gösterir; karar ayrı izlenir.` : `Optional reranking orders ${results?.reranking?.inputCandidates?.length ?? results?.reranking?.candidates.length ?? 0} input candidates into ${results?.reranking?.candidates.length ?? 0} output results and keeps that decision separate.`}</p></div>
                <StageReuseBadge detailsLabel={labels.details} executedLabel={labels.executed} reusedLabel={labels.reused} stage="reranking" reuse={results?.reranking?.reuse} />
                <div className="mt-5 overflow-hidden rounded-[16px] border border-border bg-card">{results?.reranking?.executed ? results.reranking.candidates.length ? <div className="divide-y divide-border">{results.reranking.candidates.map((candidate) => <article className="p-4" key={candidate.chunkId}><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-[8px] bg-secondary font-mono text-[12px] text-foreground">{candidate.rerankRank ?? candidate.rank}</span><p className="text-[13px] font-medium text-brand">{candidate.headingPath?.join(" › ") || workspaceCopy.sourceDocument}</p></div><span className="font-mono text-[12px] text-muted-foreground">{labels.originalRank} {candidate.originalRank} · {labels.rerankedPosition} {candidate.rerankRank ?? candidate.rank}</span></div><p className="mt-2 line-clamp-3 break-words text-sm leading-5 text-muted-foreground">{candidate.text}</p><div className="mt-3"><SourceInspector documentId={activeDocument?.id ?? null} headingPath={candidate.headingPath} pageNumbers={candidate.pageNumbers} parseResult={parseResult} sourceElementIds={candidate.sourceElementIds} triggerAriaLabel={preferences.locale === "tr" ? "Kaynağı incele" : "Inspect source"} triggerLabel={workspaceCopy.viewSource} /></div></article>)}</div> : <p className="p-6 text-sm text-muted-foreground">{labels.noCandidates}</p> : <p className="p-6 text-sm text-muted-foreground">{rerankerEnabled ? labels.noRun : labels.skipped}</p>}</div>
              </> : null}

              {activeStage === "context" ? <>
                <div><h2 className="text-[18px] font-semibold text-foreground">{workspaceCopy.contextTitle}</h2><p className="mt-1 max-w-[560px] text-[13.5px] leading-5 text-muted-foreground">{workspaceCopy.contextDescription}</p></div>
                {results?.context ? <><div className="mt-5 overflow-hidden rounded-[16px] border border-border bg-card"><div className="divide-y divide-border">{results.context.candidates.map((candidate, index) => <article className="p-4" key={candidate.chunkId}><div className="flex min-w-0 items-start gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-secondary font-mono text-[12px] text-foreground">#{index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><span className={candidate.selected ? "inline-flex items-center gap-1.5 text-[13px] font-medium text-success" : "inline-flex items-center gap-1.5 text-[13px] font-medium text-subtle-foreground"}>{candidate.selected ? <AppIcon name="check" className="size-3.5" /> : <AppIcon name="minus" className="size-3.5" />}{candidate.selected ? labels.selected : labels.excluded}</span><span className="font-mono text-[12px] text-muted-foreground">{candidate.tokenCount} {labels.tokens.toLowerCase()}</span></div><p className="mt-2 line-clamp-2 text-sm leading-5 text-muted-foreground">{candidate.text}</p><details className="mt-3 border-t border-border pt-3"><summary className="cursor-pointer text-[12px] font-medium text-muted-foreground">{labels.details}</summary><div className="mt-2 text-[11px] leading-5 text-muted-foreground"><p>{labels.reason}: {candidate.reason || "—"}</p><p>{labels.provenance}: {candidate.sourceElementIds.join(", ") || "—"}</p></div></details></div></div></article>)}</div></div><div className="mt-5 rounded-[16px] border border-border bg-card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-[13px] font-semibold text-foreground">{workspaceCopy.finalContext}</h3><span className="font-mono text-[12px] text-muted-foreground">{results.context.tokenCount.toLocaleString()} / {results.context.tokenBudget.toLocaleString()} tokens</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (results.context.tokenCount / Math.max(1, results.context.tokenBudget)) * 100)}%` }} /></div><details className="mt-3"><summary className="cursor-pointer text-[13px] font-medium text-brand">{workspaceCopy.expandContext}</summary><pre className="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-technical p-3 font-mono text-xs leading-5 text-foreground">{results.context.finalContext || workspaceCopy.noStageResult}</pre></details></div></> : <div className="mt-5 rounded-[16px] border border-border bg-card p-6 text-sm text-muted-foreground">{workspaceCopy.noStageResult}</div>}
              </> : null}

              {activeStage === "generation" ? <>
                <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-[18px] font-semibold text-foreground">{labels.answer}</h2><p className="mt-1 max-w-[560px] text-[13.5px] leading-5 text-muted-foreground">{workspaceCopy.answerDescription}</p></div>{results?.generation ? <span className="inline-flex items-center gap-1.5 rounded-full bg-success-subtle px-3 py-1 text-[12px] font-medium text-success"><AppIcon name="completed" className="size-3.5" />{workspaceCopy.complete}</span> : null}</div>
                {results?.generation ? <><div className="mt-5 rounded-[16px] border border-border bg-card p-5" data-testid="playground-answer"><StageReuseBadge detailsLabel={labels.details} executedLabel={labels.executed} reusedLabel={labels.reused} stage="generation" reuse={results.generation.reuse} />{results.generation.insufficientContext && !results.generation.answer.trim() ? <div className="mt-3 rounded-[12px] border border-warning-border bg-warning-subtle p-4" data-testid="playground-insufficient-context" role="status"><h3 className="text-[14px] font-semibold text-warning">{preferences.locale === "tr" ? "Yeterli context bulunamadı" : "Not enough context to answer"}</h3><p className="mt-1 text-sm leading-5 text-warning">{preferences.locale === "tr" ? "Bu deney, kaynaklarda doğrulanabilir bir cevap üretmek için yeterli içerik bulamadı." : "This experiment did not find enough grounded context to produce an answer."}</p></div> : <p className="mt-3 whitespace-pre-wrap break-words text-base leading-[26px] text-foreground">{results.generation.answer}</p>}</div>{results.generation.citations.length ? <div className="mt-5"><h3 className="text-[13px] font-semibold text-foreground">{labels.citations}</h3><div className="mt-2 overflow-hidden rounded-[12px] border border-border bg-card"><div className="divide-y divide-border">{results.generation.citations.map((citation) => <div className="flex flex-wrap items-center gap-3 p-3" key={citation.citationId}><span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent font-mono text-[12px] text-accent-foreground">{citation.citationId.replace(/\D/g, "") || "?"}</span><span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{citation.quote || citation.citationId}</span><span className="shrink-0 text-[12px] text-subtle-foreground">p.{citation.pageNumbers.join(", ") || "—"}</span><span className={citation.valid ? "rounded-full bg-success-subtle px-2 py-1 text-[11px] font-medium text-success" : "rounded-full bg-destructive-subtle px-2 py-1 text-[11px] font-medium text-destructive"}>{citation.valid ? labels.citationValid : labels.citationInvalid}</span><SourceInspector documentId={activeDocument?.id ?? null} pageNumbers={citation.pageNumbers} parseResult={parseResult} sourceElementIds={citation.sourceElementIds} triggerAriaLabel={citation.citationId} triggerLabel={citation.citationId} /></div>)}</div></div></div> : null}<ExperimentDetails locale={preferences.locale} run={experimentRun} /></> : <div className="mt-5 rounded-[16px] border border-border bg-card p-6 text-sm text-muted-foreground">{labels.noAnswer}</div>}
              </> : null}
            </section>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-3" data-testid="playground-current-actions"><span className="mr-1 text-[13px] font-medium text-foreground">{labels.currentActions}</span>{(experimentRun?.status === "queued" || experimentRun?.status === "running") && experimentStatus !== "processing" ? <Button onClick={() => void resumeRunTracking("experiment")} size="sm" variant="outline">{preferences.locale === "tr" ? "Takibi sürdür" : "Resume tracking"}</Button> : null}{copyStatus !== "idle" ? <span role="status">{copyStatus === "copied" ? (preferences.locale === "tr" ? "Trace kopyalandı." : "Trace copied.") : (preferences.locale === "tr" ? "Kopyalanamadı. Tekrar deneyin." : "Copy failed. Try again.")}</span> : null}{canContinue ? <Button className="gap-2" onClick={() => void continueExperiment()} size="sm" variant="outline">{labels.continue}</Button> : null}{results?.generation ? <Button className="gap-2" disabled={!canRerunGeneration} onClick={() => void rerunGeneration()} size="sm" variant="outline">{labels.runAgain}</Button> : null}<Button className="gap-2" onClick={() => void copyTrace()} size="sm" variant="outline"><AppIcon name="copy" className="size-4" />{copy.retrieval.copyTrace}</Button></div>
        </> : null}

        {experimentHistory.length ? <details className="mt-6 rounded-[12px] border border-border bg-card" data-testid="playground-history"><summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13px] font-medium text-foreground"><span>{labels.history}</span><span className="text-xs font-normal text-subtle-foreground">{experimentHistory.length}</span></summary><div className="border-t border-border p-3"><div className="space-y-2">{experimentHistory.map((run, index) => { const retrieval = objectValue(run.config.retrieval); const reranking = objectValue(run.config.reranking); const candidateCountValue = isExperimentDetail(run) ? run.stageResults.retrieval?.candidates.length ?? 0 : run.candidateCount ?? 0; return <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-border p-3" key={run.id}><label className="flex shrink-0 items-center gap-2"><input aria-label={`${labels.compare} ${experimentIdentity(run, index + 1)}`} checked={compareIds.includes(run.id)} disabled={!compareIds.includes(run.id) && compareIds.length >= 2} onChange={() => toggleCompare(run.id)} type="checkbox" /><span className="sr-only">{labels.compare}</span></label><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium text-foreground">{run.query || experimentIdentity(run, index + 1)}</p><p className="mt-1 text-[11.5px] text-subtle-foreground">{experimentRetrievalMode(run.config)} · {copy.retrieval.topK} {String(retrieval.topK ?? "—")} · {Boolean(reranking.enabled) ? (preferences.locale === "tr" ? "Reranker açık" : "Reranker on") : (preferences.locale === "tr" ? "Reranker kapalı" : "Reranker off")} · {formatRunTimestamp(run, preferences.locale) ?? "—"} · {run.timing.durationMs === null ? "—" : `${run.timing.durationMs} ms`} · {candidateCountValue} {labels.candidates.toLowerCase()}</p></div><Button aria-label={`${labels.load} ${experimentIdentity(run, index + 1)}`} onClick={() => { if (experimentRun?.id === run.id) restoreDraft(experimentRun); void loadExperiment(run.id); }} size="sm" variant="ghost">{labels.load}</Button></div>; })}</div>{selectedComparisonRuns.length ? <div className="mt-3 grid gap-3 border-t border-border pt-3 md:grid-cols-2"><p className="sr-only">{labels.selectedRuns}: {compareIds.length}/2</p>{selectedComparisonRuns.map((run, index) => <div className="rounded-[10px] border border-border p-3" key={run.id}><div className="text-xs font-semibold text-accent-foreground">{experimentIdentity(run, index + 1)}</div><dl className="mt-2 grid grid-cols-2 gap-2 text-xs"><div><dt className="text-subtle-foreground">{copy.retrieval.mode}</dt><dd className="mt-1">{experimentRetrievalMode(run.config)}</dd></div><div><dt className="text-subtle-foreground">{labels.candidates}</dt><dd className="mt-1">{run.stageResults.retrieval?.candidates.length ?? 0}</dd></div><div><dt className="text-subtle-foreground">{labels.citations}</dt><dd className="mt-1">{run.stageResults.generation?.citations.filter((citation) => citation.valid).length ?? 0}</dd></div></dl></div>)}</div> : null}</div></details> : null}
      </div>
    </div>
  );
}
