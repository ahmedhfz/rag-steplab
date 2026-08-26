"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Copy, Play, RotateCcw, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { DisabledReason, EmptyPipelineState, LearningHint, PipelineErrorMessage, RunMetadata, StageSection } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { SourceInspector } from "@/components/source-inspector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UI_COPY } from "@/lib/copy";
import type { ExperimentRun, ExperimentTargetStage, ExperimentSummary, RetrievalMode, StageReuseMetadata } from "@/lib/rag-api-types";
import { firstBlocker } from "@/lib/blockers";

function ExperimentStageRail({ run, locale, rerankerEnabled }: { run: ExperimentRun | null; locale: "en" | "tr"; rerankerEnabled: boolean }) {
  const labels = locale === "tr" ? { retrieval: "Retrieval", reranking: "Reranking", context: "Context", generation: "Generation", queued: "Sırada", waiting: "Bekliyor", running: "Çalışıyor", completed: "Tamamlandı", skipped: "Atlandı", reused: "Yeniden kullanıldı", failed: "Başarısız" } : { retrieval: "Retrieval", reranking: "Reranking", context: "Context", generation: "Generation", queued: "Queued", waiting: "Waiting", running: "Running", completed: "Completed", skipped: "Skipped", reused: "Reused", failed: "Failed" };
  const stages = ["retrieval", "reranking", "context", "generation"] as const;
  const completedCount = stages.filter((stage) => Boolean(run?.stageResults[stage])).length;
  const statusFor = (stage: typeof stages[number]) => {
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
  return <ol aria-label={locale === "tr" ? "Experiment aşamaları" : "Experiment stages"} className="grid gap-0 overflow-hidden border border-[#e7e2e4] bg-white sm:grid-cols-4">{stages.map((stage, index) => { const result = run?.stageResults[stage]; const skipped = Boolean(result && stage === "reranking" && "executed" in result && !result.executed); const state = statusFor(stage); const markerClass = skipped ? "border border-[#e7e2e4] bg-[#f7f5f6] text-[#969093]" : result ? "border border-[#c6ddcc] bg-[#eef4ef] text-[#3f7a55]" : state === labels.failed ? "border border-[#edcfcf] bg-[#fbefef] text-[#a23b3b]" : "border border-[#d8b5c2] bg-[#fbf4f6] text-[#711f3a]"; const textClass = skipped ? "text-[#969093]" : result ? "text-[#3f7a55]" : state === labels.failed ? "text-[#a23b3b]" : "text-[#6e676a]"; return <li className="relative flex min-w-0 items-center gap-3 border-b border-[#e7e2e4] p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0" key={stage}><span aria-hidden="true" className={`grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${markerClass}`}>{skipped ? "–" : result ? "✓" : index + 1}</span><span className="min-w-0"><span className="block truncate text-xs font-semibold text-[#171416]">{labels[stage]}</span><span className={`mt-1 block truncate text-[11px] ${textClass}`}>{state}{result && typeof result.durationMs === "number" ? ` · ${result.durationMs} ms` : ""}</span></span></li>; })}</ol>;
}

const DEFAULT_TOP_K = "5";
const DEFAULT_MODE: RetrievalMode = "dense";

function formatScore(value: number | null) {
  return value === null ? "—" : value.toFixed(4);
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
  sourceLabel,
}: {
  reuse?: StageReuseMetadata | null;
  stage: string;
  reusedLabel: string;
  executedLabel: string;
  sourceLabel: string;
}) {
  if (!reuse) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-[11px] text-[#6e676a]" data-testid={`stage-reuse-${stage}`}>
      <span className={reuse.reused ? "text-[#711f3a]" : "text-[#3f7a55]"}>{reuse.reused ? reusedLabel : executedLabel}</span>
      {reuse.sourceExperimentId ? <details><summary className="cursor-pointer text-[10px] text-[#969093]">{sourceLabel}</summary><span className="font-mono text-[10px]">{reuse.sourceExperimentId.slice(0, 8)}</span></details> : null}
    </span>
  );
}

