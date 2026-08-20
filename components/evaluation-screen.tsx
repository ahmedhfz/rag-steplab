"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Database, Play } from "lucide-react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { DisabledReason, EmptyPipelineState, MetricCard, PipelineErrorMessage, RunMetadata, StageSection } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UI_COPY } from "@/lib/copy";
import type { RetrievalMode } from "@/lib/rag-api-types";

function metric(value: number | null) {
  return value === null ? "—" : value.toFixed(3);
}

export function EvaluationScreen() {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const {
    activeDocument,
    capabilities,
    evaluationDatasets,
    evaluationStatus,
    evaluationRun,
    evaluationError,
    evaluationHistory,
    createDataset,
    runEvaluation,
    refreshEvaluationRuns,
  } = useDocumentPipeline();
  const [datasetName, setDatasetName] = useState("");
  const [question, setQuestion] = useState("");
  const [elementIds, setElementIds] = useState("");
  const [referenceAnswer, setReferenceAnswer] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [mode, setMode] = useState<RetrievalMode>("hybrid");
  const [topK, setTopK] = useState("5");
  const [reranker, setReranker] = useState(false);
  const [judge, setJudge] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const labels = preferences.locale === "tr" ? {
    dataset: "Evaluation dataset", datasetDescription: "Golden soru ve ilgili parse element ID'lerini kalıcı bir dataset sürümü olarak kaydeder.",
    name: "Dataset adı", question: "Golden soru", relevant: "İlgili element ID'leri", relevantHint: "Virgülle ayırın; gerçek parse element ID'lerini kullanın.", reference: "Referans cevap (opsiyonel)", create: "Dataset oluştur",
    needDocument: "Önce kalıcı parse run içeren bir doküman seçin.", selectDataset: "Dataset seç", run: "Evaluation çalıştır", judge: "Gemini judge", judgeModel: "Judge model",
    needPipeline: "Evaluation için aktif chunk ve embedding run gerekir.", metrics: "Ölçümler", history: "Evaluation geçmişi ve karşılaştırma", compare: "Karşılaştır",
    hit: "Hit@K", recall: "Recall@K", precision: "Precision@K", mrr: "MRR", citation: "Citation validity", groundedness: "Groundedness", cases: "Case sayısı",
    retrievalNote: "Retrieval metrikleri golden relevant elementlerle hesaplanır; generation metrikleri ayrı gösterilir.",
  } : {
    dataset: "Evaluation dataset", datasetDescription: "Persists golden questions and relevant parse element IDs as a versioned dataset.",
    name: "Dataset name", question: "Golden question", relevant: "Relevant element IDs", relevantHint: "Comma-separated; use real parsed element IDs.", reference: "Reference answer (optional)", create: "Create dataset",
    needDocument: "Select a persisted document with a parse run first.", selectDataset: "Select dataset", run: "Run evaluation", judge: "Gemini judge", judgeModel: "Judge model",
    needPipeline: "Evaluation requires active chunk and embedding runs.", metrics: "Metrics", history: "Evaluation history and comparison", compare: "Compare",
    hit: "Hit@K", recall: "Recall@K", precision: "Precision@K", mrr: "MRR", citation: "Citation validity", groundedness: "Groundedness", cases: "Cases",
    retrievalNote: "Retrieval metrics use golden relevant elements; generation metrics remain separately visible.",
  };
  const canCreateDataset = Boolean(activeDocument?.id && activeDocument.activeParseRunId && datasetName.trim() && question.trim() && elementIds.trim() && evaluationStatus !== "processing");
  const selectedDatasetId = datasetId || evaluationDatasets[0]?.id || "";
  const canRun = Boolean(selectedDatasetId && activeDocument?.activeChunkRunId && activeDocument.activeEmbeddingRunId && evaluationStatus !== "processing");
  const selectedRuns = useMemo(() => evaluationHistory.filter((run) => compareIds.includes(run.id)), [compareIds, evaluationHistory]);

  useEffect(() => {
    if (selectedDatasetId) void refreshEvaluationRuns(selectedDatasetId);
  }, [refreshEvaluationRuns, selectedDatasetId]);

  function handleCreateDataset() {
    if (!canCreateDataset) return;
    void createDataset(datasetName.trim(), [{
      question: question.trim(),
      relevantElementIds: elementIds.split(",").map((value) => value.trim()).filter(Boolean),
      referenceAnswer: referenceAnswer.trim() || null,
    }]);
  }

  function handleRun() {
    if (!canRun) return;
    void runEvaluation({
      datasetId: selectedDatasetId,
      judge,
      retrieval: { mode, topK: Number(topK) },
      reranking: { enabled: reranker, candidateCount: 10 },
      context: { tokenBudget: 3000 },
      generation: { temperature: 0.1, maxOutputTokens: 1024 },
    });
  }

  function toggleCompare(runId: string) {
    setCompareIds((current) => current.includes(runId) ? current.filter((id) => id !== runId) : current.length < 2 ? [...current, runId] : [current[1], runId]);
  }

  return (
    <div>
      <section className="border-b px-4 py-7 sm:px-8 sm:py-9">
        <h1 className="text-[22px] font-semibold tracking-[-0.025em]">{copy.evaluation.title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{copy.evaluation.description}</p>
      </section>

      <StageSection description={labels.datasetDescription} locale={preferences.locale} status={evaluationDatasets.length ? "completed" : activeDocument?.activeParseRunId ? "ready" : "locked"} title={labels.dataset}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.7fr)]">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium" htmlFor="dataset-name">{labels.name}<Input className="mt-2" id="dataset-name" onChange={(event) => setDatasetName(event.target.value)} value={datasetName} /></label>
            <label className="text-xs font-medium" htmlFor="golden-question">{labels.question}<Input className="mt-2" id="golden-question" onChange={(event) => setQuestion(event.target.value)} value={question} /></label>
            <label className="text-xs font-medium" htmlFor="relevant-elements">{labels.relevant}<Input aria-describedby="relevant-elements-hint" className="mt-2 font-mono" id="relevant-elements" onChange={(event) => setElementIds(event.target.value)} placeholder="element-1, element-4" value={elementIds} /><span className="mt-1 block text-[11px] leading-4 text-slate-500" id="relevant-elements-hint">{labels.relevantHint}</span></label>
            <label className="text-xs font-medium" htmlFor="reference-answer">{labels.reference}<Input className="mt-2" id="reference-answer" onChange={(event) => setReferenceAnswer(event.target.value)} value={referenceAnswer} /></label>
          </div>
          <div>
            <Button aria-describedby={!canCreateDataset ? "dataset-disabled-reason" : undefined} aria-busy={evaluationStatus === "processing"} className="w-full gap-2" disabled={!canCreateDataset} onClick={handleCreateDataset}><Database aria-hidden="true" className="size-4" />{labels.create}</Button>
            {!canCreateDataset ? <DisabledReason id="dataset-disabled-reason">{labels.needDocument}</DisabledReason> : null}
            {evaluationDatasets.length ? <div className="mt-4 space-y-2">{evaluationDatasets.map((dataset) => <article className="border p-3" key={dataset.id}><div className="text-sm font-medium">{dataset.name} · v{dataset.version}</div><div className="mt-1 font-mono text-[10px] text-slate-500">{dataset.id}</div><div className="mt-2 text-xs text-slate-500">{dataset.cases.length} {labels.cases}</div></article>)}</div> : <EmptyPipelineState>{copy.evaluation.emptyDescription}</EmptyPipelineState>}
          </div>
        </div>
      </StageSection>

      <StageSection description={labels.retrievalNote} locale={preferences.locale} status={evaluationStatus} title={labels.metrics}>
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="space-y-3 border p-4">
            <label className="text-xs font-medium" htmlFor="evaluation-dataset">{labels.selectDataset}<Select onValueChange={setDatasetId} value={selectedDatasetId}><SelectTrigger className="mt-2" id="evaluation-dataset"><SelectValue placeholder={labels.selectDataset} /></SelectTrigger><SelectContent>{evaluationDatasets.map((dataset) => <SelectItem key={dataset.id} value={dataset.id}>{dataset.name} · v{dataset.version}</SelectItem>)}</SelectContent></Select></label>
            <label className="text-xs font-medium" htmlFor="evaluation-mode">Mode<Select onValueChange={(value) => setMode(value as RetrievalMode)} value={mode}><SelectTrigger className="mt-2" id="evaluation-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="dense">Dense</SelectItem><SelectItem value="keyword">Keyword</SelectItem><SelectItem value="hybrid">Hybrid</SelectItem></SelectContent></Select></label>
            <label className="text-xs font-medium" htmlFor="evaluation-top-k">Top-K<Select onValueChange={setTopK} value={topK}><SelectTrigger className="mt-2" id="evaluation-top-k"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="3">3</SelectItem><SelectItem value="5">5</SelectItem><SelectItem value="10">10</SelectItem></SelectContent></Select></label>
            <label className="flex items-center justify-between gap-3 text-xs font-medium" htmlFor="evaluation-reranker">Reranker<Switch checked={reranker} id="evaluation-reranker" onCheckedChange={setReranker} /></label>
            <label className="flex items-center justify-between gap-3 text-xs font-medium" htmlFor="evaluation-judge"><span>{labels.judge}<span className="mt-1 block font-normal text-slate-500">{labels.judgeModel}: {capabilities?.judgeModel || "—"}</span></span><Switch checked={judge} id="evaluation-judge" onCheckedChange={setJudge} /></label>
            <Button aria-describedby={!canRun ? "evaluation-disabled-reason" : undefined} aria-busy={evaluationStatus === "processing"} className="w-full gap-2" disabled={!canRun} onClick={handleRun}><Play aria-hidden="true" className="size-4" />{labels.run}</Button>
            {!canRun ? <DisabledReason id="evaluation-disabled-reason">{labels.needPipeline}</DisabledReason> : null}
            <PipelineErrorMessage message={evaluationError?.message} />
          </div>
          <div>
            {evaluationRun ? <><RunMetadata locale={preferences.locale} run={evaluationRun} /><div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">{[
              [labels.hit, metric(evaluationRun.results.hitAtK)], [labels.recall, metric(evaluationRun.results.recallAtK)], [labels.precision, metric(evaluationRun.results.precisionAtK)], [labels.mrr, metric(evaluationRun.results.mrr)],
              [labels.citation, metric(evaluationRun.results.citationValidity)], [labels.groundedness, metric(evaluationRun.results.groundedness)], [labels.cases, evaluationRun.results.caseCount === null ? "—" : String(evaluationRun.results.caseCount)], [labels.judgeModel, evaluationRun.results.judgeModel ?? "—"],
            ].map(([label, value]) => <MetricCard key={label} label={label} value={value} />)}</div></> : <div className="flex min-h-64 flex-col items-center justify-center border-y px-5 text-center"><BarChart3 aria-hidden="true" className="size-9 text-slate-500" /><h2 className="mt-4 text-sm font-semibold">{copy.evaluation.emptyTitle}</h2><p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{copy.evaluation.emptyDescription}</p><p className="mt-2 text-xs text-slate-500">{copy.evaluation.emptyNote}</p></div>}
          </div>
        </div>
      </StageSection>

      <section className="border-t px-4 py-6 sm:px-8">
        <h2 className="text-sm font-semibold">{labels.history}</h2>
        {evaluationHistory.length ? <div className="mt-4 overflow-x-auto border-t"><Table><TableHeader><TableRow><TableHead>{labels.compare}</TableHead><TableHead>Run</TableHead><TableHead>{labels.hit}</TableHead><TableHead>{labels.recall}</TableHead><TableHead>{labels.precision}</TableHead><TableHead>{labels.mrr}</TableHead><TableHead>{labels.citation}</TableHead><TableHead>{labels.groundedness}</TableHead></TableRow></TableHeader><TableBody>{evaluationHistory.map((run) => <TableRow key={run.id}><TableCell><input aria-label={`${labels.compare} ${run.id}`} checked={compareIds.includes(run.id)} disabled={!compareIds.includes(run.id) && compareIds.length >= 2} onChange={() => toggleCompare(run.id)} type="checkbox" /></TableCell><TableCell className="max-w-44 truncate font-mono text-xs" title={run.id}>{run.id}</TableCell><TableCell>{metric(run.results.hitAtK)}</TableCell><TableCell>{metric(run.results.recallAtK)}</TableCell><TableCell>{metric(run.results.precisionAtK)}</TableCell><TableCell>{metric(run.results.mrr)}</TableCell><TableCell>{metric(run.results.citationValidity)}</TableCell><TableCell>{metric(run.results.groundedness)}</TableCell></TableRow>)}</TableBody></Table></div> : <EmptyPipelineState>{copy.evaluation.emptyTitle}</EmptyPipelineState>}
        {selectedRuns.length ? <div className="mt-4 grid gap-3 md:grid-cols-2">{selectedRuns.map((run) => <div className="border p-4" key={run.id}><div className="break-all font-mono text-xs">{run.id}</div><div className="mt-3 grid grid-cols-3 gap-2">{[[labels.recall, metric(run.results.recallAtK)], [labels.mrr, metric(run.results.mrr)], [labels.groundedness, metric(run.results.groundedness)]].map(([label, value]) => <MetricCard key={label} label={label} value={value} />)}</div></div>)}</div> : null}
      </section>
    </div>
  );
}
