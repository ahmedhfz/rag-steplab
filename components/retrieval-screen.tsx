"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Copy, Play, RotateCcw, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { DisabledReason, EmptyPipelineState, PipelineErrorMessage, RunMetadata, StageSection } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UI_COPY } from "@/lib/copy";
import type { ExperimentTargetStage, RetrievalMode } from "@/lib/rag-api-types";

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

export function RetrievalScreen() {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const {
    activeDocument,
    capabilities,
    chunkRun,
    embeddingRun,
    experimentStatus,
    experimentRun,
    experimentError,
    experimentHistory,
    runExperiment,
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
  const activeChunkRunId = chunkRun?.id ?? activeDocument?.activeChunkRunId;
  const activeEmbeddingRunId = embeddingRun?.id ?? activeDocument?.activeEmbeddingRunId;
  const needsEmbedding = mode !== "keyword";
  const canAsk = Boolean(question.trim() && activeDocument?.id && activeChunkRunId && (!needsEmbedding || activeEmbeddingRunId) && experimentStatus !== "processing");
  const labels = preferences.locale === "tr" ? {
    target: "Hedef aşama", retrieval: "Retrieval", reranking: "Reranking", context: "Context construction", generation: "Generation",
    candidateCount: "Rerank aday sayısı", tokenBudget: "Context token bütçesi", temperature: "Temperature",
    reasonNoDocument: "Önce kalıcı bir doküman seçin ve chunking çalıştırın.",
    reasonNoEmbedding: "Dense ve hybrid arama için güncel embedding run gerekir. Keyword modu embedding olmadan çalışabilir.",
    input: "Input ve effective config", noRun: "Henüz gerçek bir retrieval experiment çalıştırılmadı.",
    originalRank: "İlk sıra", rerankScore: "Rerank skoru", selected: "Seçildi", excluded: "Elendi", reason: "Karar", tokens: "Token",
    finalContext: "LLM'e gönderilen final context", contextUsage: "Context kullanımı", answer: "Grounded cevap", citations: "Doğrulanmış citations",
    invalidCitation: "Backend doğrulamasını geçmedi", history: "Experiment geçmişi ve karşılaştırma", compare: "Karşılaştır", selectedRuns: "Seçili run",
    model: "Model", run: "Run", duration: "Süre", candidates: "Aday", provenance: "Kaynak elementler", insufficient: "Context cevap için yetersiz bulundu.",
    retrievalDescription: "Dense, keyword veya RRF hybrid adayları sonraki sıralama kararlarından ayrı tutulur.", rerankingDescription: "Opsiyonel reranking retrieval adaylarını alır ve sıra değişimlerini ayrı bir aşama olarak kaydeder.", contextDescription: "Adaylar final context Gemini'ye ulaşmadan önce açıkça seçilir veya elenir.", generationDescription: "Cevap yalnız final context'i kullanır; her citation kalıcı provenance ile doğrulanır.",
  } : {
    target: "Target stage", retrieval: "Retrieval", reranking: "Reranking", context: "Context construction", generation: "Generation",
    candidateCount: "Rerank candidate count", tokenBudget: "Context token budget", temperature: "Temperature",
    reasonNoDocument: "Select a persisted document and complete chunking first.",
    reasonNoEmbedding: "Dense and hybrid search require a current embedding run. Keyword mode can run without embeddings.",
    input: "Input and effective config", noRun: "No real retrieval experiment has run yet.",
    originalRank: "Original rank", rerankScore: "Rerank score", selected: "Selected", excluded: "Excluded", reason: "Decision", tokens: "Tokens",
    finalContext: "Final context sent to the LLM", contextUsage: "Context usage", answer: "Grounded answer", citations: "Validated citations",
    invalidCitation: "Rejected by backend validation", history: "Experiment history and comparison", compare: "Compare", selectedRuns: "Selected runs",
    model: "Model", run: "Run", duration: "Duration", candidates: "Candidates", provenance: "Source elements", insufficient: "The context was insufficient to answer.",
    retrievalDescription: "Dense, keyword, or RRF hybrid candidates remain separate from later ranking decisions.", rerankingDescription: "Optional reranking receives retrieval candidates and records rank changes as its own stage.", contextDescription: "Candidates are explicitly selected or excluded before the final context reaches Gemini.", generationDescription: "The answer uses only final context; every citation is validated against persisted provenance.",
  };
  const selectedComparisonRuns = useMemo(() => experimentHistory.filter((run) => compareIds.includes(run.id)), [compareIds, experimentHistory]);
  const results = experimentRun?.stageResults;

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
    <div>
      <section className="px-4 py-6 sm:px-7">
        <h1 className="text-[22px] font-semibold tracking-[-0.025em]">{copy.retrieval.title}</h1>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <label className="sr-only" htmlFor="retrieval-question">{copy.retrieval.question}</label>
            <Input aria-label={copy.retrieval.question} className="h-12 pr-11 text-sm" id="retrieval-question" onChange={(event) => setQuestion(event.target.value)} placeholder={copy.retrieval.questionPlaceholder} value={question} />
            <AnimatePresence initial={false}>
              {question ? <motion.div animate={{ opacity: 1, transform: "scale(1)" }} className="absolute right-1.5 top-1.5" exit={{ opacity: 0, transform: "scale(0.9)" }} initial={{ opacity: 0, transform: "scale(0.9)" }}><Button aria-label={copy.retrieval.clearQuestion} onClick={() => setQuestion("")} size="icon" variant="ghost"><X aria-hidden="true" className="size-4" /></Button></motion.div> : null}
            </AnimatePresence>
          </div>
          <Button aria-busy={experimentStatus === "processing"} aria-describedby={!canAsk ? "ask-disabled-reason" : undefined} className="h-12 gap-2 px-8" disabled={!canAsk} onClick={submit}>
            <Play aria-hidden="true" className="size-4 fill-current" />{copy.retrieval.ask}
          </Button>
        </div>
        {!canAsk ? <DisabledReason id="ask-disabled-reason">{!activeDocument || !activeChunkRunId ? labels.reasonNoDocument : needsEmbedding && !activeEmbeddingRunId ? labels.reasonNoEmbedding : copy.retrieval.askUnavailable}</DisabledReason> : null}
        <PipelineErrorMessage message={experimentError?.message} />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <label className="text-xs font-medium" htmlFor="retrieval-top-k">{copy.retrieval.topK}<Select onValueChange={setTopK} value={topK}><SelectTrigger className="mt-2" id="retrieval-top-k"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="3">3</SelectItem><SelectItem value="5">5</SelectItem><SelectItem value="10">10</SelectItem></SelectContent></Select></label>
          <label className="text-xs font-medium" htmlFor="retrieval-mode">{copy.retrieval.mode}<Select onValueChange={(value) => setMode(value as RetrievalMode)} value={mode}><SelectTrigger className="mt-2" id="retrieval-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="dense">{copy.retrieval.modes.dense}</SelectItem><SelectItem value="hybrid">{copy.retrieval.modes.hybrid}</SelectItem><SelectItem value="keyword">{copy.retrieval.modes.keyword}</SelectItem></SelectContent></Select></label>
          <label className="text-xs font-medium" htmlFor="target-stage">{labels.target}<Select onValueChange={(value) => setTargetStage(value as ExperimentTargetStage)} value={targetStage}><SelectTrigger className="mt-2" id="target-stage"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="retrieval">{labels.retrieval}</SelectItem><SelectItem value="reranking">{labels.reranking}</SelectItem><SelectItem value="context">{labels.context}</SelectItem><SelectItem value="generation">{labels.generation}</SelectItem></SelectContent></Select></label>
          <label className="text-xs font-medium" htmlFor="reranker-enabled">{copy.retrieval.reranker}<span className="mt-2 flex h-9 items-center justify-between border px-3"><span>{rerankerEnabled ? capabilities?.rerankModel || "Gemini" : copy.retrieval.notConfigured}</span><Switch aria-label={copy.retrieval.reranker} checked={rerankerEnabled} id="reranker-enabled" onCheckedChange={setRerankerEnabled} /></span></label>
          <label className="text-xs font-medium" htmlFor="candidate-count">{labels.candidateCount}<Input className="mt-2" disabled={!rerankerEnabled} id="candidate-count" max={20} min={1} onChange={(event) => setCandidateCount(Number(event.target.value))} type="number" value={candidateCount} /></label>
          <label className="text-xs font-medium" htmlFor="context-budget">{labels.tokenBudget}<Input className="mt-2" id="context-budget" max={12000} min={256} onChange={(event) => setTokenBudget(Number(event.target.value))} type="number" value={tokenBudget} /></label>
          <label className="text-xs font-medium" htmlFor="generation-temperature">{labels.temperature}<Input className="mt-2" id="generation-temperature" max={2} min={0} onChange={(event) => setTemperature(Number(event.target.value))} step="0.1" type="number" value={temperature} /></label>
        </div>
        <div className="mt-3 flex justify-end"><Button aria-describedby={!hasChanges ? "retrieval-reset-disabled-reason" : undefined} className="gap-2" disabled={!hasChanges} onClick={reset} size="sm" variant="ghost"><RotateCcw aria-hidden="true" className="size-4" />{copy.retrieval.reset}</Button></div>
        {!hasChanges ? <DisabledReason id="retrieval-reset-disabled-reason">{copy.retrieval.nothingToReset}</DisabledReason> : null}
      </section>

      <StageSection description={labels.retrievalDescription} locale={preferences.locale} status={results?.retrieval ? "completed" : experimentStatus} title={labels.retrieval}>
        {experimentRun ? <RunMetadata locale={preferences.locale} run={experimentRun} /> : null}
        {results?.retrieval ? (
          <div className="mt-4 overflow-x-auto border-t"><Table><caption className="sr-only">{copy.retrieval.retrievedChunks}</caption><TableHeader><TableRow><TableHead>{copy.retrieval.rank}</TableHead><TableHead>{copy.retrieval.score}</TableHead><TableHead>Dense</TableHead><TableHead>Keyword</TableHead><TableHead>RRF</TableHead><TableHead>{copy.retrieval.page}</TableHead><TableHead className="min-w-72">{copy.retrieval.preview}</TableHead></TableRow></TableHeader><TableBody>{results.retrieval.candidates.map((candidate) => <TableRow key={candidate.chunkId}><TableCell>{candidate.rank}</TableCell><TableCell>{formatScore(candidate.score)}</TableCell><TableCell>{formatScore(candidate.denseScore)}</TableCell><TableCell>{formatScore(candidate.keywordScore)}</TableCell><TableCell>{formatScore(candidate.rrfScore)}</TableCell><TableCell>{candidate.pageNumbers.join(", ") || "—"}</TableCell><TableCell className="max-w-xl whitespace-normal leading-5"><p>{candidate.text}</p><p className="mt-1 break-all font-mono text-[10px] text-slate-500">{labels.provenance}: {candidate.sourceElementIds.join(", ") || "—"}</p></TableCell></TableRow>)}</TableBody></Table></div>
        ) : <EmptyPipelineState>{labels.noRun}</EmptyPipelineState>}
      </StageSection>

      <StageSection description={labels.rerankingDescription} locale={preferences.locale} status={results?.reranking?.executed ? "completed" : rerankerEnabled && experimentStatus === "processing" ? "processing" : "locked"} title={labels.reranking}>
        {results?.reranking?.executed ? <div className="overflow-x-auto border-t"><Table><TableHeader><TableRow><TableHead>{copy.retrieval.rank}</TableHead><TableHead>{labels.originalRank}</TableHead><TableHead>{labels.rerankScore}</TableHead><TableHead className="min-w-72">{copy.retrieval.preview}</TableHead></TableRow></TableHeader><TableBody>{results.reranking.candidates.map((candidate) => <TableRow key={candidate.chunkId}><TableCell>{candidate.rank}</TableCell><TableCell>{candidate.originalRank}</TableCell><TableCell>{formatScore(candidate.rerankScore)}</TableCell><TableCell className="whitespace-normal leading-5">{candidate.text}</TableCell></TableRow>)}</TableBody></Table></div> : <EmptyPipelineState>{rerankerEnabled ? labels.noRun : copy.retrieval.rerankerUnavailable}</EmptyPipelineState>}
      </StageSection>

      <StageSection description={labels.contextDescription} locale={preferences.locale} status={results?.context ? "completed" : "locked"} title={labels.context}>
        {results?.context ? <div className="grid gap-4 lg:grid-cols-2"><div className="space-y-2">{results.context.candidates.map((candidate) => <article className="border p-3" key={candidate.chunkId}><div className="flex items-center justify-between gap-2"><span className="font-mono text-[11px]">{candidate.chunkId}</span><span className={candidate.selected ? "text-emerald-700" : "text-slate-500"}>{candidate.selected ? labels.selected : labels.excluded}</span></div><p className="mt-2 text-sm leading-5">{candidate.text}</p><p className="mt-2 text-xs text-slate-500">{labels.reason}: {candidate.reason || "—"} · {candidate.tokenCount} {labels.tokens}</p><p className="mt-1 break-all font-mono text-[10px] text-slate-500">{labels.provenance}: {candidate.sourceElementIds.join(", ") || "—"}</p></article>)}</div><div><h3 className="text-sm font-semibold">{labels.finalContext}</h3><p className="mt-2 text-xs text-slate-500">{labels.contextUsage}: {results.context.tokenCount} / {results.context.tokenBudget}</p><pre className="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap border bg-slate-50 p-4 text-xs leading-6">{results.context.finalContext}</pre></div></div> : <EmptyPipelineState>{labels.noRun}</EmptyPipelineState>}
      </StageSection>

      <StageSection description={labels.generationDescription} locale={preferences.locale} status={results?.generation ? "completed" : "locked"} title={labels.generation}>
        {results?.generation ? <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"><article><h3 className="text-sm font-semibold">{labels.answer}</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-800">{results.generation.answer}</p><p className="mt-4 text-xs text-slate-500">{labels.model}: {results.generation.model ?? "—"} · input {results.generation.inputTokens ?? "—"} · output {results.generation.outputTokens ?? "—"}</p></article><aside><h3 className="text-sm font-semibold">{labels.citations}</h3><div className="mt-3 space-y-2">{results.generation.citations.length ? results.generation.citations.map((citation) => <div className={citation.valid ? "border border-emerald-200 bg-emerald-50 p-3" : "border border-red-200 bg-red-50 p-3"} key={citation.citationId}><div className="flex items-center gap-2 text-xs font-medium">{citation.valid ? <CheckCircle2 aria-hidden="true" className="size-4 text-emerald-700" /> : <X aria-hidden="true" className="size-4 text-red-700" />}<span>{citation.citationId}</span></div><p className="mt-2 break-all font-mono text-[10px]">chunk: {citation.chunkId} · pages: {citation.pageNumbers.join(", ") || "—"}</p>{citation.quote ? <p className="mt-2 text-xs leading-5">“{citation.quote}”</p> : null}{!citation.valid ? <p className="mt-2 text-xs text-red-700">{labels.invalidCitation}</p> : null}</div>) : <EmptyPipelineState>{copy.retrieval.noAnswer}</EmptyPipelineState>}</div></aside></div> : <EmptyPipelineState>{copy.retrieval.noAnswer}</EmptyPipelineState>}
      </StageSection>

      <section className="border-t px-4 py-6 sm:px-7">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">{labels.history}</h2><p className="mt-1 text-xs text-slate-500">{labels.selectedRuns}: {compareIds.length}/2</p></div><Button aria-describedby={!experimentRun ? "trace-disabled-reason" : undefined} className="gap-2" disabled={!experimentRun} onClick={() => experimentRun && void navigator.clipboard.writeText(JSON.stringify(experimentRun, null, 2))} size="sm" variant="outline"><Copy aria-hidden="true" className="size-4" />{copy.retrieval.copyTrace}</Button></div>
        {!experimentRun ? <DisabledReason id="trace-disabled-reason">{copy.retrieval.traceUnavailable}</DisabledReason> : null}
        {experimentHistory.length ? <div className="mt-4 overflow-x-auto border-t"><Table><TableHeader><TableRow><TableHead>{labels.compare}</TableHead><TableHead>{labels.run}</TableHead><TableHead>{copy.retrieval.mode}</TableHead><TableHead>{copy.retrieval.question}</TableHead><TableHead>{labels.candidates}</TableHead><TableHead>{labels.duration}</TableHead></TableRow></TableHeader><TableBody>{experimentHistory.map((run) => <TableRow key={run.id}><TableCell><input aria-label={`${labels.compare} ${run.id}`} checked={compareIds.includes(run.id)} disabled={!compareIds.includes(run.id) && compareIds.length >= 2} onChange={() => toggleCompare(run.id)} type="checkbox" /></TableCell><TableCell className="max-w-44 truncate font-mono text-xs" title={run.id}>{run.id}</TableCell><TableCell>{experimentRetrievalMode(run.config)}</TableCell><TableCell className="max-w-72 whitespace-normal">{run.query}</TableCell><TableCell>{run.stageResults.retrieval?.candidates.length ?? 0}</TableCell><TableCell>{run.timing.durationMs === null ? "—" : `${run.timing.durationMs} ms`}</TableCell></TableRow>)}</TableBody></Table></div> : <EmptyPipelineState>{copy.retrieval.noTrace}</EmptyPipelineState>}
        {selectedComparisonRuns.length ? <div className="mt-4 grid gap-3 md:grid-cols-2">{selectedComparisonRuns.map((run) => <div className="border p-4" key={run.id}><div className="break-all font-mono text-xs">{run.id}</div><dl className="mt-3 grid grid-cols-2 gap-2 text-xs"><div><dt className="text-slate-500">{copy.retrieval.mode}</dt><dd className="mt-1">{experimentRetrievalMode(run.config)}</dd></div><div><dt className="text-slate-500">{labels.duration}</dt><dd className="mt-1">{run.timing.durationMs ?? "—"} ms</dd></div><div><dt className="text-slate-500">{labels.candidates}</dt><dd className="mt-1">{run.stageResults.retrieval?.candidates.length ?? 0}</dd></div><div><dt className="text-slate-500">{labels.citations}</dt><dd className="mt-1">{run.stageResults.generation?.citations.filter((citation) => citation.valid).length ?? 0}</dd></div></dl></div>)}</div> : null}
      </section>
    </div>
  );
}
