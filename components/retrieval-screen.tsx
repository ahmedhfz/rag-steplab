"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Copy, Minus, Plus, RotateCcw, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { DisabledReason, LearningHint, PipelineErrorMessage, RunMetadata } from "@/components/pipeline-learning-ui";
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

type PlaygroundStage = "retrieval" | "reranking" | "context" | "generation";

function ExperimentStageTrace({
  activeStage,
  locale,
  onSelect,
  rerankerEnabled,
  run,
}: {
  activeStage: PlaygroundStage;
  locale: "en" | "tr";
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
        <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-[#f2eff0] text-[#6e676a]"><Search aria-hidden="true" className="size-3" /></span>
        <div className="min-w-0"><p className="text-[13px] font-medium text-[#171416]">{labels.query}</p><span className="sr-only">{run?.query || (locale === "tr" ? "Çalıştırılmayı bekliyor" : "Waiting to run")}</span></div>
      </li>
      {stages.map((stage) => {
        const result = run?.stageResults[stage];
        const skipped = Boolean(result && stage === "reranking" && "executed" in result && !result.executed);
        const state = statusFor(stage);
        const textClass = skipped ? "text-[#969093]" : result ? "text-[#3f7a55]" : state === labels.failed ? "text-[#a23b3b]" : "text-[#6e676a]";
        return (
          <li className="relative min-h-[37px]" key={stage}>
            <span aria-hidden="true" className="absolute bottom-0 left-[13px] top-0 w-px bg-[#e7e2e4]" />
            <button aria-pressed={activeStage === stage} className={`relative z-10 flex min-h-[37px] w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left transition-colors ${activeStage === stage ? "bg-[#fbf4f6]" : "hover:bg-[#fbfafb]"}`} onClick={() => onSelect(stage)} type="button">
              <span aria-hidden="true" className={`size-3 shrink-0 rounded-full border-2 border-white ${skipped ? "bg-[#969093]" : result ? "bg-[#3f7a55]" : state === labels.failed ? "bg-[#a23b3b]" : "bg-[#711f3a]"}`} />
              <span className={`min-w-0 flex-1 truncate text-[13px] ${activeStage === stage ? "font-medium text-[#501329]" : "font-normal text-[#171416]"}`}>{stage === "generation" ? labels.answer : labels[stage]}</span>
              <span className={`shrink-0 font-mono text-[12px] ${textClass}`}>{skipped ? state : result && typeof result.durationMs === "number" ? `${result.durationMs} ms` : state}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
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

function TopKControl({
  locale,
  onChange,
  value,
}: {
  locale: "en" | "tr";
  onChange: (value: string) => void;
  value: string;
}) {
  const numericValue = Number(value);
  const decrease = () => onChange(String(Math.max(3, numericValue - 1)));
  const increase = () => onChange(String(Math.min(10, numericValue + 1)));

  return (
    <div className="flex h-9 items-center rounded-[10px] border border-[#d8d2d5] bg-white">
      <button aria-label={locale === "tr" ? "Top-K azalt" : "Decrease Top-K"} className="grid h-full w-8 place-items-center text-[#6e676a] hover:text-[#171416] disabled:cursor-not-allowed disabled:text-[#d8d2d5]" disabled={numericValue <= 3} onClick={decrease} type="button"><Minus aria-hidden="true" className="size-3.5" /></button>
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
      <button aria-label={locale === "tr" ? "Top-K artır" : "Increase Top-K"} className="grid h-full w-8 place-items-center text-[#6e676a] hover:text-[#171416] disabled:cursor-not-allowed disabled:text-[#d8d2d5]" disabled={numericValue >= 10} onClick={increase} type="button"><Plus aria-hidden="true" className="size-3.5" /></button>
    </div>
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
    finalContext: "LLM'e gönderilen final context", contextUsage: "Context kullanımı", answer: "Cevap", citations: "Doğrulanmış citations",
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
    finalContext: "Final context sent to the LLM", contextUsage: "Context usage", answer: "Answer", citations: "Validated citations",
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

  const workspaceCopy = preferences.locale === "tr"
    ? {
        description: "Bir soru sorun ve RAG sisteminizin cevaba nasıl ulaştığını inceleyin.",
        placeholder: "Dokümanınıza sorun…",
        stageTrace: "STAGE TRACE",
        retrievedTitle: "Getirilen adaylar",
        retrievedDescription: "Retrieval, cevabı içerme olasılığı en yüksek aday parçaları bulur. Bunlar henüz final context değildir.",
        contextTitle: "Context oluştur",
        contextDescription: "Getirilen parçalar otomatik olarak final context'e girmez. StepLab, token bütçesine uyan adayları seçer.",
        answerDescription: "Model, yalnız final context'e dayalı ve kaynaklara geri bağlanan bir cevap üretir.",
        readyTitle: "RAG'inizi test etmeye hazır",
        readyDescription: "Retrieval, context ve final cevabı incelemek için bir soru sorun.",
        previousRuns: "Önceki çalıştırmalar",
        viewSource: "Kaynağı görüntüle",
        retrievalDetails: "Retrieval ayrıntıları",
        includedNoteTitle: "Getirilen, dahil edilenle aynı değildir",
        includedNote: "Bir chunk getirilebilir ancak token bütçesi doluysa veya yeni bilgi eklemiyorsa final context'ten çıkarılabilir.",
        finalContext: "Final context",
        expandContext: "Final context'i genişlet",
        sources: "Kaynaklar",
        runDetails: "Çalıştırma ayrıntıları",
        complete: "Tamamlandı",
        candidate: "Aday",
        decision: "Karar",
        reason: "Neden",
        included: "Dahil edildi",
        excluded: "Çıkarıldı",
      }
    : {
        description: "Ask a question and inspect how your RAG system reaches the answer.",
        placeholder: "Ask your document…",
        stageTrace: "STAGE TRACE",
        retrievedTitle: "Retrieved candidates",
        retrievedDescription: "Retrieval finds candidate chunks most likely to contain the answer. These are not yet the final context.",
        contextTitle: "Build context",
        contextDescription: "Retrieved chunks are not automatically the final context. StepLab selects which candidates fit the token budget.",
        answerDescription: "The model generates an answer grounded only in the final context, with citations back to sources.",
        readyTitle: "Ready to test your RAG",
        readyDescription: "Ask a question to inspect retrieval, context and the final answer.",
        previousRuns: "Previous runs",
        viewSource: "View source",
        retrievalDetails: "Retrieval details",
        includedNoteTitle: "Retrieved is not the same as included",
        includedNote: "A chunk can be retrieved yet excluded from the final context — usually because the token budget is full or it adds little new information.",
        finalContext: "Final context",
        expandContext: "Expand final context",
        sources: "Sources",
        runDetails: "Run details",
        complete: "Complete",
        candidate: "Candidate",
        decision: "Decision",
        reason: "Reason",
        included: "Included",
        excluded: "Excluded",
      };

  return (
    <div className="min-w-0 overflow-x-clip bg-[#f8f7f7]">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <header className="h-[92px]">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#711f3a]">TEST</p>
          <h1 className="mt-1 text-[30px] font-semibold leading-9 tracking-[-0.02em] text-[#171416]">{copy.retrieval.title}</h1>
          <p className="mt-1 text-sm leading-5 text-[#6e676a]">{workspaceCopy.description}</p>
          {activeDocument ? <span className="sr-only">{activeDocument.fileName}</span> : null}
        </header>

        <section aria-label={copy.retrieval.title} className="mt-8 rounded-[16px] border border-[#e7e2e4] bg-white p-3">
          <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <div className="flex items-end gap-3">
              <div className="relative min-w-0 flex-1">
                <label className="sr-only" htmlFor="retrieval-question">{copy.retrieval.question}</label>
                <textarea aria-label={copy.retrieval.question} className="h-[75px] w-full resize-none rounded-[12px] border-0 px-3 py-2 text-[17px] leading-6 text-[#171416] outline-none placeholder:text-[#969093] focus-visible:ring-2 focus-visible:ring-[#711f3a]/15" id="retrieval-question" onChange={(event) => setQuestion(event.target.value)} placeholder={workspaceCopy.placeholder} value={question} />
                <AnimatePresence initial={false}>
                  {question ? <motion.div animate={{ opacity: 1, transform: "scale(1)" }} className="absolute right-1.5 top-1.5" exit={{ opacity: 0, transform: "scale(0.9)" }} initial={{ opacity: 0, transform: "scale(0.9)" }}><Button aria-label={copy.retrieval.clearQuestion} onClick={() => setQuestion("")} size="icon-xs" type="button" variant="ghost"><X aria-hidden="true" className="size-3.5" /></Button></motion.div> : null}
                </AnimatePresence>
              </div>
              <Button aria-busy={experimentStatus === "processing"} aria-describedby={!canAsk ? "ask-disabled-reason" : undefined} className="mb-1 h-[46px] min-w-[176px] gap-2 px-5" disabled={!canAsk} type="submit">
                <span aria-hidden="true" className="text-sm">✦</span>{labels.runExperiment}
              </Button>
            </div>
            {!canAsk ? <DisabledReason id="ask-disabled-reason">{askBlocker?.code === "missing_document" || askBlocker?.code === "missing_chunk" ? labels.reasonNoDocument : askBlocker?.message}</DisabledReason> : null}
          </form>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-[#e7e2e4] px-3 pt-3">
            <fieldset className="flex items-center gap-2">
              <legend className="text-[12.5px] font-medium text-[#6e676a]">{copy.retrieval.mode}</legend>
              <div aria-label={copy.retrieval.mode} className="flex h-11 items-center rounded-[10px] border border-[#e7e2e4] bg-[#f2eff0] p-1" role="group">
                {(["dense", "hybrid", "keyword"] as const).map((value) => <button aria-pressed={mode === value} className={mode === value ? "h-full rounded-[7px] bg-white px-4 text-[13px] font-medium text-[#171416] shadow-sm" : "h-full rounded-[7px] px-3 text-[13px] font-medium text-[#6e676a] hover:bg-white/70"} key={value} onClick={() => setMode(value)} type="button">{copy.retrieval.modes[value]}</button>)}
              </div>
            </fieldset>
            <div className="flex items-center gap-2"><span className="text-[12.5px] font-medium text-[#6e676a]">Top K</span><TopKControl locale={preferences.locale} onChange={setTopK} value={topK} /></div>
            <label className="flex items-center gap-2 text-[12.5px] font-medium text-[#6e676a]" htmlFor="reranker-enabled">{copy.retrieval.reranker}<Switch aria-label={copy.retrieval.reranker} checked={rerankerEnabled} id="reranker-enabled" onCheckedChange={setRerankerEnabled} /></label>
          </div>
          <div className="sr-only"><LearningHint locale={preferences.locale}>{preferences.locale === "tr" ? "Retrieval, seçili indexing pipeline'ın chunk'ları arasından soruya en uygun adayları bulur." : "Retrieval finds the most relevant candidates from the selected indexing pipeline's chunks."}</LearningHint><PipelineErrorMessage message={experimentError?.message} /></div>
          {experimentRun && experimentRun.status === "completed" ? <div className={savedRunMatches ? "mt-3 border border-[#c6ddcc] bg-[#eef4ef] px-3 py-2 text-xs text-[#3f7a55]" : "mt-3 border border-[#eadfc9] bg-[#fffaf1] px-3 py-2 text-xs text-[#8d651e]"} role="status"><strong>{savedRunMatches ? labels.viewingSaved : labels.draftDiffers}</strong><span className="ml-2">{labels.savedRunHint}</span>{experimentRun.reusedExperiment ? <span className="sr-only">{labels.exactReuse}</span> : null}</div> : null}
        </section>

        <details className="mt-6 rounded-[12px] border border-[#e7e2e4] bg-white">
          <summary className="flex h-[46px] cursor-pointer list-none items-center justify-between px-4 text-[13px] font-medium text-[#171416]"><span>{labels.advanced}</span><ChevronDown aria-hidden="true" className="size-4 text-[#969093] transition-transform" /></summary>
          <div className="grid gap-4 border-t border-[#e7e2e4] p-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-medium text-[#171416]" htmlFor="target-stage">{labels.target}<Select onValueChange={(value) => setTargetStage(value as ExperimentTargetStage)} value={targetStage}><SelectTrigger className="mt-2" id="target-stage"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="retrieval">{labels.retrieval}</SelectItem><SelectItem value="reranking">{labels.reranking}</SelectItem><SelectItem value="context">{labels.context}</SelectItem><SelectItem value="generation">{labels.generation}</SelectItem></SelectContent></Select></label>
            <label className="text-xs font-medium text-[#171416]" htmlFor="candidate-count">{labels.candidateCount}<Input className="mt-2" disabled={!rerankerEnabled} id="candidate-count" max={20} min={1} onChange={(event) => setCandidateCount(Number(event.target.value))} type="number" value={candidateCount} /></label>
            <label className="text-xs font-medium text-[#171416]" htmlFor="context-budget">{labels.tokenBudget}<Input className="mt-2" id="context-budget" max={12000} min={256} onChange={(event) => setTokenBudget(Number(event.target.value))} type="number" value={tokenBudget} /></label>
            <label className="text-xs font-medium text-[#171416]" htmlFor="generation-temperature">{labels.temperature}<Input className="mt-2" id="generation-temperature" max={2} min={0} onChange={(event) => setTemperature(Number(event.target.value))} step="0.1" type="number" value={temperature} /></label>
          </div>
          <div className="flex justify-end border-t border-[#e7e2e4] px-4 py-3"><Button aria-describedby={!hasChanges ? "retrieval-reset-disabled-reason" : undefined} className="gap-2" disabled={!hasChanges} onClick={reset} size="sm" variant="ghost"><RotateCcw aria-hidden="true" className="size-4" />{copy.retrieval.reset}</Button></div>
          {!hasChanges ? <DisabledReason id="retrieval-reset-disabled-reason">{copy.retrieval.nothingToReset}</DisabledReason> : null}
        </details>

        {!experimentRun ? (
          <section className="mt-8 flex h-[280px] items-center justify-center rounded-[16px] border border-[#e7e2e4] bg-white px-5 text-center">
            <div className="max-w-[360px]">
              <span aria-hidden="true" className="mx-auto grid size-14 place-items-center rounded-[16px] bg-[#fbf4f6] text-[#711f3a]"><Search className="size-6" /></span>
              <h2 className="mt-5 text-[18px] font-semibold text-[#171416]">{workspaceCopy.readyTitle}</h2>
              <p className="mt-2 text-sm leading-5 text-[#6e676a]">{workspaceCopy.readyDescription}</p>
              <span className="sr-only">{labels.noRun}</span>
            </div>
          </section>
        ) : (
          <div className="mt-8 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
            <aside className="min-w-0">
              <p className="text-[13px] font-semibold uppercase tracking-[0.05em] text-[#969093]">{workspaceCopy.stageTrace}</p>
              <div className="mt-3 rounded-[16px] border border-[#e7e2e4] bg-white p-4"><ExperimentStageTrace activeStage={activeStage} locale={preferences.locale} onSelect={setActiveStage} rerankerEnabled={rerankerEnabled} run={experimentRun} /></div>
              {experimentHistory.length ? <>
                <h2 className="mt-5 text-[13px] font-semibold text-[#171416]">{workspaceCopy.previousRuns}</h2>
                <div className="mt-2 space-y-2">{experimentHistory.slice(0, 3).map((run, index) => <button className="block w-full rounded-[10px] border border-[#e7e2e4] bg-white p-3 text-left hover:border-[#d8b5c2]" key={run.id} onClick={() => void loadExperiment(run.id)} type="button"><span className="block truncate text-[12.5px] font-medium text-[#171416]">{run.query || `${labels.run} ${index + 1}`}</span><span className="mt-1 block truncate text-[11.5px] text-[#969093]">{experimentRetrievalMode(run.config)} · {copy.retrieval.topK} {String(objectValue(run.config.retrieval).topK ?? "—")} · {run.timing.durationMs === null ? "—" : `${run.timing.durationMs} ms`}</span></button>)}</div>
              </> : null}
            </aside>

            <section className="min-w-0">
              {activeStage === "retrieval" ? <>
                <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-[18px] font-semibold text-[#171416]">{workspaceCopy.retrievedTitle}</h2><p className="mt-1 max-w-[560px] text-[13.5px] leading-5 text-[#6e676a]">{workspaceCopy.retrievedDescription}</p></div>{results?.retrieval ? <span className="rounded-full bg-[#eef4ef] px-3 py-1 text-[12px] font-medium text-[#3f7a55]">{mode} · {results.retrieval.candidates.length} {labels.candidates.toLowerCase()}</span> : null}</div>
                <div className="mt-5 space-y-3"><StageReuseBadge executedLabel={labels.executed} reusedLabel={labels.reused} sourceLabel={labels.source} stage="retrieval" reuse={results?.retrieval?.reuse} />{results?.retrieval?.candidates.length ? results.retrieval.candidates.map((candidate) => <article className="rounded-[16px] border border-[#e7e2e4] bg-white p-4" key={candidate.chunkId}><div className="flex items-start gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-[#f2eff0] font-mono text-[12px] text-[#171416]">{candidate.rank}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[13px] font-medium text-[#711f3a]">{candidate.headingPath?.join(" › ") || copy.retrieval.sourceDocument}</p><span className="font-mono text-[12px] text-[#6e676a]">{formatScore(candidate.score)} · p.{candidate.pageNumbers.join(", ") || "—"}</span></div><p className="mt-2 text-sm leading-5 text-[#6e676a]">{candidate.text}</p><div className="mt-3"><SourceInspector documentId={activeDocument?.id ?? null} headingPath={candidate.headingPath} pageNumbers={candidate.pageNumbers} parseResult={parseResult} sourceElementIds={candidate.sourceElementIds} triggerAriaLabel={preferences.locale === "tr" ? "Kaynağı incele" : "Inspect source"} triggerLabel={workspaceCopy.viewSource} /></div><details className="mt-2 rounded-[10px] border border-[#e7e2e4]"><summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13px] font-medium text-[#171416]"><span>{workspaceCopy.retrievalDetails}</span><ChevronDown aria-hidden="true" className="size-4 text-[#969093]" /></summary><div className="border-t border-[#e7e2e4] px-4 py-3 text-[11px] text-[#6e676a]"><p>{labels.provenance}: {candidate.sourceElementIds.join(", ") || "—"}</p>{mode === "hybrid" ? <p className="mt-1 font-mono">Dense {formatScore(candidate.denseScore)} · Keyword {formatScore(candidate.keywordScore)} · RRF {formatScore(candidate.rrfScore)}</p> : null}</div></details></div></div></article>) : <div className="rounded-[16px] border border-[#e7e2e4] bg-white p-6 text-sm text-[#6e676a]">{labels.noRun}</div>}</div>
              </> : null}

              {activeStage === "reranking" ? <>
                <div><h2 className="text-[18px] font-semibold text-[#171416]">{labels.reranking}</h2><p className="mt-1 text-[13.5px] leading-5 text-[#6e676a]">{labels.rerankingDescription}</p></div>
                <div className="mt-5 overflow-x-auto rounded-[16px] border border-[#e7e2e4] bg-white">{results?.reranking?.executed ? <Table><TableHeader><TableRow><TableHead>{copy.retrieval.rank}</TableHead><TableHead>{labels.originalRank}</TableHead><TableHead>{labels.rerankScore}</TableHead><TableHead>{copy.retrieval.preview}</TableHead></TableRow></TableHeader><TableBody>{results.reranking.candidates.map((candidate) => <TableRow key={candidate.chunkId}><TableCell className="font-semibold text-[#711f3a]">{candidate.rank}</TableCell><TableCell>{candidate.originalRank}</TableCell><TableCell>{formatScore(candidate.rerankScore)}</TableCell><TableCell className="whitespace-normal">{candidate.text}</TableCell></TableRow>)}</TableBody></Table> : <p className="p-6 text-sm text-[#6e676a]">{rerankerEnabled ? labels.noRun : labels.skipped}</p>}</div>
              </> : null}

              {activeStage === "context" ? <>
                <div><h2 className="text-[18px] font-semibold text-[#171416]">{workspaceCopy.contextTitle}</h2><p className="mt-1 max-w-[560px] text-[13.5px] leading-5 text-[#6e676a]">{workspaceCopy.contextDescription}</p></div>
                {results?.context ? <><div className="mt-5 rounded-[12px] border border-[#f3d9e0] bg-[#fbf4f6] p-4"><p className="text-[13px] font-semibold text-[#501329]">ⓘ <span className="ml-1">{workspaceCopy.includedNoteTitle}</span></p><p className="mt-2 text-[13px] leading-5 text-[#6e676a]">{workspaceCopy.includedNote}</p></div><div className="mt-5 overflow-hidden rounded-[16px] border border-[#e7e2e4] bg-white"><table className="w-full text-left text-[13px]"><thead className="text-[#6e676a]"><tr className="border-b border-[#e7e2e4]"><th className="px-4 py-3 font-medium">{workspaceCopy.candidate}</th><th className="px-4 py-3 font-medium">{workspaceCopy.decision}</th><th className="px-4 py-3 font-medium">{workspaceCopy.reason}</th><th className="px-4 py-3 text-right font-medium">{labels.tokens}</th></tr></thead><tbody>{results.context.candidates.map((candidate, index) => <tr className="border-b border-[#e7e2e4] last:border-0" key={candidate.chunkId}><td className="px-4 py-3 text-[#171416]">#{index + 1}</td><td className={candidate.selected ? "px-4 py-3 text-[#3f7a55]" : "px-4 py-3 text-[#969093]"}>{candidate.selected ? `✓ ${workspaceCopy.included}` : `△ ${workspaceCopy.excluded}`}</td><td className="px-4 py-3 text-[#6e676a]">{candidate.reason || "—"}</td><td className="px-4 py-3 text-right font-mono text-[#6e676a]">{candidate.tokenCount}</td></tr>)}</tbody></table></div><div className="mt-5 rounded-[16px] border border-[#e7e2e4] bg-white p-5"><div className="flex items-center justify-between gap-3"><h3 className="text-[13px] font-semibold text-[#171416]">{workspaceCopy.finalContext}</h3><span className="font-mono text-[12px] text-[#6e676a]">{results.context.tokenCount.toLocaleString()} / {results.context.tokenBudget.toLocaleString()} tokens</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e7e2e4]"><div className="h-full rounded-full bg-[#711f3a]" style={{ width: `${Math.min(100, (results.context.tokenCount / Math.max(1, results.context.tokenBudget)) * 100)}%` }} /></div><details className="mt-3"><summary className="cursor-pointer text-[13px] font-medium text-[#711f3a]">{workspaceCopy.expandContext}</summary><pre className="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-[#fbfafb] p-3 font-mono text-xs leading-5 text-[#171416]">{results.context.finalContext}</pre></details></div></> : <div className="mt-5 rounded-[16px] border border-[#e7e2e4] bg-white p-6 text-sm text-[#6e676a]">{labels.noRun}</div>}
              </> : null}

              {activeStage === "generation" ? <>
                <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-[18px] font-semibold text-[#171416]">{labels.answer}</h2><p className="mt-1 max-w-[560px] text-[13.5px] leading-5 text-[#6e676a]">{workspaceCopy.answerDescription}</p></div>{results?.generation ? <span className="rounded-full bg-[#eef4ef] px-3 py-1 text-[12px] font-medium text-[#3f7a55]">● {workspaceCopy.complete}</span> : null}</div>
                {results?.generation ? <><div className="mt-5 rounded-[16px] border border-[#e7e2e4] bg-white p-6"><StageReuseBadge executedLabel={labels.executed} reusedLabel={labels.reused} sourceLabel={labels.source} stage="generation" reuse={results.generation.reuse} />{results.generation.insufficientContext ? <p className="mt-3 rounded-[10px] border border-[#eadfc9] bg-[#fffaf1] px-3 py-2 text-sm text-[#8d651e]" role="status">{labels.insufficient}</p> : null}<p className="mt-3 whitespace-pre-wrap break-words text-base leading-[26px] text-[#171416]">{results.generation.answer}</p></div><div className="mt-5"><h3 className="text-[13px] font-semibold text-[#171416]">{workspaceCopy.sources}</h3><div className="mt-2 space-y-2">{results.generation.citations.length ? results.generation.citations.map((citation) => <div className="flex items-center gap-3 rounded-[10px] border border-[#e7e2e4] bg-white p-3" key={citation.citationId}><span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#fbf4f6] font-mono text-[12px] text-[#61182f]">{citation.citationId.replace(/\D/g, "") || "?"}</span><span className="min-w-0 flex-1 truncate text-[13px] text-[#171416]">{citation.quote || citation.citationId}</span><span className="shrink-0 text-[12px] text-[#969093]">p.{citation.pageNumbers.join(", ") || "—"}</span><SourceInspector documentId={activeDocument?.id ?? null} pageNumbers={citation.pageNumbers} parseResult={parseResult} sourceElementIds={citation.sourceElementIds} triggerLabel={citation.citationId} /></div>) : <p className="text-sm text-[#6e676a]">{copy.retrieval.noAnswer}</p>}</div></div><details className="mt-3 rounded-[12px] border border-[#e7e2e4] bg-white"><summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13px] font-medium text-[#171416]"><span>{workspaceCopy.runDetails}</span><ChevronDown aria-hidden="true" className="size-4 text-[#969093]" /></summary><div className="border-t border-[#e7e2e4] p-4"><RunMetadata locale={preferences.locale} run={experimentRun} /></div></details></> : <div className="mt-5 rounded-[16px] border border-[#e7e2e4] bg-white p-6 text-sm text-[#6e676a]">{copy.retrieval.noAnswer}</div>}
              </> : null}

            </section>
          </div>
        )}
        {experimentRun ? <div className="mt-6 flex flex-wrap items-center gap-2 rounded-[12px] border border-[#e7e2e4] bg-white px-4 py-3"><span className="mr-1 text-[13px] font-medium text-[#171416]">{labels.currentActions}</span>{canContinue ? <Button className="gap-2" onClick={() => void continueExperiment()} size="sm" variant="outline">{labels.continue}</Button> : null}{results?.generation ? <Button className="gap-2" disabled={!canRerunGeneration} onClick={() => void rerunGeneration()} size="sm" variant="outline">{labels.runAgain}</Button> : null}<Button className="gap-2" onClick={() => void navigator.clipboard.writeText(JSON.stringify(experimentRun, null, 2))} size="sm" variant="outline"><Copy aria-hidden="true" className="size-4" />{copy.retrieval.copyTrace}</Button></div> : <p className="mt-6 text-xs text-[#969093]">{copy.retrieval.noTrace}</p>}
        {experimentHistory.length ? <details className="mt-6 rounded-[12px] border border-[#e7e2e4] bg-white"><summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-[#171416]">{labels.history} · {labels.selectedRuns}: {compareIds.length}/2</summary><div className="overflow-x-auto border-t border-[#e7e2e4]"><Table><TableHeader><TableRow><TableHead>{labels.compare}</TableHead><TableHead>{labels.run}</TableHead><TableHead>{copy.retrieval.mode}</TableHead><TableHead>{copy.retrieval.question}</TableHead><TableHead>{labels.candidates}</TableHead><TableHead>{labels.duration}</TableHead><TableHead>{labels.load}</TableHead></TableRow></TableHeader><TableBody>{experimentHistory.map((run, index) => <TableRow key={run.id}><TableCell><input aria-label={`${labels.compare} ${run.id}`} checked={compareIds.includes(run.id)} disabled={!compareIds.includes(run.id) && compareIds.length >= 2} onChange={() => toggleCompare(run.id)} type="checkbox" /></TableCell><TableCell className="max-w-44 truncate text-xs font-medium text-[#501329]" title={run.id}>Experiment {index + 1}</TableCell><TableCell>{experimentRetrievalMode(run.config)}</TableCell><TableCell className="max-w-72 whitespace-normal">{run.query}</TableCell><TableCell>{isExperimentDetail(run) ? run.stageResults.retrieval?.candidates.length ?? 0 : run.candidateCount ?? 0}</TableCell><TableCell>{run.timing.durationMs === null ? "—" : `${run.timing.durationMs} ms`}</TableCell><TableCell><Button aria-label={`${labels.load} ${run.id}`} onClick={() => void loadExperiment(run.id)} size="sm" variant="ghost">{labels.load}</Button></TableCell></TableRow>)}</TableBody></Table>{selectedComparisonRuns.length ? <div className="grid gap-3 p-4 md:grid-cols-2">{selectedComparisonRuns.map((run, index) => <div className="border border-[#e7e2e4] bg-white p-4" key={run.id}><div className="text-xs font-semibold text-[#501329]">Experiment {index + 1}</div><dl className="mt-3 grid grid-cols-2 gap-2 text-xs"><div><dt className="text-[#969093]">{copy.retrieval.mode}</dt><dd className="mt-1">{experimentRetrievalMode(run.config)}</dd></div><div><dt className="text-[#969093]">{labels.duration}</dt><dd className="mt-1">{run.timing.durationMs ?? "—"} ms</dd></div><div><dt className="text-[#969093]">{labels.candidates}</dt><dd className="mt-1">{run.stageResults.retrieval?.candidates.length ?? 0}</dd></div><div><dt className="text-[#969093]">{labels.citations}</dt><dd className="mt-1">{run.stageResults.generation?.citations.filter((citation) => citation.valid).length ?? 0}</dd></div></dl></div>)}</div> : null}</div></details> : null}
      </div>
    </div>
  );
}