export function RetrievalScreen() {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const {
    activeDocument,
    parseResult,
    capabilities,
    selectedChunkRunId,
    selectedEmbeddingRunId,
    experimentStatus,
    experimentRun,
    experimentError,
    experimentHistory,
    runExperiment,
    loadExperiment,
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
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const hasChanges = question.length > 0 || topK !== DEFAULT_TOP_K || mode !== DEFAULT_MODE || rerankerEnabled || candidateCount !== 10 || tokenBudget !== 3000 || temperature !== 0.1 || targetStage !== "generation";
  const activeChunkRunId = selectedChunkRunId;
  const activeEmbeddingRunId = selectedEmbeddingRunId;
  const needsEmbedding = mode !== "keyword";
  const askBlocker = firstBlocker(preferences.locale, [
    [experimentStatus === "processing", "processing"],
    [!activeDocument?.id, "missing_document"],
    [!activeChunkRunId, "missing_chunk"],
    [!question.trim(), "missing_question"],
    [needsEmbedding && !activeEmbeddingRunId, "missing_embedding"],
  ]);
  const canAsk = !askBlocker;
  const labels = preferences.locale === "tr" ? {
    target: "Hedef aşama", retrieval: "Retrieval", reranking: "Reranking", context: "Context construction", generation: "Generation", runExperiment: "Deneyi çalıştır", advanced: "Gelişmiş ayarlar",
    candidateCount: "Rerank aday sayısı", tokenBudget: "Context token bütçesi", temperature: "Temperature",
    reasonNoDocument: "Önce kalıcı bir doküman seçin ve chunking çalıştırın.",
    reasonNoEmbedding: "Dense ve hybrid arama için güncel embedding run gerekir. Keyword modu embedding olmadan çalışabilir.",
    input: "Input ve effective config", noRun: "Henüz gerçek bir retrieval experiment çalıştırılmadı.",
    originalRank: "İlk sıra", rerankScore: "Rerank skoru", selected: "Seçildi", excluded: "Elendi", reason: "Karar", tokens: "Token",
    finalContext: "LLM'e gönderilen final context", contextUsage: "Context kullanımı", answer: "Grounded cevap", citations: "Doğrulanmış citations",
    invalidCitation: "Backend doğrulamasını geçmedi", history: "Experiment geçmişi ve karşılaştırma", compare: "Karşılaştır", selectedRuns: "Seçili run",
    model: "Model", run: "Run", duration: "Süre", candidates: "Aday", provenance: "Kaynak elementler", insufficient: "Context cevap için yetersiz bulundu.", skipped: "Atlandı",
    retrievalDescription: "Dense, keyword veya RRF hybrid adayları sonraki sıralama kararlarından ayrı tutulur.", rerankingDescription: "Opsiyonel reranking retrieval adaylarını alır ve sıra değişimlerini ayrı bir aşama olarak kaydeder.", contextDescription: "Adaylar final context Gemini'ye ulaşmadan önce açıkça seçilir veya elenir.", generationDescription: "Cevap yalnız final context'i kullanır; her citation kalıcı provenance ile doğrulanır.",
    reused: "Yeniden kullanıldı", executed: "Çalıştırıldı", source: "Kaynak", load: "Yükle", continue: "Devam et", runAgain: "Generation'ı tekrar çalıştır", exactReuse: "Aynı experiment yüklendi", viewingSaved: "Kayıtlı run görüntüleniyor", draftDiffers: "Taslak ayarlar kayıtlı run'dan farklı; yeni çalıştırma taslak ayarları kullanır.", savedRunHint: "Bu sonuç persisted backend run'ından geliyor.", currentActions: "Mevcut run işlemleri",
  } : {
    target: "Target stage", retrieval: "Retrieval", reranking: "Reranking", context: "Context construction", generation: "Generation", runExperiment: "Run experiment", advanced: "Advanced settings",
    candidateCount: "Rerank candidate count", tokenBudget: "Context token budget", temperature: "Temperature",
    reasonNoDocument: "Select a persisted document and complete chunking first.",
    reasonNoEmbedding: "Dense and hybrid search require a current embedding run. Keyword mode can run without embeddings.",
    input: "Input and effective config", noRun: "No real retrieval experiment has run yet.",
    originalRank: "Original rank", rerankScore: "Rerank score", selected: "Selected", excluded: "Excluded", reason: "Decision", tokens: "Tokens",
    finalContext: "Final context sent to the LLM", contextUsage: "Context usage", answer: "Grounded answer", citations: "Validated citations",
    invalidCitation: "Rejected by backend validation", history: "Experiment history and comparison", compare: "Compare", selectedRuns: "Selected runs",
    model: "Model", run: "Run", duration: "Duration", candidates: "Candidates", provenance: "Source elements", insufficient: "The context was insufficient to answer.", skipped: "Skipped",
    retrievalDescription: "Dense, keyword, or RRF hybrid candidates remain separate from later ranking decisions.", rerankingDescription: "Optional reranking receives retrieval candidates and records rank changes as its own stage.", contextDescription: "Candidates are explicitly selected or excluded before the final context reaches Gemini.", generationDescription: "The answer uses only final context; every citation is validated against persisted provenance.",
    reused: "Reused", executed: "Executed", source: "Source", load: "Load", continue: "Continue", runAgain: "Run generation again", exactReuse: "Exact experiment loaded", viewingSaved: "Viewing saved run", draftDiffers: "Draft settings differ from the saved run; the next run uses the draft.", savedRunHint: "These results come from a persisted backend run.", currentActions: "Current run actions",
  };
  const selectedComparisonRuns = useMemo(() => experimentHistory.filter((run): run is ExperimentRun => compareIds.includes(run.id) && isExperimentDetail(run)), [compareIds, experimentHistory]);
  const results = experimentRun?.stageResults;
  const savedRunMatches = experimentRun ? savedRunMatchesDraft(experimentRun, { question, topK, mode, rerankerEnabled, candidateCount, tokenBudget, temperature, targetStage }) : false;
  const canContinue = Boolean(experimentRun && experimentRun.status === "completed" && experimentRun.targetStage !== "generation" && experimentStatus !== "processing");
  const canRerunGeneration = Boolean(experimentRun && experimentRun.status === "completed" && results?.generation && experimentStatus !== "processing");

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
    <div className="min-w-0 overflow-x-clip">
      <section className="border-b border-[#e7e2e4] bg-white px-4 py-8 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#969093]">Test / Playground</p><h1 className="mt-3 text-[28px] font-semibold tracking-[-0.045em] text-[#171416]">{copy.retrieval.title}</h1></div>{activeDocument ? <span className="inline-flex max-w-full items-center rounded-full border border-[#d8b5c2] bg-[#fbf4f6] px-3 py-1.5 text-xs font-medium text-[#711f3a]">{activeDocument.fileName}</span> : null}</div>
        <p className="mt-2 max-w-2xl text-sm leading-5 text-[#6e676a]">{preferences.locale === "tr" ? "Soru, retrieval ayarları ve stage trace ile gerçek bir RAG deneyi çalıştırın." : "Run a real RAG experiment with a question, retrieval settings, and a stage trace."}</p>
        <form className="mt-6 flex flex-col gap-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <div className="relative min-w-0 flex-1">
            <label className="sr-only" htmlFor="retrieval-question">{copy.retrieval.question}</label>
            <Input aria-label={copy.retrieval.question} className="h-12 border-[#d8d2d5] bg-white pr-11 text-sm" id="retrieval-question" onChange={(event) => setQuestion(event.target.value)} placeholder={copy.retrieval.questionPlaceholder} value={question} />
            <AnimatePresence initial={false}>
              {question ? <motion.div animate={{ opacity: 1, transform: "scale(1)" }} className="absolute right-1.5 top-1.5" exit={{ opacity: 0, transform: "scale(0.9)" }} initial={{ opacity: 0, transform: "scale(0.9)" }}><Button aria-label={copy.retrieval.clearQuestion} onClick={() => setQuestion("")} size="icon" type="button" variant="ghost"><X aria-hidden="true" className="size-4" /></Button></motion.div> : null}
            </AnimatePresence>
          </div>
          <Button aria-busy={experimentStatus === "processing"} aria-describedby={!canAsk ? "ask-disabled-reason" : undefined} className="h-12 gap-2 px-8" disabled={!canAsk} type="submit">
            <Play aria-hidden="true" className="size-4 fill-current" />{labels.runExperiment}
          </Button>
        </form>
        {!canAsk ? <DisabledReason id="ask-disabled-reason">{askBlocker?.code === "missing_document" || askBlocker?.code === "missing_chunk" ? labels.reasonNoDocument : askBlocker?.message}</DisabledReason> : null}
        {experimentRun && experimentRun.status === "completed" ? <div className={savedRunMatches ? "mt-4 border border-[#c6ddcc] bg-[#eef4ef] px-3 py-2 text-xs text-[#3f7a55]" : "mt-4 border border-[#eadfc9] bg-[#fffaf1] px-3 py-2 text-xs text-[#8d651e]"} role="status"><strong>{savedRunMatches ? labels.viewingSaved : labels.draftDiffers}</strong><span className="ml-2">{labels.savedRunHint}</span></div> : null}
        <div className="mt-5 grid gap-3 sm:grid-cols-3"><label className="text-xs font-medium text-[#171416]" htmlFor="retrieval-mode">{copy.retrieval.mode}<Select onValueChange={(value) => setMode(value as RetrievalMode)} value={mode}><SelectTrigger className="mt-2" id="retrieval-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="dense">{copy.retrieval.modes.dense}</SelectItem><SelectItem value="hybrid">{copy.retrieval.modes.hybrid}</SelectItem><SelectItem value="keyword">{copy.retrieval.modes.keyword}</SelectItem></SelectContent></Select></label><label className="text-xs font-medium text-[#171416]" htmlFor="retrieval-top-k">{copy.retrieval.topK}<Select onValueChange={setTopK} value={topK}><SelectTrigger className="mt-2" id="retrieval-top-k"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="3">3</SelectItem><SelectItem value="5">5</SelectItem><SelectItem value="10">10</SelectItem></SelectContent></Select></label><label className="text-xs font-medium text-[#171416]" htmlFor="reranker-enabled">{copy.retrieval.reranker}<span className="mt-2 flex h-9 items-center justify-between rounded-[8px] border border-[#d8d2d5] bg-white px-3"><span>{rerankerEnabled ? capabilities?.rerankModel || "Gemini" : copy.retrieval.notConfigured}</span><Switch aria-label={copy.retrieval.reranker} checked={rerankerEnabled} id="reranker-enabled" onCheckedChange={setRerankerEnabled} /></span></label></div>
        <LearningHint locale={preferences.locale}>{preferences.locale === "tr" ? "Retrieval, seçili indexing pipeline'ın chunk'ları arasından soruya en uygun adayları bulur." : "Retrieval finds the most relevant candidates from the selected indexing pipeline's chunks."}</LearningHint>
        <div className="mt-3"><PipelineErrorMessage message={experimentError?.message} /></div>

        <details className="mt-5 border border-[#e7e2e4] bg-[#fbfafb] px-4 py-3">
          <summary className="cursor-pointer text-xs font-semibold text-[#501329]">{labels.advanced}</summary>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <label className="text-xs font-medium text-[#171416]" htmlFor="target-stage">{labels.target}<Select onValueChange={(value) => setTargetStage(value as ExperimentTargetStage)} value={targetStage}><SelectTrigger className="mt-2" id="target-stage"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="retrieval">{labels.retrieval}</SelectItem><SelectItem value="reranking">{labels.reranking}</SelectItem><SelectItem value="context">{labels.context}</SelectItem><SelectItem value="generation">{labels.generation}</SelectItem></SelectContent></Select></label>
          <label className="text-xs font-medium text-[#171416]" htmlFor="candidate-count">{labels.candidateCount}<Input className="mt-2" disabled={!rerankerEnabled} id="candidate-count" max={20} min={1} onChange={(event) => setCandidateCount(Number(event.target.value))} type="number" value={candidateCount} /></label>
          <label className="text-xs font-medium text-[#171416]" htmlFor="context-budget">{labels.tokenBudget}<Input className="mt-2" id="context-budget" max={12000} min={256} onChange={(event) => setTokenBudget(Number(event.target.value))} type="number" value={tokenBudget} /></label>
          <label className="text-xs font-medium text-[#171416]" htmlFor="generation-temperature">{labels.temperature}<Input className="mt-2" id="generation-temperature" max={2} min={0} onChange={(event) => setTemperature(Number(event.target.value))} step="0.1" type="number" value={temperature} /></label>
          </div>
          <div className="mt-3 flex justify-end"><Button aria-describedby={!hasChanges ? "retrieval-reset-disabled-reason" : undefined} className="gap-2" disabled={!hasChanges} onClick={reset} size="sm" variant="ghost"><RotateCcw aria-hidden="true" className="size-4" />{copy.retrieval.reset}</Button></div>
          {!hasChanges ? <DisabledReason id="retrieval-reset-disabled-reason">{copy.retrieval.nothingToReset}</DisabledReason> : null}
        </details>
      </section>

      <section className="bg-[#fbfafb] px-4 py-5 sm:px-8"><ExperimentStageRail locale={preferences.locale} rerankerEnabled={rerankerEnabled} run={experimentRun} /></section>

      <StageSection description={labels.retrievalDescription} locale={preferences.locale} status={results?.retrieval ? "completed" : experimentStatus} title={labels.retrieval}>
        {experimentRun ? <RunMetadata locale={preferences.locale} run={experimentRun} /> : null}
        {experimentRun?.reusedExperiment ? <p className="mt-2 text-xs text-[#711f3a]">{labels.exactReuse}</p> : null}
        <StageReuseBadge executedLabel={labels.executed} reusedLabel={labels.reused} sourceLabel={labels.source} stage="retrieval" reuse={results?.retrieval?.reuse} />
        {results?.retrieval ? (
          <div className="mt-4 overflow-x-auto border border-[#e7e2e4] bg-white"><Table><caption className="sr-only">{copy.retrieval.retrievedChunks}</caption><TableHeader><TableRow><TableHead>{copy.retrieval.rank}</TableHead><TableHead>{mode === "hybrid" ? copy.retrieval.score : mode === "dense" ? "Similarity" : "Keyword score"}</TableHead>{mode === "hybrid" ? <><TableHead>Dense</TableHead><TableHead>Keyword</TableHead><TableHead>RRF</TableHead></> : null}<TableHead>{copy.retrieval.page}</TableHead><TableHead className="min-w-72">{copy.retrieval.preview}</TableHead></TableRow></TableHeader><TableBody>{results.retrieval.candidates.map((candidate) => <TableRow key={candidate.chunkId}><TableCell className="font-semibold text-[#711f3a]">{candidate.rank}</TableCell><TableCell>{formatScore(candidate.score)}</TableCell>{mode === "hybrid" ? <><TableCell>{formatScore(candidate.denseScore)}</TableCell><TableCell>{formatScore(candidate.keywordScore)}</TableCell><TableCell>{formatScore(candidate.rrfScore)}</TableCell></> : null}<TableCell>{candidate.pageNumbers.join(", ") || "—"}</TableCell><TableCell className="max-w-xl whitespace-normal leading-5"><p className="break-words text-[#171416]">{candidate.text}</p><details className="mt-2"><summary className="cursor-pointer text-[10px] text-[#6e676a]">{labels.provenance}</summary><p className="mt-1 break-all font-mono text-[10px] text-[#6e676a]">{candidate.sourceElementIds.join(", ") || "—"}</p></details><div className="mt-2"><SourceInspector documentId={activeDocument?.id ?? null} headingPath={candidate.headingPath} pageNumbers={candidate.pageNumbers} parseResult={parseResult} sourceElementIds={candidate.sourceElementIds} /></div></TableCell></TableRow>)}</TableBody></Table></div>
        ) : <EmptyPipelineState>{labels.noRun}</EmptyPipelineState>}
      </StageSection>

      <StageSection description={labels.rerankingDescription} locale={preferences.locale} status={results?.reranking ? (results.reranking.executed ? "completed" : "skipped") : rerankerEnabled && experimentStatus === "processing" ? "processing" : rerankerEnabled ? "ready" : "skipped"} title={labels.reranking}>
        <StageReuseBadge executedLabel={labels.executed} reusedLabel={labels.reused} sourceLabel={labels.source} stage="reranking" reuse={results?.reranking?.reuse} />
        {results?.reranking?.executed ? <div className="overflow-x-auto border border-[#e7e2e4] bg-white"><Table><TableHeader><TableRow><TableHead>{copy.retrieval.rank}</TableHead><TableHead>{labels.originalRank}</TableHead><TableHead>{labels.rerankScore}</TableHead><TableHead className="min-w-72">{copy.retrieval.preview}</TableHead></TableRow></TableHeader><TableBody>{results.reranking.candidates.map((candidate) => <TableRow key={candidate.chunkId}><TableCell className="font-semibold text-[#711f3a]">{candidate.rank} {candidate.originalRank !== candidate.rank ? <span className="text-[#3f7a55]">{candidate.originalRank > candidate.rank ? `↑${candidate.originalRank - candidate.rank}` : `↓${candidate.rank - candidate.originalRank}`}</span> : null}</TableCell><TableCell>{candidate.originalRank}</TableCell><TableCell>{formatScore(candidate.rerankScore)}</TableCell><TableCell className="whitespace-normal leading-5">{candidate.text}</TableCell></TableRow>)}</TableBody></Table></div> : <EmptyPipelineState>{rerankerEnabled ? labels.noRun : labels.skipped}</EmptyPipelineState>}
      </StageSection>

      <StageSection description={labels.contextDescription} locale={preferences.locale} status={results?.context ? "completed" : "locked"} title={labels.context}>
        <StageReuseBadge executedLabel={labels.executed} reusedLabel={labels.reused} sourceLabel={labels.source} stage="context" reuse={results?.context?.reuse} />
        {results?.context ? <div className="grid gap-4 lg:grid-cols-2"><div className="space-y-2">{results.context.candidates.map((candidate) => <article className="border border-[#e7e2e4] bg-white p-3" key={candidate.chunkId}><div className="flex items-center justify-between gap-2"><span className="text-[11px] font-medium text-[#171416]">Chunk · {candidate.pageNumbers.join(", ") || "page unknown"}</span><span className={candidate.selected ? "text-[#3f7a55]" : "text-[#969093]"}>{candidate.selected ? labels.selected : labels.excluded}</span></div><p className="mt-2 break-words text-sm leading-5 text-[#171416]">{candidate.text}</p><p className="mt-2 text-xs text-[#6e676a]">{labels.reason}: {candidate.reason || "—"} · {candidate.tokenCount} {labels.tokens}</p><details className="mt-2"><summary className="cursor-pointer text-[10px] text-[#6e676a]">{labels.provenance}</summary><p className="mt-1 break-all font-mono text-[10px] text-[#6e676a]">{candidate.sourceElementIds.join(", ") || "—"}</p></details></article>)}</div><div className="min-w-0"><h3 className="text-sm font-semibold text-[#171416]">{labels.finalContext}</h3><p className="mt-2 text-xs text-[#6e676a]">{labels.contextUsage}: {results.context.tokenCount} / {results.context.tokenBudget}</p><div aria-label={`${labels.contextUsage} ${results.context.tokenCount} / ${results.context.tokenBudget}`} className="mt-2 h-2 overflow-hidden rounded-full bg-[#e7e2e4]" role="progressbar" aria-valuemax={results.context.tokenBudget} aria-valuemin={0} aria-valuenow={Math.min(results.context.tokenCount, results.context.tokenBudget)}><div className="h-full rounded-full bg-[#711f3a]" style={{ width: `${Math.min(100, (results.context.tokenCount / Math.max(1, results.context.tokenBudget)) * 100)}%` }} /></div><pre className="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap break-words border border-[#e7e2e4] bg-[#fbfafb] p-4 font-mono text-xs leading-6 text-[#171416]">{results.context.finalContext}</pre></div></div> : <EmptyPipelineState>{labels.noRun}</EmptyPipelineState>}
      </StageSection>

      <StageSection description={labels.generationDescription} locale={preferences.locale} status={results?.generation ? "completed" : "locked"} title={labels.generation}>
        <StageReuseBadge executedLabel={labels.executed} reusedLabel={labels.reused} sourceLabel={labels.source} stage="generation" reuse={results?.generation?.reuse} />
        {results?.generation ? <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"><article className="min-w-0 border border-[#e7e2e4] bg-white p-4 sm:p-6"><h3 className="text-sm font-semibold text-[#171416]">{labels.answer}</h3>{results.generation.insufficientContext ? <p className="mt-3 border border-[#eadfc9] bg-[#fffaf1] px-3 py-2 text-sm text-[#8d651e]" role="status">{labels.insufficient}</p> : null}<p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-[#171416]">{results.generation.answer}</p><p className="mt-5 border-t border-[#e7e2e4] pt-4 text-xs text-[#6e676a]">{labels.model}: {results.generation.model ?? "—"} · input {results.generation.inputTokens ?? "—"} · output {results.generation.outputTokens ?? "—"}</p></article><aside className="min-w-0"><h3 className="text-sm font-semibold text-[#171416]">{labels.citations}</h3><div className="mt-3 space-y-2">{results.generation.citations.length ? results.generation.citations.map((citation) => <div className={citation.valid ? "border border-[#c6ddcc] bg-[#eef4ef] p-3" : "border border-[#edcfcf] bg-[#fbefef] p-3"} key={citation.citationId}><div className="flex items-center gap-2 text-xs font-medium">{citation.valid ? <CheckCircle2 aria-hidden="true" className="size-4 text-[#3f7a55]" /> : <X aria-hidden="true" className="size-4 text-[#a23b3b]" />}<span className="text-[#171416]">{citation.citationId}</span></div><details className="mt-2"><summary className="cursor-pointer text-[10px] text-[#6e676a]">{labels.provenance}</summary><p className="mt-1 break-all font-mono text-[10px] text-[#6e676a]">chunk: {citation.chunkId}</p></details><p className="mt-1 text-[10px] text-[#6e676a]">pages: {citation.pageNumbers.join(", ") || "—"}</p>{citation.quote ? <p className="mt-2 break-words text-xs leading-5 text-[#171416]">“{citation.quote}”</p> : null}<div className="mt-2"><SourceInspector documentId={activeDocument?.id ?? null} pageNumbers={citation.pageNumbers} parseResult={parseResult} sourceElementIds={citation.sourceElementIds} triggerLabel={citation.citationId} /></div>{!citation.valid ? <p className="mt-2 text-xs text-[#a23b3b]">{labels.invalidCitation}</p> : null}</div>) : <EmptyPipelineState>{copy.retrieval.noAnswer}</EmptyPipelineState>}</div></aside></div> : <EmptyPipelineState>{copy.retrieval.noAnswer}</EmptyPipelineState>}
      </StageSection>

      <section className="border-t border-[#e7e2e4] px-4 py-7 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">{labels.currentActions}</h2><div className="flex flex-wrap gap-2"><Button className="gap-2" disabled={!canContinue} onClick={() => void continueExperiment()} size="sm" variant="outline">{labels.continue}</Button><Button className="gap-2" disabled={!canRerunGeneration} onClick={() => void rerunGeneration()} size="sm" variant="outline">{labels.runAgain}</Button><Button aria-describedby={!experimentRun ? "trace-disabled-reason" : undefined} className="gap-2" disabled={!experimentRun} onClick={() => experimentRun && void navigator.clipboard.writeText(JSON.stringify(experimentRun, null, 2))} size="sm" variant="outline"><Copy aria-hidden="true" className="size-4" />{copy.retrieval.copyTrace}</Button></div></div>
        {!experimentRun ? <DisabledReason id="trace-disabled-reason">{copy.retrieval.traceUnavailable}</DisabledReason> : null}
      </section>

      <section className="border-t border-[#e7e2e4] px-4 py-7 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-[#171416]">{labels.history}</h2><p className="mt-1 text-xs text-[#6e676a]">{labels.selectedRuns}: {compareIds.length}/2</p></div></div>
        {experimentHistory.length ? <div className="mt-4 overflow-x-auto border border-[#e7e2e4] bg-white"><Table><TableHeader><TableRow><TableHead>{labels.compare}</TableHead><TableHead>{labels.run}</TableHead><TableHead>{copy.retrieval.mode}</TableHead><TableHead>{copy.retrieval.question}</TableHead><TableHead>{labels.candidates}</TableHead><TableHead>{labels.duration}</TableHead><TableHead>{labels.load}</TableHead></TableRow></TableHeader><TableBody>{experimentHistory.map((run, index) => <TableRow key={run.id}><TableCell><input aria-label={`${labels.compare} ${run.id}`} checked={compareIds.includes(run.id)} disabled={!compareIds.includes(run.id) && compareIds.length >= 2} onChange={() => toggleCompare(run.id)} type="checkbox" /></TableCell><TableCell className="max-w-44 truncate text-xs font-medium text-[#501329]" title={run.id}>Experiment {index + 1}<details><summary className="cursor-pointer text-[10px] font-normal text-[#969093]">{preferences.locale === "tr" ? "Teknik kimlik" : "Technical ID"}</summary><span className="break-all font-mono text-[10px] text-[#6e676a]">{run.id}</span></details></TableCell><TableCell>{experimentRetrievalMode(run.config)}</TableCell><TableCell className="max-w-72 whitespace-normal">{run.query}</TableCell><TableCell>{isExperimentDetail(run) ? run.stageResults.retrieval?.candidates.length ?? 0 : run.candidateCount ?? 0}</TableCell><TableCell>{run.timing.durationMs === null ? "—" : `${run.timing.durationMs} ms`}</TableCell><TableCell><Button aria-label={`${labels.load} ${run.id}`} onClick={() => void loadExperiment(run.id)} size="sm" variant="ghost">{labels.load}</Button></TableCell></TableRow>)}</TableBody></Table></div> : <EmptyPipelineState>{copy.retrieval.noTrace}</EmptyPipelineState>}
        {selectedComparisonRuns.length ? <div className="mt-4 grid gap-3 md:grid-cols-2">{selectedComparisonRuns.map((run, index) => <div className="border border-[#e7e2e4] bg-white p-4" key={run.id}><div className="text-xs font-semibold text-[#501329]">Experiment {index + 1}</div><details className="mt-1"><summary className="cursor-pointer text-[10px] text-[#969093]">{preferences.locale === "tr" ? "Teknik kimlik" : "Technical ID"}</summary><div className="break-all font-mono text-[10px] text-[#6e676a]">{run.id}</div></details><dl className="mt-3 grid grid-cols-2 gap-2 text-xs"><div><dt className="text-[#969093]">{copy.retrieval.mode}</dt><dd className="mt-1">{experimentRetrievalMode(run.config)}</dd></div><div><dt className="text-[#969093]">{labels.duration}</dt><dd className="mt-1">{run.timing.durationMs ?? "—"} ms</dd></div><div><dt className="text-[#969093]">{labels.candidates}</dt><dd className="mt-1">{run.stageResults.retrieval?.candidates.length ?? 0}</dd></div><div><dt className="text-[#969093]">{labels.citations}</dt><dd className="mt-1">{run.stageResults.generation?.citations.filter((citation) => citation.valid).length ?? 0}</dd></div></dl></div>)}</div> : null}
      </section>
    </div>
  );
}
