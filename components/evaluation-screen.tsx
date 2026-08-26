"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Database, Play } from "lucide-react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import {
  DisabledReason,
  EmptyPipelineState,
  LearningHint,
  MetricCard,
  PipelineErrorMessage,
  RunMetadata,
  StageSection,
} from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { SourceInspector } from "@/components/source-inspector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UI_COPY } from "@/lib/copy";
import type { RetrievalMode } from "@/lib/rag-api-types";
import { firstBlocker } from "@/lib/blockers";

type EvaluationTab = "dataset" | "results" | "compare";

function metric(value: number | null) {
  return value === null ? "—" : value.toFixed(3);
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
  const [additionalCases, setAdditionalCases] = useState<
    Array<{ question: string; elements: string; reference: string }>
  >([]);
  const [datasetId, setDatasetId] = useState("");
  const [baseDatasetId, setBaseDatasetId] = useState<string | null>(null);
  const [mode, setMode] = useState<RetrievalMode>("hybrid");
  const [topK, setTopK] = useState("5");
  const [reranker, setReranker] = useState(false);
  const [judge, setJudge] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<EvaluationTab>("dataset");
  const [selectedCaseIndex, setSelectedCaseIndex] = useState(0);
  const labels =
    preferences.locale === "tr"
      ? {
          dataset: "Dataset",
          datasetTab: "Dataset",
          resultsTab: "Sonuçlar",
          compareTab: "Karşılaştır",
          resultsTitle: "Evaluation sonuçları",
          compareTitle: "Evaluation karşılaştırması",
          compareDescription:
            "Aynı dataset ve pipeline ayarları içindeki çalışmaları yan yana inceleyin.",
          datasetDescription:
            "Golden soru ve ilgili parse element ID'lerini kalıcı bir dataset sürümü olarak kaydeder.",
          name: "Dataset adı",
          question: "Golden soru",
          relevant: "İlgili element ID'leri",
          relevantHint:
            "Virgülle ayırın; gerçek parse element ID'lerini kullanın.",
          reference: "Referans cevap (opsiyonel)",
          create: "Dataset oluştur",
          needDocument: "Önce kalıcı parse run içeren bir doküman seçin.",
          selectDataset: "Dataset seç",
          run: "Evaluation çalıştır",
          judge: "Gemini judge",
          judgeModel: "Judge model",
          needPipeline: "Evaluation için aktif chunk ve embedding run gerekir.",
          metrics: "Ölçümler",
          history: "Evaluation geçmişi ve karşılaştırma",
          compare: "Karşılaştır",
          advanced: "Gelişmiş ayarlar",
          addCase: "Case ekle",
          removeCase: "Case'i kaldır",
          sourcePicker: "Parse source elementlerinden seç",
          newVersion: "Seçili dataset'ten yeni sürüm oluştur",
          hit: "Hit@K",
          recall: "Recall@K",
          precision: "Precision@K",
          mrr: "MRR",
          citation: "Citation validity",
          groundedness: "Groundedness",
          cases: "Case sayısı",
          progress: "Case ilerlemesi",
          duplicate: "Çoğalt",
          moveUp: "Yukarı",
          moveDown: "Aşağı",
          expected: "Beklenen kaynaklar",
          retrieved: "Getirilen kaynaklar",
          answer: "Üretilen cevap",
          noAnswer: "Generation bu case için çalıştırılmadı.",
          citations: "Citation'lar",
          retrievalNote:
            "Retrieval metrikleri golden relevant elementlerle hesaplanır; generation metrikleri ayrı gösterilir.",
          retrievalQuality: "Retrieval kalitesi",
          answerQuality: "Answer kalitesi",
          caseDiagnostics: "Case tanıları",
          selectedCase: "Seçili case",
        }
      : {
          dataset: "Dataset",
          datasetTab: "Dataset",
          resultsTab: "Results",
          compareTab: "Compare",
          resultsTitle: "Evaluation results",
          compareTitle: "Compare evaluation runs",
          compareDescription:
            "Inspect runs side by side within the same dataset and pipeline configuration.",
          datasetDescription:
            "Persists golden questions and relevant parse element IDs as a versioned dataset.",
          name: "Dataset name",
          question: "Golden question",
          relevant: "Relevant element IDs",
          relevantHint: "Comma-separated; use real parsed element IDs.",
          reference: "Reference answer (optional)",
          create: "Create dataset",
          needDocument: "Select a persisted document with a parse run first.",
          selectDataset: "Select dataset",
          run: "Run evaluation",
          judge: "Gemini judge",
          judgeModel: "Judge model",
          needPipeline: "Evaluation requires active chunk and embedding runs.",
          metrics: "Metrics",
          history: "Evaluation history and comparison",
          compare: "Compare",
          advanced: "Advanced settings",
          addCase: "Add case",
          removeCase: "Remove case",
          sourcePicker: "Select from parsed source elements",
          newVersion: "Create a new version from the selected dataset",
          hit: "Hit@K",
          recall: "Recall@K",
          precision: "Precision@K",
          mrr: "MRR",
          citation: "Citation validity",
          groundedness: "Groundedness",
          cases: "Cases",
          progress: "Case progress",
          duplicate: "Duplicate",
          moveUp: "Move up",
          moveDown: "Move down",
          expected: "Expected sources",
          retrieved: "Retrieved sources",
          answer: "Generated answer",
          noAnswer: "Generation was not run for this case.",
          citations: "Citations",
          retrievalNote:
            "Retrieval metrics use golden relevant elements; generation metrics remain separately visible.",
          retrievalQuality: "Retrieval quality",
          answerQuality: "Answer quality",
          caseDiagnostics: "Case diagnostics",
          selectedCase: "Selected case",
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
  const selectedRuns = useMemo(
    () => evaluationHistory.filter((run) => compareIds.includes(run.id)),
    [compareIds, evaluationHistory],
  );
  const selectedDataset = evaluationDatasets.find(
    (dataset) => dataset.id === selectedDatasetId,
  );
  const completedCases = evaluationRun?.caseResults?.length ?? 0;
  const totalCases = selectedDataset?.caseCount ?? 0;
  const activeCaseIndex = evaluationRun?.caseResults?.[selectedCaseIndex] ? selectedCaseIndex : 0;
  const selectedCase = evaluationRun?.caseResults?.[activeCaseIndex] ?? null;
  const parseElements =
    parseResult?.structured.pages.flatMap((page) => page.elements) ?? [];

  function toggleElement(current: string, elementId: string) {
    const values = current
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    return values.includes(elementId)
      ? values.filter((value) => value !== elementId).join(", ")
      : [...values, elementId].join(", ");
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
    void createDataset(
      datasetName.trim(),
      [
        {
          question: question.trim(),
          relevantElementIds: elementIds
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          referenceAnswer: referenceAnswer.trim() || null,
        },
        ...additionalCases.map((item) => ({
          question: item.question.trim(),
          relevantElementIds: item.elements
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          referenceAnswer: item.reference.trim() || null,
        })),
      ],
      baseDatasetId,
    );
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
    setCompareIds((current) =>
      current.includes(runId)
        ? current.filter((id) => id !== runId)
        : current.length < 2
          ? [...current, runId]
          : [current[1], runId],
    );
  }

  return (
    <div>
      <section className="border-b border-[#e7e2e4] px-4 py-7 sm:px-8 sm:py-9">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#711f3a]">
              {preferences.locale === "tr" ? "Ölçüm" : "Measure"}
            </p>
            <h1 className="mt-2 text-[28px] font-semibold leading-8 tracking-[-0.035em]">
          {copy.evaluation.title}
            </h1>
          </div>
          <p className="max-w-xl text-sm leading-6 text-[#6e676a]">
          {copy.evaluation.description}
          </p>
        </div>
      </section>

      <nav
        aria-label={
          preferences.locale === "tr"
            ? "Evaluation görünümleri"
            : "Evaluation views"
        }
        className="border-b border-[#e7e2e4] px-4 sm:px-8"
      >
        <div className="flex max-w-xl gap-1 overflow-x-auto" role="tablist">
          {(
            [
              ["dataset", labels.datasetTab],
              ["results", labels.resultsTab],
              ["compare", labels.compareTab],
            ] as const
          ).map(([tab, label]) => (
            <button
              aria-controls={`evaluation-panel-${tab}`}
              aria-selected={activeTab === tab}
              className={
                activeTab === tab
                  ? "border-b-2 border-[#711f3a] px-3 py-3 text-xs font-semibold text-[#711f3a]"
                  : "border-b-2 border-transparent px-3 py-3 text-xs font-medium text-[#6e676a] hover:border-[#d8b5c2] hover:text-[#501329]"
              }
              id={`evaluation-tab-${tab}`}
              key={tab}
              onClick={() => setActiveTab(tab)}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </nav>

      {activeTab === "dataset" ? (
        <div aria-labelledby="evaluation-tab-dataset" id="evaluation-panel-dataset" role="tabpanel">
          <StageSection
        description={labels.datasetDescription}
        locale={preferences.locale}
        status={
          evaluationDatasets.length
            ? "completed"
            : activeDocument?.activeParseRunId
              ? "ready"
              : "locked"
        }
        title={labels.dataset}
          >
        <LearningHint locale={preferences.locale}>
          {preferences.locale === "tr"
            ? "Golden case, bir soruyu ve beklenen kaynak elementlerini birlikte saklar. Böylece retrieval sonucu ölçülebilir olur."
            : "A golden case stores a question and its expected source elements together, making retrieval measurable."}
        </LearningHint>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.7fr)]">
          <div className="rounded-[12px] border border-[#e7e2e4] bg-white p-4 sm:p-5">
            <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium" htmlFor="dataset-name">
              {labels.name}
              <Input
                className="mt-2"
                id="dataset-name"
                onChange={(event) => setDatasetName(event.target.value)}
                value={datasetName}
              />
            </label>
            <label className="text-xs font-medium" htmlFor="golden-question">
              {labels.question}
              <Input
                className="mt-2"
                id="golden-question"
                onChange={(event) => setQuestion(event.target.value)}
                value={question}
              />
            </label>
            <div className="text-xs font-medium">
              {labels.relevant}
              {
                <>
                  <Input
                    aria-describedby="relevant-elements-hint"
                    className="mt-2 font-mono"
                    id="relevant-elements"
                    onChange={(event) => setElementIds(event.target.value)}
                    placeholder="element-1, element-4"
                    value={elementIds}
                  />
                  <span
                    className="mt-1 block text-[11px] leading-4 text-[#969093]"
                    id="relevant-elements-hint"
                  >
                    {labels.relevantHint}
                  </span>
                </>
              }
              {parseElements.length ? (
                <div
                  aria-label={labels.sourcePicker}
                  className="mt-2 flex max-h-36 flex-wrap gap-1 overflow-y-auto rounded border p-2"
                >
                  {parseElements.map((element) => {
                    const selected = elementIds
                      .split(",")
                      .map((value) => value.trim())
                      .includes(element.id);
                    return (
                      <button
                        aria-pressed={selected}
                        className={
                          selected
                            ? "rounded-md border border-[#d8b5c2] bg-[#fbf4f6] px-2 py-1 text-left text-[10px] text-[#501329]"
                            : "rounded-md border border-[#e7e2e4] px-2 py-1 text-left text-[10px] text-[#6e676a] hover:border-[#d8b5c2] hover:bg-[#fbf4f6]"
                        }
                        key={element.id}
                        onClick={() =>
                          setElementIds((current) =>
                            toggleElement(current, element.id),
                          )
                        }
                        type="button"
                      >
                        {sourceLabel(element)}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <label className="text-xs font-medium" htmlFor="reference-answer">
              {labels.reference}
              <Input
                className="mt-2"
                id="reference-answer"
                onChange={(event) => setReferenceAnswer(event.target.value)}
                value={referenceAnswer}
              />
            </label>
          </div>
          </div>
          {additionalCases.length ? (
            <div className="mt-4 space-y-3 sm:col-span-2">
              <h3 className="text-xs font-semibold">
                {preferences.locale === "tr"
                  ? "Ek golden case'ler"
                  : "Additional golden cases"}
              </h3>
              {additionalCases.map((item, index) => (
                <div
                  className="grid gap-3 border p-3 sm:grid-cols-2"
                  key={`case-${index}`}
                >
                  <label
                    className="text-xs font-medium"
                    htmlFor={`case-question-${index}`}
                  >
                    {labels.question}
                    <Input
                      className="mt-2"
                      id={`case-question-${index}`}
                      onChange={(event) =>
                        setAdditionalCases((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, question: event.target.value }
                              : entry,
                          ),
                        )
                      }
                      value={item.question}
                    />
                  </label>
                  <div className="text-xs font-medium">
                    {labels.relevant}
                    {
                      <Input
                        className="mt-2 font-mono"
                        id={`case-elements-${index}`}
                        onChange={(event) =>
                          setAdditionalCases((current) =>
                            current.map((entry, entryIndex) =>
                              entryIndex === index
                                ? { ...entry, elements: event.target.value }
                                : entry,
                            ),
                          )
                        }
                        value={item.elements}
                      />
                    }
                    <div
                      aria-label={`${labels.sourcePicker} ${index + 2}`}
                      className="mt-2 flex max-h-28 flex-wrap gap-1 overflow-y-auto rounded border p-2"
                    >
                      {parseElements.map((element) => {
                        const selected = item.elements
                          .split(",")
                          .map((value) => value.trim())
                          .includes(element.id);
                        return (
                          <button
                            aria-pressed={selected}
                            className={
                              selected
                                ? "rounded-md border border-[#d8b5c2] bg-[#fbf4f6] px-2 py-1 text-left text-[10px] text-[#501329]"
                                : "rounded-md border border-[#e7e2e4] px-2 py-1 text-left text-[10px] text-[#6e676a]"
                            }
                            key={element.id}
                            onClick={() =>
                              setAdditionalCases((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? {
                                        ...entry,
                                        elements: toggleElement(
                                          entry.elements,
                                          element.id,
                                        ),
                                      }
                                    : entry,
                                ),
                              )
                            }
                            type="button"
                          >
                            {sourceLabel(element)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <label
                    className="text-xs font-medium sm:col-span-2"
                    htmlFor={`case-reference-${index}`}
                  >
                    {labels.reference}
                    <Input
                      className="mt-2"
                      id={`case-reference-${index}`}
                      onChange={(event) =>
                        setAdditionalCases((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, reference: event.target.value }
                              : entry,
                          ),
                        )
                      }
                      value={item.reference}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    <Button
                      onClick={() =>
                        setAdditionalCases((current) => [
                          ...current.slice(0, index + 1),
                          { ...item },
                          ...current.slice(index + 1),
                        ])
                      }
                      size="sm"
                      variant="outline"
                    >
                      {labels.duplicate}
                    </Button>
                    <Button
                      disabled={index === 0}
                      onClick={() =>
                        setAdditionalCases((current) => {
                          const next = [...current];
                          [next[index - 1], next[index]] = [
                            next[index],
                            next[index - 1],
                          ];
                          return next;
                        })
                      }
                      size="sm"
                      variant="ghost"
                    >
                      {labels.moveUp}
                    </Button>
                    <Button
                      disabled={index === additionalCases.length - 1}
                      onClick={() =>
                        setAdditionalCases((current) => {
                          const next = [...current];
                          [next[index], next[index + 1]] = [
                            next[index + 1],
                            next[index],
                          ];
                          return next;
                        })
                      }
                      size="sm"
                      variant="ghost"
                    >
                      {labels.moveDown}
                    </Button>
                    <Button
                      onClick={() =>
                        setAdditionalCases((current) =>
                          current.filter(
                            (_, entryIndex) => entryIndex !== index,
                          ),
                        )
                      }
                      size="sm"
                      variant="ghost"
                    >
                      {labels.removeCase}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <Button
            className="sm:col-span-2 sm:w-fit"
            onClick={() =>
              setAdditionalCases((current) => [
                ...current,
                { question: "", elements: "", reference: "" },
              ])
            }
            size="sm"
            type="button"
            variant="outline"
          >
            {labels.addCase}
          </Button>
          <div>
            <Button
              aria-describedby={
                !canCreateDataset ? "dataset-disabled-reason" : undefined
              }
              aria-busy={evaluationStatus === "processing"}
              className="w-full gap-2"
              disabled={!canCreateDataset}
              onClick={handleCreateDataset}
            >
              <Database aria-hidden="true" className="size-4" />
              {labels.create}
            </Button>
            {!canCreateDataset ? (
              <DisabledReason id="dataset-disabled-reason">
                {datasetBlocker?.message}
              </DisabledReason>
            ) : null}
            {evaluationDatasets.length ? (
              <div className="mt-4 space-y-2">
                {evaluationDatasets.map((dataset) => (
                  <article
                    className={
                      dataset.id === baseDatasetId
                      ? "rounded-[10px] border border-[#d8b5c2] bg-[#fbf4f6] p-3"
                      : "rounded-[10px] border border-[#e7e2e4] bg-white p-3"
                    }
                    key={dataset.id}
                  >
                    <button
                      className="w-full text-left"
                      onClick={() => {
                        setDatasetId(dataset.id);
                        setBaseDatasetId(dataset.id);
                      }}
                      type="button"
                    >
                      <div className="text-sm font-medium">
                        {dataset.name} · v{dataset.version}
                      </div>
                      <div className="mt-2 text-xs text-[#6e676a]">
                        {dataset.caseCount} {labels.cases}
                      </div>
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyPipelineState>
                {copy.evaluation.emptyDescription}
              </EmptyPipelineState>
            )}
          </div>
        </div>
          </StageSection>
        </div>
      ) : null}

      {activeTab === "results" ? (
        <div aria-labelledby="evaluation-tab-results" id="evaluation-panel-results" role="tabpanel">
          <StageSection
        description={labels.retrievalNote}
        locale={preferences.locale}
        status={evaluationStatus}
        title={labels.resultsTitle}
          >
        {evaluationRun ? (
          <LearningHint locale={preferences.locale}>
            {preferences.locale === "tr"
              ? "Hit@K, Recall@K ve Precision@K retrieval kaynaklarının bulunmasını; MRR doğru kaynağın sırasını; Citation validity ve Groundedness ise cevabın kaynaklara dayanmasını ölçer. Değerleri aynı dataset ve ayar içinde karşılaştırın; evrensel iyi/kötü eşiği değildir."
              : "Hit@K, Recall@K, and Precision@K measure whether expected sources were retrieved; MRR measures their rank; Citation validity and Groundedness inspect source-supported answers. Compare values within the same dataset and configuration, not against universal good/bad thresholds."}
          </LearningHint>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="space-y-3 rounded-[12px] border border-[#e7e2e4] bg-white p-4">
            <label className="text-xs font-medium" htmlFor="evaluation-dataset">
              {labels.selectDataset}
              <Select
                onValueChange={(value) => {
                  setDatasetId(value);
                  setBaseDatasetId(value);
                }}
                value={selectedDatasetId}
              >
                <SelectTrigger className="mt-2" id="evaluation-dataset">
                  <SelectValue placeholder={labels.selectDataset} />
                </SelectTrigger>
                <SelectContent>
                  {evaluationDatasets.map((dataset) => (
                    <SelectItem key={dataset.id} value={dataset.id}>
                      {dataset.name} · v{dataset.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <details className="border px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold">
                {labels.advanced}
              </summary>
              <div className="mt-3 space-y-3">
                <label
                  className="text-xs font-medium"
                  htmlFor="evaluation-mode"
                >
                  Mode
                  <Select
                    onValueChange={(value) => setMode(value as RetrievalMode)}
                    value={mode}
                  >
                    <SelectTrigger className="mt-2" id="evaluation-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dense">Dense</SelectItem>
                      <SelectItem value="keyword">Keyword</SelectItem>
                      <SelectItem value="hybrid">Hybrid</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label
                  className="text-xs font-medium"
                  htmlFor="evaluation-top-k"
                >
                  Top-K
                  <Select onValueChange={setTopK} value={topK}>
                    <SelectTrigger className="mt-2" id="evaluation-top-k">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">3</SelectItem>
                      <SelectItem value="5">5</SelectItem>
                      <SelectItem value="10">10</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label
                  className="flex items-center justify-between gap-3 text-xs font-medium"
                  htmlFor="evaluation-reranker"
                >
                  Reranker
                  <Switch
                    checked={reranker}
                    id="evaluation-reranker"
                    onCheckedChange={setReranker}
                  />
                </label>
                <label
                  className="flex items-center justify-between gap-3 text-xs font-medium"
                  htmlFor="evaluation-judge"
                >
                  <span>
                    {labels.judge}
                    <span className="mt-1 block font-normal text-[#6e676a]">
                      {labels.judgeModel}: {capabilities?.judgeModel || "—"}
                    </span>
                  </span>
                  <Switch
                    checked={judge}
                    id="evaluation-judge"
                    onCheckedChange={setJudge}
                  />
                </label>
              </div>
            </details>
            <Button
              aria-describedby={
                !canRun ? "evaluation-disabled-reason" : undefined
              }
              aria-busy={evaluationStatus === "processing"}
              className="w-full gap-2"
              disabled={!canRun}
              onClick={handleRun}
            >
              <Play aria-hidden="true" className="size-4" />
              {labels.run}
            </Button>
            {!canRun ? (
              <DisabledReason id="evaluation-disabled-reason">
                {evaluationBlocker?.message}
              </DisabledReason>
            ) : null}
            <PipelineErrorMessage message={evaluationError?.message} />
            {evaluationStatus === "processing" && totalCases > 0 ? (
              <div className="border p-3" role="status">
                <div className="flex justify-between text-xs">
                  <span>{labels.progress}</span>
                  <span>
                    {completedCases}/{totalCases}
                  </span>
                </div>
                <div
                  aria-valuemax={totalCases}
                  aria-valuemin={0}
                  aria-valuenow={completedCases}
                  className="mt-2 h-2 overflow-hidden rounded-full bg-[#f2eff0]"
                  role="progressbar"
                >
                  <div
                    className="h-full bg-[#711f3a] transition-[width]"
                    style={{
                      width: `${Math.min(100, (completedCases / totalCases) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ) : null}
          </div>
          <div>
            {evaluationRun ? (
              <>
                <RunMetadata locale={preferences.locale} run={evaluationRun} />
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <section className="rounded-[12px] border border-[#e7e2e4] bg-white p-4">
                    <h3 className="text-xs font-semibold text-[#501329]">{labels.retrievalQuality}</h3>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {[
                        [labels.hit, metric(evaluationRun.results.hitAtK)],
                        [labels.recall, metric(evaluationRun.results.recallAtK)],
                        [labels.precision, metric(evaluationRun.results.precisionAtK)],
                        [labels.mrr, metric(evaluationRun.results.mrr)],
                      ].map(([label, value]) => <MetricCard key={label} label={label} value={value} />)}
                    </div>
                  </section>
                  <section className="rounded-[12px] border border-[#e7e2e4] bg-white p-4">
                    <h3 className="text-xs font-semibold text-[#501329]">{labels.answerQuality}</h3>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {[
                        [labels.citation, metric(evaluationRun.results.citationValidity)],
                        [labels.groundedness, metric(evaluationRun.results.groundedness)],
                        [labels.cases, evaluationRun.results.caseCount === null ? "—" : String(evaluationRun.results.caseCount)],
                        [labels.judgeModel, evaluationRun.results.judgeModel ?? "—"],
                      ].map(([label, value]) => <MetricCard key={label} label={label} value={value} />)}
                    </div>
                  </section>
                </div>
                {evaluationRun.caseResults?.length ? (
                  <div className="mt-5" aria-label={labels.caseDiagnostics}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-[#501329]">{labels.caseDiagnostics}</h3>
                      <span className="text-[11px] text-[#969093]">{activeCaseIndex + 1}/{evaluationRun.caseResults.length}</span>
                    </div>
                    <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(220px,0.34fr)_minmax(0,0.66fr)]">
                      <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                        {evaluationRun.caseResults.map((item, index) => (
                          <button
                            aria-pressed={activeCaseIndex === index}
                            className={activeCaseIndex === index ? "w-full rounded-[10px] border border-[#d8b5c2] bg-[#fbf4f6] p-3 text-left" : "w-full rounded-[10px] border border-[#e7e2e4] bg-white p-3 text-left hover:border-[#d8b5c2]"}
                            key={item.experimentId || `${item.question}-${index}`}
                            onClick={() => setSelectedCaseIndex(index)}
                            type="button"
                          >
                            <span className="block truncate text-xs font-medium text-[#171416]">{index + 1}. {item.question}</span>
                            <span className="mt-2 grid grid-cols-2 gap-1 text-[10px] text-[#6e676a]"><span>Hit {item.hitAtK.toFixed(3)}</span><span>MRR {item.mrr.toFixed(3)}</span><span>Citation {item.citationValidity.toFixed(3)}</span><span>Grounded {item.groundedness.toFixed(3)}</span></span>
                          </button>
                        ))}
                      </div>
                      {selectedCase ? (
                        <article className="min-w-0 rounded-[10px] border border-[#e7e2e4] bg-white p-4 text-xs">
                          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[#969093]">{labels.selectedCase}</p><h4 className="mt-1 text-sm font-semibold text-[#171416]">{selectedCase.question}</h4></div><div className="grid grid-cols-4 gap-2 text-center text-[10px]"><span><strong className="block text-sm text-[#171416]">{selectedCase.hitAtK.toFixed(3)}</strong>Hit</span><span><strong className="block text-sm text-[#171416]">{selectedCase.recallAtK.toFixed(3)}</strong>Recall</span><span><strong className="block text-sm text-[#171416]">{selectedCase.precisionAtK.toFixed(3)}</strong>Precision</span><span><strong className="block text-sm text-[#171416]">{selectedCase.mrr.toFixed(3)}</strong>MRR</span></div></div>
                          <div className="mt-4 grid gap-3 border-t border-[#e7e2e4] pt-3 sm:grid-cols-2"><div><p className="font-medium">{labels.expected}</p><p className="mt-1 text-[#6e676a]">{selectedCase.expectedElementIds.length || "—"}</p>{selectedCase.expectedElementIds.length ? <SourceInspector documentId={activeDocument?.id ?? null} parseResult={parseResult} sourceElementIds={selectedCase.expectedElementIds} triggerLabel={labels.expected} /> : null}</div><div><p className="font-medium">{labels.retrieved}</p><p className="mt-1 text-[#6e676a]">{selectedCase.retrievedElementIds.length || "—"}</p>{selectedCase.retrievedElementIds.length ? <SourceInspector documentId={activeDocument?.id ?? null} parseResult={parseResult} sourceElementIds={selectedCase.retrievedElementIds} triggerLabel={labels.retrieved} /> : null}</div></div>
                          <div className="mt-4 border-t border-[#e7e2e4] pt-3"><p className="font-medium">{labels.answer}</p><p className="mt-1 whitespace-pre-wrap leading-5 text-[#6e676a]">{selectedCase.answer || labels.noAnswer}</p>{selectedCase.citations.length ? <p className="mt-2 text-[#6e676a]">{labels.citations}: {selectedCase.citations.length}</p> : null}</div>
                          {selectedCase.experimentId ? <details className="mt-3"><summary className="cursor-pointer text-[10px] text-[#6e676a]">{preferences.locale === "tr" ? "Teknik deney kimliği" : "Technical experiment ID"}</summary><p className="mt-1 break-all font-mono text-[10px] text-[#6e676a]">experiment: {selectedCase.experimentId}</p></details> : null}
                        </article>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center border-y px-5 text-center">
                <BarChart3
                  aria-hidden="true"
                  className="size-9 text-[#969093]"
                />
                <h2 className="mt-4 text-sm font-semibold">
                  {copy.evaluation.emptyTitle}
                </h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-[#6e676a]">
                  {copy.evaluation.emptyDescription}
                </p>
                <p className="mt-2 text-xs text-[#969093]">
                  {copy.evaluation.emptyNote}
                </p>
              </div>
            )}
          </div>
        </div>
          </StageSection>
        </div>
      ) : null}

      {activeTab === "compare" ? (
        <div aria-labelledby="evaluation-tab-compare" id="evaluation-panel-compare" role="tabpanel">
          <section className="border-t border-[#e7e2e4] px-4 py-7 sm:px-8">
        <div className="mb-5">
          <h2 className="text-sm font-semibold">{labels.compareTitle}</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[#6e676a]">{labels.compareDescription}</p>
        </div>
        {evaluationHistory.length ? (
          <div className="mt-4 overflow-x-auto rounded-[12px] border border-[#e7e2e4] bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{labels.compare}</TableHead>
                  <TableHead>Run</TableHead>
                  <TableHead>{labels.hit}</TableHead>
                  <TableHead>{labels.recall}</TableHead>
                  <TableHead>{labels.precision}</TableHead>
                  <TableHead>{labels.mrr}</TableHead>
                  <TableHead>{labels.citation}</TableHead>
                  <TableHead>{labels.groundedness}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {evaluationHistory.map((run, index) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <input
                        aria-label={`${labels.compare} ${index + 1}`}
                        checked={compareIds.includes(run.id)}
                        disabled={
                          !compareIds.includes(run.id) && compareIds.length >= 2
                        }
                        onChange={() => toggleCompare(run.id)}
                        type="checkbox"
                      />
                    </TableCell>
                    <TableCell className="text-xs">
                      <span>Run {evaluationHistory.length - index}</span>
                      <details className="mt-1"><summary className="cursor-pointer text-[10px] text-[#6e676a]">{preferences.locale === "tr" ? "Teknik kimlik" : "Technical ID"}</summary><span className="break-all font-mono text-[10px] text-[#6e676a]">{run.id}</span></details>
                    </TableCell>
                    <TableCell>{metric(run.results.hitAtK)}</TableCell>
                    <TableCell>{metric(run.results.recallAtK)}</TableCell>
                    <TableCell>{metric(run.results.precisionAtK)}</TableCell>
                    <TableCell>{metric(run.results.mrr)}</TableCell>
                    <TableCell>
                      {metric(run.results.citationValidity)}
                    </TableCell>
                    <TableCell>{metric(run.results.groundedness)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyPipelineState>{copy.evaluation.emptyTitle}</EmptyPipelineState>
        )}
        {selectedRuns.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {selectedRuns.map((run) => (
              <div className="rounded-[12px] border border-[#e7e2e4] bg-white p-4" key={run.id}>
                <div className="text-xs font-semibold text-[#501329]">{labels.compareTab}</div>
                <details className="mt-2"><summary className="cursor-pointer text-[10px] text-[#6e676a]">{preferences.locale === "tr" ? "Teknik kimlik" : "Technical ID"}</summary><div className="break-all font-mono text-[10px] text-[#6e676a]">{run.id}</div></details>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    [labels.recall, metric(run.results.recallAtK)],
                    [labels.mrr, metric(run.results.mrr)],
                    [labels.groundedness, metric(run.results.groundedness)],
                  ].map(([label, value]) => (
                    <MetricCard key={label} label={label} value={value} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
