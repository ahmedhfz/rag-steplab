"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, CheckCircle2, ChevronDown, Database, Play, Plus, TriangleAlert } from "lucide-react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { DisabledReason, PipelineErrorMessage } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { SourceInspector } from "@/components/source-inspector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UI_COPY } from "@/lib/copy";
import type { RetrievalMode } from "@/lib/rag-api-types";
import { firstBlocker } from "@/lib/blockers";

type EvaluationTab = "dataset" | "results" | "compare";

function metric(value: number | null) {
  return value === null ? "—" : value.toFixed(3);
}

function statusPill(label: string, tone: "success" | "ready" | "muted" = "success") {
  const styles = tone === "success" ? "bg-[#eef4ef] text-[#3f7a55]" : tone === "ready" ? "bg-[#fbf4f6] text-[#711f3a]" : "bg-[#f2eff0] text-[#969093]";
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${styles}`}><span aria-hidden="true" className="size-1.5 rounded-full bg-current" />{label}</span>;
}

export function EvaluationScreen() {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const {
    activeDocument,
    parseResult,
    selectedParseRunId,
    selectedChunkRunId,
    selectedEmbeddingRunId,
    capabilities,
    evaluationDatasets,
    evaluationStatus,
    evaluationRun,
    evaluationError,
    evaluationHistory,
    createDataset,
    loadEvaluationDataset,
    runEvaluation,
    refreshEvaluationRuns,
  } = useDocumentPipeline();
  const [datasetName, setDatasetName] = useState("");
  const [question, setQuestion] = useState("");
  const [elementIds, setElementIds] = useState("");
  const [referenceAnswer, setReferenceAnswer] = useState("");
  const [additionalCases, setAdditionalCases] = useState<Array<{ question: string; elements: string; reference: string }>>([]);
  const [datasetId, setDatasetId] = useState("");
  const [baseDatasetId, setBaseDatasetId] = useState<string | null>(null);
  const [mode, setMode] = useState<RetrievalMode>("hybrid");
  const [topK, setTopK] = useState("5");
  const [reranker, setReranker] = useState(false);
  const [judge, setJudge] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<EvaluationTab>("dataset");
  const [selectedCaseIndex, setSelectedCaseIndex] = useState(0);

  const labels = preferences.locale === "tr"
    ? {
        dataset: "Dataset", datasetTab: "Dataset", resultsTab: "Sonuçlar", compareTab: "Karşılaştır", resultsTitle: "Evaluation sonuçları", compareTitle: "Evaluation karşılaştırması", compareDescription: "Aynı dataset ve pipeline ayarları içindeki çalışmaları yan yana inceleyin.", datasetDescription: "Golden soru ve ilgili parse element ID'lerini kalıcı bir dataset sürümü olarak kaydeder.", name: "Dataset adı", question: "Golden soru", relevant: "İlgili element ID'leri", relevantHint: "Virgülle ayırın; gerçek parse element ID'lerini kullanın.", reference: "Referans cevap (opsiyonel)", create: "Dataset oluştur", needDocument: "Önce kalıcı parse run içeren bir doküman seçin.", selectDataset: "Dataset seç", run: "Evaluation çalıştır", judge: "Gemini judge", judgeModel: "Judge model", needPipeline: "Evaluation için aktif chunk ve embedding run gerekir.", metrics: "Ölçümler", history: "Evaluation geçmişi ve karşılaştırma", compare: "Karşılaştır", advanced: "Gelişmiş ayarlar", addCase: "Case ekle", removeCase: "Case'i kaldır", sourcePicker: "Parse source elementlerinden seç", newVersion: "Seçili dataset'ten yeni sürüm oluştur", hit: "Hit@K", recall: "Recall@K", precision: "Precision@K", mrr: "MRR", citation: "Citation validity", groundedness: "Groundedness", cases: "Case sayısı", progress: "Case ilerlemesi", duplicate: "Çoğalt", moveUp: "Yukarı", moveDown: "Aşağı", expected: "Beklenen kaynaklar", retrieved: "Getirilen kaynaklar", answer: "Üretilen cevap", noAnswer: "Generation bu case için çalıştırılmadı.", citations: "Citation'lar", retrievalNote: "Retrieval metrikleri golden relevant elementlerle hesaplanır; generation metrikleri ayrı gösterilir.", retrievalQuality: "Retrieval kalitesi", answerQuality: "Answer kalitesi", caseDiagnostics: "Case tanıları", selectedCase: "Seçili case", noData: "Henüz evaluation verisi yok", datasetReady: "Dataset hazır", currentDataset: "Mevcut dataset'ler", runA: "RUN A", runB: "RUN B", metricDeltas: "METRIC DELTALARI", insight: "Karşılaştırılan run'lar arasındaki gerçek metrik farkları burada görünür.", noCompare: "Karşılaştırmak için en az iki gerçek evaluation run'ı gerekir.", included: "Dahil edildi", excluded: "Çıkarıldı",
      }
    : {
        dataset: "Dataset", datasetTab: "Dataset", resultsTab: "Results", compareTab: "Compare", resultsTitle: "Evaluation results", compareTitle: "Compare evaluation runs", compareDescription: "Inspect runs side by side within the same dataset and pipeline configuration.", datasetDescription: "Persists golden questions and relevant parse element IDs as a versioned dataset.", name: "Dataset name", question: "Golden question", relevant: "Relevant element IDs", relevantHint: "Comma-separated; use real parsed element IDs.", reference: "Reference answer (optional)", create: "Create dataset", needDocument: "Select a persisted document with a parse run first.", selectDataset: "Select dataset", run: "Run evaluation", judge: "Gemini judge", judgeModel: "Judge model", needPipeline: "Evaluation requires active chunk and embedding runs.", metrics: "Metrics", history: "Evaluation history and comparison", compare: "Compare", advanced: "Advanced settings", addCase: "Add case", removeCase: "Remove case", sourcePicker: "Select from parsed source elements", newVersion: "Create a new version from the selected dataset", hit: "Hit@K", recall: "Recall@K", precision: "Precision@K", mrr: "MRR", citation: "Citation validity", groundedness: "Groundedness", cases: "Cases", progress: "Case progress", duplicate: "Duplicate", moveUp: "Move up", moveDown: "Move down", expected: "Expected sources", retrieved: "Retrieved sources", answer: "Generated answer", noAnswer: "Generation was not run for this case.", citations: "Citations", retrievalNote: "Retrieval metrics use golden relevant elements; generation metrics remain separately visible.", retrievalQuality: "Retrieval quality", answerQuality: "Answer quality", caseDiagnostics: "Case diagnostics", selectedCase: "Selected case", noData: "No evaluation data yet", datasetReady: "Dataset ready", currentDataset: "Current datasets", runA: "RUN A", runB: "RUN B", metricDeltas: "METRIC DELTAS", insight: "Real metric differences between the selected runs appear here.", noCompare: "At least two real evaluation runs are required to compare.", included: "Included", excluded: "Excluded",
      };

  const datasetBlocker = firstBlocker(preferences.locale, [
    [evaluationStatus === "processing", "processing"],
    [!activeDocument?.id, "missing_document"],
    [!selectedParseRunId, "missing_parse"],
    [!datasetName.trim(), "invalid_config"],
    [!question.trim(), "missing_question"],
    [!elementIds.trim(), "missing_sources"],
    [additionalCases.some((item) => !item.question.trim()), "missing_question"],
    [additionalCases.some((item) => !item.elements.trim()), "missing_sources"],
  ]);
  const canCreateDataset = !datasetBlocker;
  const selectedDatasetId = datasetId || evaluationDatasets[0]?.id || "";
  const evaluationBlocker = firstBlocker(preferences.locale, [
    [evaluationStatus === "processing", "processing"],
    [!activeDocument?.id, "missing_document"],
    [!selectedDatasetId, "missing_dataset"],
    [!selectedChunkRunId, "missing_chunk"],
    [mode !== "keyword" && !selectedEmbeddingRunId, "missing_embedding"],
  ]);
  const canRun = !evaluationBlocker;
  const selectedRuns = useMemo(() => evaluationHistory.filter((run) => compareIds.includes(run.id)), [compareIds, evaluationHistory]);
  const selectedDataset = evaluationDatasets.find((dataset) => dataset.id === selectedDatasetId);
  const completedCases = evaluationRun?.caseResults?.length ?? 0;
  const totalCases = selectedDataset?.caseCount ?? 0;
  const activeCaseIndex = evaluationRun?.caseResults?.[selectedCaseIndex] ? selectedCaseIndex : 0;
  const parseElements = parseResult?.structured.pages.flatMap((page) => page.elements) ?? [];

  function toggleElement(current: string, elementId: string) {
    const values = current.split(",").map((value) => value.trim()).filter(Boolean);
    return values.includes(elementId) ? values.filter((value) => value !== elementId).join(", ") : [...values, elementId].join(", ");
  }

  function sourceLabel(element: (typeof parseElements)[number]) {
    return `${element.pageNumbers[0] ? `${preferences.locale === "tr" ? "Sayfa" : "Page"} ${element.pageNumbers[0]} · ` : ""}${element.type} · ${element.text.slice(0, 42)}`;
  }

  useEffect(() => {
    if (selectedDatasetId) {
      void loadEvaluationDataset(selectedDatasetId);
      void refreshEvaluationRuns(selectedDatasetId);
    }
  }, [loadEvaluationDataset, refreshEvaluationRuns, selectedDatasetId]);

  function handleCreateDataset() {
    if (!canCreateDataset) return;
    void createDataset(datasetName.trim(), [
      { question: question.trim(), relevantElementIds: elementIds.split(",").map((value) => value.trim()).filter(Boolean), referenceAnswer: referenceAnswer.trim() || null },
      ...additionalCases.map((item) => ({ question: item.question.trim(), relevantElementIds: item.elements.split(",").map((value) => value.trim()).filter(Boolean), referenceAnswer: item.reference.trim() || null })),
    ], baseDatasetId);
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

  const tabs: Array<[EvaluationTab, string]> = [["dataset", labels.datasetTab], ["results", labels.resultsTab], ["compare", labels.compareTab]];

  return (
    <div className="min-w-0 overflow-x-clip bg-[#f8f7f7]" data-testid="evaluation-screen">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <header className="h-[92px]" data-testid="evaluation-page-header">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#711f3a]">TEST</p>
          <h1 className="mt-1 text-[30px] font-semibold leading-9 tracking-[-0.02em] text-[#171416]">{copy.evaluation.title}</h1>
          <p className="mt-1 max-w-[680px] text-sm leading-5 text-[#6e676a]">{preferences.locale === "tr" ? "RAG sisteminizin kanıtı ne kadar güvenilir getirdiğini ve grounded cevaplar ürettiğini ölçün." : "Measure how reliably your RAG retrieves evidence and produces grounded answers."}</p>
        </header>

        <nav aria-label={preferences.locale === "tr" ? "Evaluation görünümleri" : "Evaluation views"} className="mt-8 border-b border-[#e7e2e4]" data-testid="evaluation-tabs" role="tablist">
          <div className="flex gap-2">{tabs.map(([tab, label]) => <button aria-controls={`evaluation-panel-${tab}`} aria-selected={activeTab === tab} className={activeTab === tab ? "border-b-2 border-[#711f3a] px-1 py-2.5 text-[13px] font-medium text-[#171416]" : "border-b-2 border-transparent px-1 py-2.5 text-[13px] font-medium text-[#6e676a] hover:text-[#501329]"} data-testid={`evaluation-tab-${tab}`} id={`evaluation-tab-${tab}`} key={tab} onClick={() => setActiveTab(tab)} role="tab" type="button">{label}</button>)}</div>
        </nav>

        {activeTab === "dataset" ? (
          <section aria-labelledby="evaluation-tab-dataset" className="mt-8" data-testid="evaluation-panel-dataset" id="evaluation-panel-dataset" role="tabpanel">
            <div className="rounded-[16px] border border-[#e7e2e4] bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-[18px] font-semibold text-[#171416]">{labels.dataset}</h2><p className="mt-1 max-w-[600px] text-[13.5px] leading-5 text-[#6e676a]">{labels.datasetDescription}</p></div>{evaluationDatasets.length ? statusPill(labels.datasetReady) : statusPill("Ready to build", "ready")}</div>
              <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-[13px] font-medium text-[#171416]" htmlFor="dataset-name">{labels.name}<Input className="mt-2" id="dataset-name" onChange={(event) => setDatasetName(event.target.value)} value={datasetName} /></label>
                  <label className="text-[13px] font-medium text-[#171416]" htmlFor="golden-question">{labels.question}<Input className="mt-2" id="golden-question" onChange={(event) => setQuestion(event.target.value)} value={question} /></label>
                  <div className="text-[13px] font-medium text-[#171416] sm:col-span-2"><label htmlFor="relevant-elements">{labels.relevant}</label><Input aria-describedby="relevant-elements-hint" className="mt-2 font-mono" id="relevant-elements" onChange={(event) => setElementIds(event.target.value)} placeholder="element-1, element-4" value={elementIds} /><span className="mt-1 block text-[11px] font-normal leading-4 text-[#969093]" id="relevant-elements-hint">{labels.relevantHint}</span>{parseElements.length ? <div aria-label={labels.sourcePicker} className="mt-2 flex max-h-28 flex-wrap gap-1 overflow-y-auto rounded-[10px] border border-[#e7e2e4] p-2">{parseElements.map((element) => { const selected = elementIds.split(",").map((value) => value.trim()).includes(element.id); return <button aria-pressed={selected} className={selected ? "rounded-[7px] border border-[#d8b5c2] bg-[#fbf4f6] px-2 py-1 text-left text-[10px] text-[#501329]" : "rounded-[7px] border border-[#e7e2e4] px-2 py-1 text-left text-[10px] text-[#6e676a] hover:border-[#d8b5c2]"} key={element.id} onClick={() => setElementIds((current) => toggleElement(current, element.id))} type="button">{sourceLabel(element)}</button>; })}</div> : null}</div>
                  <label className="text-[13px] font-medium text-[#171416] sm:col-span-2" htmlFor="reference-answer">{labels.reference}<Input className="mt-2" id="reference-answer" onChange={(event) => setReferenceAnswer(event.target.value)} value={referenceAnswer} /></label>
                  {additionalCases.length ? <div className="space-y-3 sm:col-span-2"><h3 className="text-[13px] font-semibold text-[#171416]">{preferences.locale === "tr" ? "Ek golden case'ler" : "Additional golden cases"}</h3>{additionalCases.map((item, index) => <div className="grid gap-3 rounded-[12px] border border-[#e7e2e4] p-3 sm:grid-cols-2" key={`case-${index}`}><label className="text-[12px] font-medium" htmlFor={`case-question-${index}`}>{labels.question}<Input className="mt-2" id={`case-question-${index}`} onChange={(event) => setAdditionalCases((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, question: event.target.value } : entry))} value={item.question} /></label><div className="text-[12px] font-medium"><label htmlFor={`case-elements-${index}`}>{labels.relevant}</label><Input className="mt-2 font-mono" id={`case-elements-${index}`} onChange={(event) => setAdditionalCases((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, elements: event.target.value } : entry))} value={item.elements} /><div aria-label={`${labels.sourcePicker} ${index + 2}`} className="mt-2 flex max-h-24 flex-wrap gap-1 overflow-y-auto rounded-[10px] border border-[#e7e2e4] p-2">{parseElements.map((element) => { const selected = item.elements.split(",").map((value) => value.trim()).includes(element.id); return <button aria-pressed={selected} className={selected ? "rounded-[7px] border border-[#d8b5c2] bg-[#fbf4f6] px-2 py-1 text-left text-[10px] text-[#501329]" : "rounded-[7px] border border-[#e7e2e4] px-2 py-1 text-left text-[10px] text-[#6e676a]"} key={element.id} onClick={() => setAdditionalCases((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, elements: toggleElement(entry.elements, element.id) } : entry))} type="button">{sourceLabel(element)}</button>; })}</div></div><label className="text-[12px] font-medium sm:col-span-2" htmlFor={`case-reference-${index}`}>{labels.reference}<Input className="mt-2" id={`case-reference-${index}`} onChange={(event) => setAdditionalCases((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, reference: event.target.value } : entry))} value={item.reference} /></label><div className="flex flex-wrap gap-2 sm:col-span-2"><Button onClick={() => setAdditionalCases((current) => [...current.slice(0, index + 1), { ...item }, ...current.slice(index + 1)])} size="sm" variant="outline">{labels.duplicate}</Button><Button disabled={index === 0} onClick={() => setAdditionalCases((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })} size="sm" variant="ghost">{labels.moveUp}</Button><Button disabled={index === additionalCases.length - 1} onClick={() => setAdditionalCases((current) => { const next = [...current]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; })} size="sm" variant="ghost">{labels.moveDown}</Button><Button onClick={() => setAdditionalCases((current) => current.filter((_, entryIndex) => entryIndex !== index))} size="sm" variant="ghost">{labels.removeCase}</Button></div></div>)}</div> : null}
                  <Button className="w-fit" onClick={() => setAdditionalCases((current) => [...current, { question: "", elements: "", reference: "" }])} size="sm" type="button" variant="outline"><Plus aria-hidden="true" className="size-4" />{labels.addCase}</Button>
                </div>
                <aside className="rounded-[12px] border border-[#e7e2e4] bg-[#fbfafb] p-4"><h3 className="text-[13px] font-semibold text-[#171416]">{labels.currentDataset}</h3><p className="mt-1 text-xs leading-5 text-[#6e676a]">{preferences.locale === "tr" ? "Dataset sürümleri burada görünür ve yeni versiyon için seçilebilir." : "Persisted dataset versions appear here and can be selected as a base."}</p>{evaluationDatasets.length ? <div className="mt-4 space-y-2">{evaluationDatasets.map((dataset) => <button className={dataset.id === baseDatasetId || dataset.id === selectedDatasetId ? "block w-full rounded-[10px] border border-[#d8b5c2] bg-[#fbf4f6] p-3 text-left" : "block w-full rounded-[10px] border border-[#e7e2e4] bg-white p-3 text-left hover:border-[#d8b5c2]"} key={dataset.id} onClick={() => { setDatasetId(dataset.id); setBaseDatasetId(dataset.id); }} type="button"><span className="block text-[13px] font-medium text-[#171416]">{dataset.name} · v{dataset.version}</span><span className="mt-1 block text-[11px] text-[#6e676a]">{dataset.caseCount} {labels.cases}</span></button>)}</div> : <div className="mt-4 rounded-[10px] border border-dashed border-[#d8d2d5] p-4 text-xs leading-5 text-[#6e676a]">{copy.evaluation.emptyDescription}</div>}</aside>
              </div>
              <div className="mt-5 flex flex-wrap items-start gap-3 border-t border-[#e7e2e4] pt-4"><Button aria-describedby={!canCreateDataset ? "dataset-disabled-reason" : undefined} aria-busy={evaluationStatus === "processing"} className="gap-2" disabled={!canCreateDataset} onClick={handleCreateDataset}><Database aria-hidden="true" className="size-4" />{labels.create}</Button>{!canCreateDataset ? <DisabledReason id="dataset-disabled-reason">{datasetBlocker?.message}</DisabledReason> : null}</div>
            </div>
          </section>
        ) : null}

        {activeTab === "results" ? (
          <section aria-labelledby="evaluation-tab-results" className="mt-8" data-testid="evaluation-panel-results" id="evaluation-panel-results" role="tabpanel">
            <div className="rounded-[16px] border border-[#e7e2e4] bg-white p-5">
              <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
                <label className="min-w-[180px] text-[12.5px] font-medium text-[#6e676a]" htmlFor="evaluation-dataset">{labels.selectDataset}<Select onValueChange={(value) => { setDatasetId(value); setBaseDatasetId(value); }} value={selectedDatasetId}><SelectTrigger className="mt-2 h-9 text-[13px]" id="evaluation-dataset"><SelectValue placeholder={labels.selectDataset} /></SelectTrigger><SelectContent>{evaluationDatasets.map((dataset) => <SelectItem key={dataset.id} value={dataset.id}>{dataset.name} · v{dataset.version}</SelectItem>)}</SelectContent></Select></label>
                <fieldset><legend className="text-[12.5px] font-medium text-[#6e676a]">Retrieval</legend><div className="mt-2 flex h-9 items-center rounded-[9px] border border-[#e7e2e4] bg-[#f2eff0] p-1">{(["dense", "hybrid", "keyword"] as const).map((value) => <button aria-pressed={mode === value} className={mode === value ? "h-full rounded-[7px] bg-white px-3 text-[12px] font-medium text-[#171416] shadow-sm" : "h-full rounded-[7px] px-3 text-[12px] text-[#6e676a]"} key={value} onClick={() => setMode(value)} type="button">{copy.retrieval.modes[value]}</button>)}</div></fieldset>
                <label className="text-[12.5px] font-medium text-[#6e676a]" htmlFor="evaluation-top-k">Top K<Select onValueChange={setTopK} value={topK}><SelectTrigger className="mt-2 h-9 w-[76px] text-[13px]" id="evaluation-top-k"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="3">3</SelectItem><SelectItem value="5">5</SelectItem><SelectItem value="10">10</SelectItem></SelectContent></Select></label>
                <label className="flex items-end gap-2 pb-1 text-[12.5px] font-medium text-[#6e676a]" htmlFor="evaluation-reranker">{copy.retrieval.reranker}<Switch checked={reranker} id="evaluation-reranker" onCheckedChange={setReranker} /></label>
                <Button aria-describedby={!canRun ? "evaluation-disabled-reason" : undefined} aria-busy={evaluationStatus === "processing"} className="ml-auto h-[42px] gap-2" disabled={!canRun} onClick={handleRun}><Play aria-hidden="true" className="size-4" />{labels.run}</Button>
              </div>
              <details className="mt-4 rounded-[10px] border border-[#e7e2e4]"><summary className="flex h-[46px] cursor-pointer list-none items-center justify-between px-4 text-[13px] font-medium text-[#171416]"><span>{labels.advanced} — {labels.judge}</span><ChevronDown aria-hidden="true" className="size-4 text-[#969093]" /></summary><div className="grid gap-4 border-t border-[#e7e2e4] p-4 sm:grid-cols-2"><label className="flex items-center justify-between gap-3 text-[12px] font-medium" htmlFor="evaluation-judge"><span>{labels.judge}<span className="mt-1 block font-normal text-[#6e676a]">{labels.judgeModel}: {capabilities?.judgeModel || "—"}</span></span><Switch checked={judge} id="evaluation-judge" onCheckedChange={setJudge} /></label><p className="text-xs leading-5 text-[#6e676a]">{labels.retrievalNote}</p></div></details>
              {!canRun ? <DisabledReason id="evaluation-disabled-reason">{evaluationBlocker?.message}</DisabledReason> : null}<PipelineErrorMessage message={evaluationError?.message} />
            </div>

            {evaluationRun ? (
              <>
                <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_428px]">
                  <div>
                    <h2 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-[#969093]">{labels.retrievalQuality}</h2>
                    <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">{[[labels.hit, metric(evaluationRun.results.hitAtK)], [labels.recall, metric(evaluationRun.results.recallAtK)], [labels.precision, metric(evaluationRun.results.precisionAtK)], [labels.mrr, metric(evaluationRun.results.mrr)]].map(([label, value]) => <div key={label}><div className="text-[12px] uppercase tracking-[0.04em] text-[#969093]">{label}</div><div className="mt-2 text-[26px] font-semibold tracking-[-0.03em] text-[#171416]">{value}</div></div>)}</div>
                    <h2 className="mt-7 text-[13px] font-semibold uppercase tracking-[0.05em] text-[#969093]">{labels.answerQuality}</h2>
                    <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">{[[labels.citation, metric(evaluationRun.results.citationValidity)], [labels.groundedness, metric(evaluationRun.results.groundedness)]].map(([label, value]) => <div key={label}><div className="text-[12px] uppercase tracking-[0.04em] text-[#969093]">{label}</div><div className="mt-2 text-[26px] font-semibold tracking-[-0.03em] text-[#171416]">{value}</div></div>)}</div>
                  </div>
                  <aside className="rounded-[16px] border border-[#e7e2e4] bg-white p-5"><h2 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-[#969093]">{labels.cases}</h2><div className="mt-3 flex items-baseline gap-2"><span className="text-[30px] font-semibold text-[#171416]">{evaluationRun.results.caseCount ?? completedCases}</span><span className="text-[13px] text-[#6e676a]">/ {totalCases || completedCases} {preferences.locale === "tr" ? "geçti" : "passed"}</span></div><p className="mt-3 text-[12px] text-[#969093]">{labels.judgeModel} · {evaluationRun.results.judgeModel ?? "—"}</p><div aria-valuemax={totalCases || completedCases || 1} aria-valuemin={0} aria-valuenow={completedCases} className="mt-4 h-2 overflow-hidden rounded-full bg-[#e7e2e4]" role="progressbar"><div className="h-full rounded-full bg-[#3f7a55]" style={{ width: `${Math.min(100, (completedCases / Math.max(1, totalCases || completedCases)) * 100)}%` }} /></div></aside>
                </div>
                {evaluationRun.caseResults?.length ? <section aria-label={labels.caseDiagnostics} className="mt-8"><h2 className="text-[13px] font-semibold text-[#171416]">{labels.caseDiagnostics}</h2><div className="mt-3 space-y-2">{evaluationRun.caseResults.map((item, index) => { const passed = item.groundedness >= 0.5 && item.citationValidity >= 0.5; return <details className="overflow-hidden rounded-[16px] border border-[#e7e2e4] bg-white" key={item.experimentId || `${item.question}-${index}`} open={activeCaseIndex === index}><summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3" onClick={() => setSelectedCaseIndex(index)}><span aria-hidden="true" className={passed ? "grid size-6 shrink-0 place-items-center rounded-full bg-[#eef4ef] text-[#3f7a55]" : "grid size-6 shrink-0 place-items-center rounded-full bg-[#fbefef] text-[#a23b3b]"}>{passed ? <CheckCircle2 className="size-3.5" /> : <TriangleAlert className="size-3.5" />}</span><span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#171416]">{item.question}</span><span className="shrink-0 font-mono text-[11px] text-[#6e676a]">ground {item.groundedness.toFixed(2)} · cite {item.citationValidity.toFixed(2)}</span></summary><div className="grid gap-4 border-t border-[#e7e2e4] bg-[#fbfafb] p-4 md:grid-cols-2"><div><p className="text-[11px] uppercase tracking-wide text-[#969093]">{labels.expected}</p><p className="mt-2 text-[13px] text-[#711f3a]">{item.expectedElementIds.length || "—"}</p>{item.expectedElementIds.length ? <SourceInspector documentId={activeDocument?.id ?? null} parseResult={parseResult} sourceElementIds={item.expectedElementIds} triggerLabel={labels.expected} /> : null}</div><div><p className="text-[11px] uppercase tracking-wide text-[#969093]">{labels.retrieved}</p><p className="mt-2 text-[13px] text-[#171416]">{item.retrievedElementIds.length || "—"}</p>{item.retrievedElementIds.length ? <SourceInspector documentId={activeDocument?.id ?? null} parseResult={parseResult} sourceElementIds={item.retrievedElementIds} triggerLabel={labels.retrieved} /> : null}</div><div className="md:col-span-2"><p className="text-[11px] uppercase tracking-wide text-[#969093]">{labels.answer}</p><p className="mt-2 text-[13px] leading-5 text-[#6e676a]">{item.answer || labels.noAnswer}</p></div></div></details>; })}</div></section> : null}
                {evaluationStatus === "processing" && totalCases > 0 ? <div className="mt-4 rounded-[10px] border border-[#e7e2e4] bg-white p-3" role="status"><div className="flex justify-between text-xs"><span>{labels.progress}</span><span>{completedCases}/{totalCases}</span></div><div aria-valuemax={totalCases} aria-valuemin={0} aria-valuenow={completedCases} className="mt-2 h-2 overflow-hidden rounded-full bg-[#f2eff0]" role="progressbar"><div className="h-full bg-[#711f3a]" style={{ width: `${Math.min(100, (completedCases / totalCases) * 100)}%` }} /></div></div> : null}
              </>
            ) : (
              <div className="mt-8 flex min-h-[280px] flex-col items-center justify-center rounded-[16px] border border-[#e7e2e4] bg-white px-5 text-center"><BarChart3 aria-hidden="true" className="size-9 text-[#969093]" /><h2 className="mt-4 text-[18px] font-semibold text-[#171416]">{labels.noData}</h2><p className="mt-2 max-w-md text-sm leading-5 text-[#6e676a]">{copy.evaluation.emptyDescription}</p><p className="mt-2 text-xs text-[#969093]">{copy.evaluation.emptyNote}</p></div>
            )}
          </section>
        ) : null}

        {activeTab === "compare" ? (
          <section aria-labelledby="evaluation-tab-compare" className="mt-8" data-testid="evaluation-panel-compare" id="evaluation-panel-compare" role="tabpanel">
            {selectedRuns.length >= 2 ? <div data-testid="evaluation-compare-content"><div className="grid gap-6 lg:grid-cols-[1fr_48px_1fr] lg:items-center"><article className="rounded-[16px] border border-[#e7e2e4] bg-white p-5"><p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#711f3a]">{labels.runA}</p><h2 className="mt-3 text-[16px] font-medium text-[#171416]">{selectedRuns[0].results?.judgeModel || "Evaluation 1"}</h2><p className="mt-2 text-[12px] text-[#6e676a]">{selectedRuns[0].timing.durationMs === null ? "—" : `${selectedRuns[0].timing.durationMs} ms`} · {labels.cases} {selectedRuns[0].results?.caseCount ?? "—"}</p></article><span className="hidden text-center text-[12px] text-[#969093] lg:block">VS</span><article className="rounded-[16px] border border-[#e7e2e4] bg-white p-5"><p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#711f3a]">{labels.runB}</p><h2 className="mt-3 text-[16px] font-medium text-[#171416]">{selectedRuns[1].results?.judgeModel || "Evaluation 2"}</h2><p className="mt-2 text-[12px] text-[#6e676a]">{selectedRuns[1].timing.durationMs === null ? "—" : `${selectedRuns[1].timing.durationMs} ms`} · {labels.cases} {selectedRuns[1].results?.caseCount ?? "—"}</p></article></div><section className="mt-8"><h2 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-[#969093]">{labels.metricDeltas}</h2><div className="mt-4 space-y-5">{[[labels.recall, selectedRuns[0].results.recallAtK, selectedRuns[1].results.recallAtK], [labels.mrr, selectedRuns[0].results.mrr, selectedRuns[1].results.mrr], [labels.precision, selectedRuns[0].results.precisionAtK, selectedRuns[1].results.precisionAtK], [labels.groundedness, selectedRuns[0].results.groundedness, selectedRuns[1].results.groundedness], [labels.citation, selectedRuns[0].results.citationValidity, selectedRuns[1].results.citationValidity]].map(([label, first, second]) => { const a = typeof first === "number" ? first : 0; const b = typeof second === "number" ? second : 0; const delta = b - a; return <div className="grid grid-cols-[140px_minmax(0,1fr)_64px] items-center gap-4" key={String(label)}><span className="text-[13px] text-[#171416]">{label}</span><div className="h-2 rounded-full bg-[#f2eff0]"><div className="h-full rounded-full bg-[#9b2c55]" style={{ width: `${Math.max(0, Math.min(100, b * 100))}%` }} /></div><span className={delta >= 0 ? "rounded-[7px] bg-[#eef4ef] px-2 py-1 text-center font-mono text-[11px] text-[#3f7a55]" : "rounded-[7px] bg-[#fffaf1] px-2 py-1 text-center font-mono text-[11px] text-[#8d651e]"}>{delta >= 0 ? "+" : ""}{delta.toFixed(2)}</span></div>; })}</div></section><div className="mt-8 rounded-[12px] border border-[#e7e2e4] bg-white px-4 py-4 text-[13px] leading-5 text-[#6e676a]">{labels.insight}</div></div> : <div className="flex min-h-[280px] flex-col items-center justify-center rounded-[16px] border border-[#e7e2e4] bg-white px-5 text-center"><BarChart3 aria-hidden="true" className="size-9 text-[#969093]" /><h2 className="mt-4 text-[18px] font-semibold text-[#171416]">{labels.compareTitle}</h2><p className="mt-2 max-w-md text-sm leading-5 text-[#6e676a]">{labels.noCompare}</p></div>}
            <details className="mt-6 rounded-[12px] border border-[#e7e2e4] bg-white" data-testid="evaluation-history"><summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13px] font-medium text-[#171416]"><span>{labels.history}</span><ChevronDown aria-hidden="true" className="size-4 text-[#969093]" /></summary><div className="border-t border-[#e7e2e4] p-4">{evaluationHistory.length ? <Table><TableHeader><TableRow><TableHead>{labels.compare}</TableHead><TableHead>Run</TableHead><TableHead>{labels.hit}</TableHead><TableHead>{labels.recall}</TableHead><TableHead>{labels.precision}</TableHead><TableHead>{labels.mrr}</TableHead><TableHead>{labels.citation}</TableHead><TableHead>{labels.groundedness}</TableHead></TableRow></TableHeader><TableBody>{evaluationHistory.map((run, index) => <TableRow key={run.id}><TableCell><input aria-label={`${labels.compare} ${index + 1}`} checked={compareIds.includes(run.id)} disabled={!compareIds.includes(run.id) && compareIds.length >= 2} onChange={() => toggleCompare(run.id)} type="checkbox" /></TableCell><TableCell className="text-xs">Run {evaluationHistory.length - index}</TableCell><TableCell>{metric(run.results.hitAtK)}</TableCell><TableCell>{metric(run.results.recallAtK)}</TableCell><TableCell>{metric(run.results.precisionAtK)}</TableCell><TableCell>{metric(run.results.mrr)}</TableCell><TableCell>{metric(run.results.citationValidity)}</TableCell><TableCell>{metric(run.results.groundedness)}</TableCell></TableRow>)}</TableBody></Table> : <p className="text-sm text-[#6e676a]">{labels.noCompare}</p>}</div></details>
          </section>
        ) : null}
      </div>
    </div>
  );
}
