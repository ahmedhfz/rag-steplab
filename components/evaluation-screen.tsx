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
import type { EvaluationRun, RetrievalMode } from "@/lib/rag-api-types";
import { firstBlocker } from "@/lib/blockers";

type EvaluationTab = "dataset" | "results" | "compare";
type EvaluationOutcome = "answer" | "insufficient_context";

type DraftEvaluationCase = {
  question: string;
  elements: string;
  reference: string;
  expectedOutcome: EvaluationOutcome;
};

function metric(value: number | null) {
  return value === null ? "—" : value.toFixed(3);
}

type ParsedSourceElement = {
  id: string;
  pageNumbers: number[];
  text: string;
  type: string;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function configValue(config: Record<string, unknown>, key: string) {
  return stringValue(config[key]) ?? stringValue(config[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)]);
}

function evaluationConfig(run: EvaluationRun) {
  const config = objectValue(run.config);
  const retrieval = objectValue(config.retrieval);
  const reranking = objectValue(config.reranking);
  const context = objectValue(config.context);
  const generation = objectValue(config.generation);
  return {
    pipelineId: configValue(config, "pipelineId"),
    chunkRunId: configValue(config, "chunkRunId") ?? stringValue(run.upstream.chunkRunId),
    embeddingRunId: configValue(config, "embeddingRunId") ?? stringValue(run.upstream.embeddingRunId),
    retrievalMode: stringValue(retrieval.mode),
    topK: numberValue(retrieval.topK),
    rerankerEnabled: booleanValue(reranking.enabled),
    candidateCount: numberValue(reranking.candidateCount),
    tokenBudget: numberValue(context.tokenBudget),
    temperature: numberValue(generation.temperature),
    maxOutputTokens: numberValue(generation.maxOutputTokens ?? generation.max_output_tokens),
    judge: booleanValue(config.judge),
  };
}

function comparableValue(left: string | number | boolean | null, right: string | number | boolean | null) {
  if (left === null || right === null) return "unknown" as const;
  return left === right ? "same" as const : "different" as const;
}

function runIdentity(run: EvaluationRun, fallbackNumber: number) {
  return `Evaluation ${run.runNumber ?? fallbackNumber}`;
}

function runDate(run: EvaluationRun, locale: "en" | "tr") {
  const value = run.createdAt ?? run.timing.startedAt;
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(date);
}

function sourceLabelFor(element: ParsedSourceElement, locale: "en" | "tr") {
  return `${element.pageNumbers[0] ? `${locale === "tr" ? "Sayfa" : "Page"} ${element.pageNumbers[0]} · ` : ""}${element.type} · ${element.text.slice(0, 42)}`;
}

function toggleElementValue(current: string, elementId: string) {
  const values = current.split(",").map((value) => value.trim()).filter(Boolean);
  return values.includes(elementId) ? values.filter((value) => value !== elementId).join(", ") : [...values, elementId].join(", ");
}

function SourcePicker({
  ariaLabel,
  elements,
  inputId,
  labels,
  locale,
  onChange,
  value,
}: {
  ariaLabel: string;
  elements: ParsedSourceElement[];
  inputId: string;
  labels: { relevant: string; relevantHint: string; sourcePicker: string; technicalSources: string; noSources: string };
  locale: "en" | "tr";
  onChange: (value: string) => void;
  value: string;
}) {
  const selectedIds = value.split(",").map((item) => item.trim()).filter(Boolean);
  return (
    <div className="rounded-[12px] border border-[#e7e2e4] bg-[#fbfafb] p-3" data-testid={`source-picker-${inputId}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-medium text-[#171416]">{labels.relevant}</p>
          <p className="mt-1 text-[11px] font-normal leading-4 text-[#969093]">{labels.relevantHint}</p>
        </div>
        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-[#711f3a]">{selectedIds.length}</span>
      </div>
      {elements.length ? <div className="mt-3 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto" role="list" aria-label={ariaLabel}>{elements.map((element) => { const selected = selectedIds.includes(element.id); return <button aria-pressed={selected} className={selected ? "rounded-[7px] border border-[#d8b5c2] bg-[#fbf4f6] px-2 py-1 text-left text-[10px] text-[#501329]" : "rounded-[7px] border border-[#e7e2e4] bg-white px-2 py-1 text-left text-[10px] text-[#6e676a] hover:border-[#d8b5c2]"} key={element.id} onClick={() => onChange(toggleElementValue(value, element.id))} type="button">{sourceLabelFor(element, locale)}</button>; })}</div> : <p className="mt-3 text-xs text-[#969093]">{labels.noSources}</p>}
      <details className="mt-3 border-t border-[#e7e2e4] pt-2">
        <summary className="cursor-pointer text-[11px] font-medium text-[#6e676a]">{labels.technicalSources}</summary>
        <Input aria-describedby={`${inputId}-hint`} aria-label={labels.technicalSources} className="mt-2 font-mono text-xs" id={inputId} onChange={(event) => onChange(event.target.value)} placeholder="element-1, element-4" value={value} />
        <span className="sr-only" id={`${inputId}-hint`}>{labels.relevantHint}</span>
      </details>
    </div>
  );
}

function OutcomeSelect({
  id,
  locale,
  onChange,
  value,
}: {
  id: string;
  locale: "en" | "tr";
  onChange: (value: EvaluationOutcome) => void;
  value: EvaluationOutcome;
}) {
  const label = locale === "tr" ? "Beklenen sonuç" : "Expected result";
  return (
    <label className="text-[13px] font-medium text-[#171416]" htmlFor={id}>
      {label}
      <Select onValueChange={(next) => onChange(next as EvaluationOutcome)} value={value}>
        <SelectTrigger className="mt-2" id={id}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="answer">{locale === "tr" ? "Cevap" : "Answer"}</SelectItem>
          <SelectItem value="insufficient_context">{locale === "tr" ? "Yetersiz bağlam" : "Insufficient context"}</SelectItem>
        </SelectContent>
      </Select>
    </label>
  );
}

function statusPill(label: string, tone: "success" | "ready" | "muted" = "success") {
  const styles = tone === "success" ? "bg-[#eef4ef] text-[#3f7a55]" : tone === "ready" ? "bg-[#fbf4f6] text-[#711f3a]" : "bg-[#f2eff0] text-[#969093]";
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${styles}`}><span aria-hidden="true" className="size-1.5 rounded-full bg-current" />{label}</span>;
}

type MetricRow = {
  key: string;
  label: string;
  value: number | null;
  description?: string;
};

function MetricList({ rows, testId }: { rows: MetricRow[]; testId: string }) {
  return (
    <dl className="divide-y divide-[#e7e2e4] rounded-[12px] border border-[#e7e2e4] bg-white px-4" data-testid={testId}>
      {rows.map((row) => (
        <div className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-5" key={row.key}>
          <dt className="min-w-0">
            <span className="block text-[13px] font-medium text-[#171416]">{row.label}</span>
            {row.description ? <span className="mt-1 block max-w-[520px] text-[11px] leading-4 text-[#969093]">{row.description}</span> : null}
          </dt>
          <dd className="font-mono text-[18px] font-semibold tracking-[-0.02em] text-[#171416]">{metric(row.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

type ComparisonMetric = {
  key: string;
  label: string;
  first: number | null;
  second: number | null;
  description?: string;
};

type ComparisonMetricGroup = {
  key: string;
  label: string;
  metrics: ComparisonMetric[];
};

function deltaPresentation(first: number | null, second: number | null, labels: { improved: string; declined: string; unchanged: string }) {
  if (typeof first !== "number" || typeof second !== "number") {
    return { text: "—", className: "bg-[#f2eff0] text-[#969093]" };
  }
  const delta = second - first;
  if (Math.abs(delta) < 0.0005) {
    return { text: `0.000 → ${labels.unchanged}`, className: "bg-[#f2eff0] text-[#6e676a]" };
  }
  return delta > 0
    ? { text: `+${delta.toFixed(3)} ↑ ${labels.improved}`, className: "bg-[#eef4ef] text-[#3f7a55]" }
    : { text: `${delta.toFixed(3)} ↓ ${labels.declined}`, className: "bg-[#fbefef] text-[#a23b3b]" };
}

function ComparisonMetricTable({ groups, labels }: { groups: ComparisonMetricGroup[]; labels: { metric: string; runA: string; runB: string; delta: string; improved: string; declined: string; unchanged: string; comparison: string } }) {
  return (
    <div aria-label={labels.comparison} className="overflow-hidden rounded-[12px] border border-[#e7e2e4] bg-white" data-testid="evaluation-compare-metrics" role="table">
      <div className="hidden grid-cols-[minmax(0,1fr)_92px_92px_112px] gap-3 border-b border-[#e7e2e4] bg-[#fbfafb] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#969093] sm:grid" role="row">
        <span role="columnheader">{labels.metric}</span>
        <span role="columnheader">{labels.runA}</span>
        <span role="columnheader">{labels.runB}</span>
        <span role="columnheader">{labels.delta}</span>
      </div>
      {groups.map((group) => (
        <section className="border-b border-[#e7e2e4] last:border-b-0" key={group.key} role="rowgroup">
          <h3 className="bg-[#fbfafb] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#711f3a]">{group.label}</h3>
          {group.metrics.map((item) => {
            const delta = deltaPresentation(item.first, item.second, labels);
            return (
              <div className="grid gap-3 border-t border-[#e7e2e4] px-4 py-3 sm:grid-cols-[minmax(0,1fr)_92px_92px_112px] sm:items-center" key={item.key} role="row">
                <div className="min-w-0" role="cell">
                  <span className="block text-[13px] font-medium text-[#171416]">{item.label}</span>
                  {item.description ? <span className="mt-1 block text-[11px] leading-4 text-[#969093]">{item.description}</span> : null}
                </div>
                <div className="flex items-center justify-between gap-3 sm:block" role="cell">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#969093] sm:hidden">{labels.runA}</span>
                  <span className="font-mono text-[13px] text-[#171416]">{metric(item.first)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 sm:block" role="cell">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#969093] sm:hidden">{labels.runB}</span>
                  <span className="font-mono text-[13px] text-[#171416]">{metric(item.second)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 sm:block" role="cell">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#969093] sm:hidden">{labels.delta}</span>
                  <span className={`inline-flex rounded-[7px] px-2 py-1 text-right font-mono text-[11px] font-medium ${delta.className}`}>{delta.text}</span>
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

export function EvaluationScreen() {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const {
    activeDocument,
    activePipeline,
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
  const [expectedOutcome, setExpectedOutcome] = useState<EvaluationOutcome>("answer");
  const [additionalCases, setAdditionalCases] = useState<DraftEvaluationCase[]>([]);
  const [datasetId, setDatasetId] = useState("");
  const [baseDatasetId, setBaseDatasetId] = useState<string | null>(null);
  const [mode, setMode] = useState<RetrievalMode>("hybrid");
  const [topK, setTopK] = useState("5");
  const [reranker, setReranker] = useState(false);
  const [judge, setJudge] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [activeTab, setActiveTab] = useState<EvaluationTab>("dataset");
  const [selectedCaseIndex, setSelectedCaseIndex] = useState(0);

  const labels = preferences.locale === "tr"
    ? {
        dataset: "Dataset", datasetTab: "Dataset", resultsTab: "Sonuçlar", compareTab: "Karşılaştır", resultsTitle: "Evaluation sonuçları", compareTitle: "Evaluation karşılaştırması", compareDescription: "İki run'ın bağlamını ve değişen ayarlarını karşılaştırın.", datasetDescription: "Golden soruları ve kaynak kanıtlarını sürümlü olarak kaydedin.", name: "Dataset adı", question: "Golden soru", relevant: "Seçili kaynak kanıtı", relevantHint: "Parse edilmiş kaynak öğelerini seçin; ham kimlikler teknik ayrıntılarda kalır.", reference: "Referans cevap (opsiyonel)", create: "Dataset oluştur", needDocument: "Önce kalıcı parse run içeren bir doküman seçin.", selectDataset: "Dataset seç", run: "Evaluation çalıştır", judge: "Gemini judge", judgeModel: "Judge model", needPipeline: "Evaluation için aktif chunk ve embedding run gerekir.", metrics: "Ölçümler", history: "Evaluation geçmişi ve karşılaştırma", compare: "Karşılaştır", advanced: "Gelişmiş ayarlar", addCase: "Case ekle", removeCase: "Case'i kaldır", sourcePicker: "Parse source elementlerinden seç", technicalSources: "Teknik kaynak kimlikleri", noSources: "Aktif parse kaynağı bulunamadı.", newVersion: "Seçili dataset'ten yeni sürüm oluştur", hit: "Hit@K", recall: "Recall@K", precision: "Precision@K", mrr: "MRR", citation: "Citation referans geçerliliği", groundedness: "Faithfulness", cases: "Case sayısı", progress: "Case ilerlemesi", duplicate: "Çoğalt", moveUp: "Yukarı", moveDown: "Aşağı", expected: "Beklenen kaynaklar", retrieved: "Getirilen kaynaklar", answer: "Üretilen cevap", noAnswer: "Generation bu case için çalıştırılmadı.", citations: "Citation'lar", retrievalNote: "Retrieval ve generation metrikleri ayrı hesaplanır.", retrievalQuality: "Retrieval kalitesi", answerQuality: "Answer kalitesi", caseDiagnostics: "Case tanıları", selectedCase: "Seçili case", noData: "Henüz evaluation verisi yok", datasetReady: "Dataset hazır", currentDataset: "Mevcut dataset'ler", runA: "RUN A", runB: "RUN B", metricDeltas: "METRIC DELTALARI", insight: "Karşılaştırılan run'ların ayar farkları görünür; metrik değişimini bu bağlamla birlikte yorumlayın.", noCompare: "Karşılaştırmak için en az iki gerçek evaluation run'ı gerekir.", contextDocument: "Doküman", contextPipeline: "Indexing pipeline", contextDataset: "Dataset", contextConfig: "Yapılandırma", configSummary: "Aktif yapılandırma", rerankerOn: "Reranker açık", rerankerOff: "Reranker kapalı", judgeOn: "Judge açık", judgeOff: "Judge kapalı", same: "Aynı", different: "Farklı", unknown: "Kayıtlı değil", compatibility: "Bağlam uyumluluğu", onlyChanged: "Yalnızca değişenler", changedSettings: "Değişen ayarlar", noChanges: "Kayıtlı yapılandırma farkı yok.", included: "Dahil edildi", excluded: "Çıkarıldı",
      }
    : {
        dataset: "Dataset", datasetTab: "Dataset", resultsTab: "Results", compareTab: "Compare", resultsTitle: "Evaluation results", compareTitle: "Compare evaluation runs", compareDescription: "Compare the context and changed settings of two runs.", datasetDescription: "Save golden questions and source evidence as a versioned dataset.", name: "Dataset name", question: "Golden question", relevant: "Selected source evidence", relevantHint: "Choose parsed source elements; raw IDs stay inside technical details.", reference: "Reference answer (optional)", create: "Create dataset", needDocument: "Select a persisted document with a parse run first.", selectDataset: "Select dataset", run: "Run evaluation", judge: "Gemini judge", judgeModel: "Judge model", needPipeline: "Evaluation requires active chunk and embedding runs.", metrics: "Metrics", history: "Evaluation history and comparison", compare: "Compare", advanced: "Advanced settings", addCase: "Add case", removeCase: "Remove case", sourcePicker: "Select from parsed source elements", technicalSources: "Technical source IDs", noSources: "No active parsed source elements are available.", newVersion: "Create a new version from the selected dataset", hit: "Hit@K", recall: "Recall@K", precision: "Precision@K", mrr: "MRR", citation: "Citation reference validity", groundedness: "Faithfulness", cases: "Cases", progress: "Case progress", duplicate: "Duplicate", moveUp: "Move up", moveDown: "Move down", expected: "Expected sources", retrieved: "Retrieved sources", answer: "Generated answer", noAnswer: "Generation was not run for this case.", citations: "Citations", retrievalNote: "Retrieval and generation metrics are calculated separately.", retrievalQuality: "Retrieval quality", answerQuality: "Answer quality", caseDiagnostics: "Case diagnostics", selectedCase: "Selected case", noData: "No evaluation data yet", datasetReady: "Dataset ready", currentDataset: "Current datasets", runA: "RUN A", runB: "RUN B", metricDeltas: "METRIC DELTAS", insight: "The selected runs' configuration changes remain visible beside their metric deltas; use that context to interpret the result.", noCompare: "At least two real evaluation runs are required to compare.", contextDocument: "Document", contextPipeline: "Indexing pipeline", contextDataset: "Dataset", contextConfig: "Configuration", configSummary: "Active configuration", rerankerOn: "Reranker on", rerankerOff: "Reranker off", judgeOn: "Judge on", judgeOff: "Judge off", same: "Same", different: "Different", unknown: "Not recorded", compatibility: "Context compatibility", onlyChanged: "Only changed", changedSettings: "Changed settings", noChanges: "No recorded configuration differences.", included: "Included", excluded: "Excluded",
      };

  const datasetBlocker = firstBlocker(preferences.locale, [
    [evaluationStatus === "processing", "processing"],
    [!activeDocument?.id, "missing_document"],
    [!selectedParseRunId, "missing_parse"],
    [!datasetName.trim(), "invalid_config"],
    [!question.trim(), "missing_question"],
    [expectedOutcome === "answer" && !elementIds.trim(), "missing_sources"],
    [additionalCases.some((item) => !item.question.trim()), "missing_question"],
    [additionalCases.some((item) => item.expectedOutcome === "answer" && !item.elements.trim()), "missing_sources"],
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
  const selectedRuns = useMemo(() => compareIds.map((id) => evaluationHistory.find((run) => run.id === id)).filter((run): run is EvaluationRun => Boolean(run)).slice(0, 2), [compareIds, evaluationHistory]);
  const selectedDataset = evaluationDatasets.find((dataset) => dataset.id === selectedDatasetId);
  const completedCases = evaluationRun?.caseResults?.length ?? 0;
  const totalCases = selectedDataset?.caseCount ?? 0;
  const activeCaseIndex = evaluationRun?.caseResults?.[selectedCaseIndex] ? selectedCaseIndex : 0;
  const parseElements = parseResult?.structured.pages.flatMap((page) => page.elements) ?? [];
  const activeConfigSummary = `${copy.retrieval.modes[mode]} · Top ${topK} · ${reranker ? labels.rerankerOn : labels.rerankerOff} · ${judge ? labels.judgeOn : labels.judgeOff}`;
  const comparisonConfigs = selectedRuns.length >= 2 ? selectedRuns.slice(0, 2).map((run) => evaluationConfig(run)) : [];
  const comparisonSettings: Array<{ key: string; label: string; first: string | number | boolean | null; second: string | number | boolean | null }> = comparisonConfigs.length === 2 ? [
    { key: "retrieval", label: preferences.locale === "tr" ? "Retrieval modu" : "Retrieval mode", first: comparisonConfigs[0].retrievalMode, second: comparisonConfigs[1].retrievalMode },
    { key: "topK", label: "Top K", first: comparisonConfigs[0].topK, second: comparisonConfigs[1].topK },
    { key: "reranker", label: preferences.locale === "tr" ? "Reranker" : "Reranker", first: comparisonConfigs[0].rerankerEnabled, second: comparisonConfigs[1].rerankerEnabled },
    { key: "candidateCount", label: preferences.locale === "tr" ? "Rerank aday sayısı" : "Reranker candidates", first: comparisonConfigs[0].candidateCount, second: comparisonConfigs[1].candidateCount },
    { key: "context", label: preferences.locale === "tr" ? "Context token bütçesi" : "Context token budget", first: comparisonConfigs[0].tokenBudget, second: comparisonConfigs[1].tokenBudget },
    { key: "temperature", label: "Temperature", first: comparisonConfigs[0].temperature, second: comparisonConfigs[1].temperature },
    { key: "maxOutputTokens", label: preferences.locale === "tr" ? "Maksimum çıktı token'ı" : "Max output tokens", first: comparisonConfigs[0].maxOutputTokens, second: comparisonConfigs[1].maxOutputTokens },
    { key: "judge", label: labels.judge, first: comparisonConfigs[0].judge, second: comparisonConfigs[1].judge },
  ] : [];
  const comparisonContext = comparisonConfigs.length === 2 ? [
    { key: "dataset", label: preferences.locale === "tr" ? "Aynı dataset mi?" : "Same dataset?", state: comparableValue(selectedRuns[0].datasetId, selectedRuns[1].datasetId) },
    { key: "pipeline", label: preferences.locale === "tr" ? "Aynı pipeline mı?" : "Same pipeline?", state: comparableValue(comparisonConfigs[0].pipelineId ?? stringValue(selectedRuns[0].upstream.pipelineId), comparisonConfigs[1].pipelineId ?? stringValue(selectedRuns[1].upstream.pipelineId)) },
    { key: "embedding", label: preferences.locale === "tr" ? "Aynı embedding mi?" : "Same embedding?", state: comparableValue(comparisonConfigs[0].embeddingRunId, comparisonConfigs[1].embeddingRunId) },
    { key: "settings", label: preferences.locale === "tr" ? "Değişen ayarlar?" : "Changed settings?", state: comparisonSettings.some((item) => item.first !== null && item.second !== null && item.first !== item.second) ? "different" as const : "same" as const },
  ] : [];
  const changedSettings = comparisonSettings.filter((item) => item.first !== null && item.second !== null && item.first !== item.second);
  const visibleComparisonSettings = onlyChanged ? changedSettings : comparisonSettings;

  function comparisonValue(value: string | number | boolean | null) {
    if (value === null) return labels.unknown;
    if (typeof value === "string" && value in copy.retrieval.modes) return copy.retrieval.modes[value as RetrievalMode];
    return String(value);
  }

  function comparisonSettingValue(key: string, value: string | number | boolean | null) {
    if (typeof value === "boolean") return key === "judge" ? (value ? labels.judgeOn : labels.judgeOff) : (value ? labels.rerankerOn : labels.rerankerOff);
    return comparisonValue(value);
  }

  function comparisonStateLabel(state: "same" | "different" | "unknown") {
    return state === "same" ? labels.same : state === "different" ? labels.different : labels.unknown;
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
      { question: question.trim(), relevantElementIds: elementIds.split(",").map((value) => value.trim()).filter(Boolean), referenceAnswer: referenceAnswer.trim() || null, expectedOutcome },
      ...additionalCases.map((item) => ({ question: item.question.trim(), relevantElementIds: item.elements.split(",").map((value) => value.trim()).filter(Boolean), referenceAnswer: item.reference.trim() || null, expectedOutcome: item.expectedOutcome })),
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
          <p className="mt-1 max-w-[680px] text-sm leading-5 text-[#6e676a]">{copy.evaluation.description}</p>
        </header>

        <section aria-label={preferences.locale === "tr" ? "Evaluation bağlam özeti" : "Evaluation context summary"} className="mt-6 rounded-[14px] border border-[#e7e2e4] bg-white px-4 py-3" data-testid="evaluation-workspace-context">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#969093]">{labels.contextDataset}</p>
              <h2 className="mt-1 truncate text-[14px] font-semibold text-[#171416]">{selectedDataset?.name ?? (preferences.locale === "tr" ? "Dataset seçilmedi" : "No dataset selected")}</h2>
              {selectedDataset ? <p className="mt-0.5 text-[11px] text-[#6e676a]">v{selectedDataset.version} · {selectedDataset.caseCount} {labels.cases}</p> : null}
            </div>
            <div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#969093]">{labels.configSummary}</p><p className="mt-1 truncate text-[13px] font-medium text-[#171416]" data-testid="evaluation-config-summary">{activeConfigSummary}</p></div>
            <div className="ml-auto">{evaluationDatasets.length ? statusPill(labels.datasetReady) : statusPill(preferences.locale === "tr" ? "Hazır" : "Ready", "ready")}</div>
          </div>
        </section>

        <nav aria-label={preferences.locale === "tr" ? "Evaluation görünümleri" : "Evaluation views"} className="mt-6 border-b border-[#e7e2e4]" data-testid="evaluation-tabs" role="tablist">
          <div className="flex gap-2">{tabs.map(([tab, label]) => <button aria-controls={`evaluation-panel-${tab}`} aria-selected={activeTab === tab} className={activeTab === tab ? "border-b-2 border-[#711f3a] px-1 py-2.5 text-[13px] font-medium text-[#171416]" : "border-b-2 border-transparent px-1 py-2.5 text-[13px] font-medium text-[#6e676a] hover:text-[#501329]"} data-testid={`evaluation-tab-${tab}`} id={`evaluation-tab-${tab}`} key={tab} onClick={() => setActiveTab(tab)} role="tab" type="button">{label}</button>)}</div>
        </nav>

        {activeTab === "dataset" ? (
          <section aria-labelledby="evaluation-tab-dataset" className="mt-8" data-testid="evaluation-panel-dataset" id="evaluation-panel-dataset" role="tabpanel">
            <div className="rounded-[16px] border border-[#e7e2e4] bg-white p-5">
              <div><h2 className="text-[18px] font-semibold text-[#171416]">{labels.dataset}</h2><p className="mt-1 max-w-[600px] text-[13px] leading-5 text-[#6e676a]">{labels.datasetDescription}</p></div>
              <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="grid gap-4 sm:grid-cols-2">
                   <label className="text-[13px] font-medium text-[#171416]" htmlFor="dataset-name">{labels.name}<Input className="mt-2" id="dataset-name" onChange={(event) => setDatasetName(event.target.value)} value={datasetName} /></label>
                   <label className="text-[13px] font-medium text-[#171416]" htmlFor="golden-question">{labels.question}<Input className="mt-2" id="golden-question" onChange={(event) => setQuestion(event.target.value)} value={question} /></label>
                   <OutcomeSelect id="expected-outcome" locale={preferences.locale} onChange={setExpectedOutcome} value={expectedOutcome} />
                   {expectedOutcome === "answer" ? <div className="sm:col-span-2"><SourcePicker ariaLabel={labels.sourcePicker} elements={parseElements} inputId="relevant-elements" labels={labels} locale={preferences.locale} onChange={setElementIds} value={elementIds} /></div> : <p className="rounded-[12px] border border-[#eadfc9] bg-[#fffaf1] p-3 text-xs leading-5 text-[#8d651e] sm:col-span-2" data-testid="insufficient-context-case-hint">{preferences.locale === "tr" ? "Bu case doğru bir şekilde cevap verilmemesini ölçer; kaynak kanıtı zorunlu değildir." : "This case measures correct abstention; source evidence is not required."}</p>}
                   <label className="text-[13px] font-medium text-[#171416] sm:col-span-2" htmlFor="reference-answer">{labels.reference}<Input className="mt-2" id="reference-answer" onChange={(event) => setReferenceAnswer(event.target.value)} value={referenceAnswer} /></label>
                  {additionalCases.length ? <div className="space-y-3 sm:col-span-2"><h3 className="text-[13px] font-semibold text-[#171416]">{preferences.locale === "tr" ? "Ek golden case'ler" : "Additional golden cases"}</h3>{additionalCases.map((item, index) => <div className="grid gap-3 rounded-[12px] border border-[#e7e2e4] p-3 sm:grid-cols-2" key={`case-${index}`}><label className="text-[12px] font-medium" htmlFor={`case-question-${index}`}>{labels.question}<Input className="mt-2" id={`case-question-${index}`} onChange={(event) => setAdditionalCases((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, question: event.target.value } : entry))} value={item.question} /></label><OutcomeSelect id={`case-outcome-${index}`} locale={preferences.locale} onChange={(value) => setAdditionalCases((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, expectedOutcome: value } : entry))} value={item.expectedOutcome} />{item.expectedOutcome === "answer" ? <div className="sm:col-span-2"><SourcePicker ariaLabel={`${labels.sourcePicker} ${index + 2}`} elements={parseElements} inputId={`case-elements-${index}`} labels={labels} locale={preferences.locale} onChange={(value) => setAdditionalCases((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, elements: value } : entry))} value={item.elements} /></div> : <p className="rounded-[10px] border border-[#eadfc9] bg-[#fffaf1] p-3 text-xs text-[#8d651e] sm:col-span-2">{preferences.locale === "tr" ? "Kaynak kanıtı gerekmez." : "Source evidence is not required."}</p>}<label className="text-[12px] font-medium sm:col-span-2" htmlFor={`case-reference-${index}`}>{labels.reference}<Input className="mt-2" id={`case-reference-${index}`} onChange={(event) => setAdditionalCases((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, reference: event.target.value } : entry))} value={item.reference} /></label><div className="flex flex-wrap gap-2 sm:col-span-2"><Button onClick={() => setAdditionalCases((current) => [...current.slice(0, index + 1), { ...item }, ...current.slice(index + 1)])} size="sm" variant="outline">{labels.duplicate}</Button><Button disabled={index === 0} onClick={() => setAdditionalCases((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })} size="sm" variant="ghost">{labels.moveUp}</Button><Button disabled={index === additionalCases.length - 1} onClick={() => setAdditionalCases((current) => { const next = [...current]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; })} size="sm" variant="ghost">{labels.moveDown}</Button><Button onClick={() => setAdditionalCases((current) => current.filter((_, entryIndex) => entryIndex !== index))} size="sm" variant="ghost">{labels.removeCase}</Button></div></div>)}</div> : null}
                  <Button className="w-fit" onClick={() => setAdditionalCases((current) => [...current, { question: "", elements: "", reference: "", expectedOutcome: "answer" }])} size="sm" type="button" variant="outline"><Plus aria-hidden="true" className="size-4" />{labels.addCase}</Button>
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
                <Button aria-describedby={!canRun ? "evaluation-disabled-reason" : undefined} aria-busy={evaluationStatus === "processing"} className="ml-0 h-[42px] gap-2 sm:ml-auto" disabled={!canRun} onClick={handleRun}><Play aria-hidden="true" className="size-4" />{labels.run}</Button>
              </div>
              <details className="mt-4 rounded-[10px] border border-[#e7e2e4]"><summary className="flex h-[46px] cursor-pointer list-none items-center justify-between px-4 text-[13px] font-medium text-[#171416]"><span>{labels.advanced} — {labels.judge}</span><ChevronDown aria-hidden="true" className="size-4 text-[#969093]" /></summary><div className="grid gap-4 border-t border-[#e7e2e4] p-4 sm:grid-cols-2"><label className="flex items-center justify-between gap-3 text-[12px] font-medium" htmlFor="evaluation-judge"><span>{labels.judge}<span className="mt-1 block font-normal text-[#6e676a]">{preferences.locale === "tr" ? "Cevap kalitesi için isteğe bağlı değerlendirme" : "Optional answer-quality scoring"}</span></span><Switch checked={judge} id="evaluation-judge" onCheckedChange={setJudge} /></label><p className="text-xs leading-5 text-[#6e676a]">{labels.retrievalNote}</p></div></details>
              {!canRun ? <DisabledReason id="evaluation-disabled-reason">{evaluationBlocker?.message}</DisabledReason> : null}<PipelineErrorMessage message={evaluationError?.message} />
            </div>

            {evaluationRun ? (
              <>
                <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="min-w-0">
                    <h2 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-[#969093]">{labels.retrievalQuality}</h2>
                    <MetricList rows={[
                      { key: "hitAtK", label: labels.hit, value: evaluationRun.results.hitAtK },
                      { key: "recallAtK", label: labels.recall, value: evaluationRun.results.recallAtK },
                      { key: "precisionAtK", label: labels.precision, value: evaluationRun.results.precisionAtK },
                      { key: "mrr", label: labels.mrr, value: evaluationRun.results.mrr },
                    ]} testId="evaluation-retrieval-metrics" />
                    <p className="mt-3 text-xs text-[#969093]">{preferences.locale === "tr" ? "Retrieval'a uygun case" : "Retrieval-eligible cases"}: {evaluationRun.results.retrievalEligibleCaseCount ?? "—"}</p>
                    <h2 className="mt-7 text-[13px] font-semibold uppercase tracking-[0.05em] text-[#969093]">{labels.answerQuality}</h2>
                    <MetricList rows={[
                      { key: "faithfulness", label: "Faithfulness", value: evaluationRun.results.generationMetrics?.faithfulness ?? null, description: preferences.locale === "tr" ? "Cevap iddialarının getirilen context'e bağlı kalma düzeyi." : "How well answer claims stay grounded in retrieved context." },
                      { key: "answerRelevance", label: "Answer relevance", value: evaluationRun.results.generationMetrics?.answerRelevance ?? null },
                      { key: "answerCorrectness", label: "Answer correctness", value: evaluationRun.results.generationMetrics?.answerCorrectness ?? null },
                      { key: "citationValidity", label: labels.citation, value: evaluationRun.results.citationValidity, description: preferences.locale === "tr" ? "Üretilen citation ID'sinin verilen context'te bulunmasıdır; iddianın desteklenmesini ölçmez." : "Whether generated citation IDs belong to the supplied context; it does not measure claim support." },
                      { key: "abstentionAccuracy", label: preferences.locale === "tr" ? "No-answer doğruluğu" : "Abstention accuracy", value: evaluationRun.results.abstentionAccuracy, description: preferences.locale === "tr" ? "Yetersiz bağlamda cevap vermeme kararlarının doğruluğu." : "Correct no-answer decisions for insufficient-context cases." },
                    ]} testId="evaluation-answer-metrics" />
                  </div>
                  <aside className="rounded-[16px] border border-[#e7e2e4] bg-white p-5"><h2 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-[#969093]">{labels.cases}</h2><div className="mt-3 flex items-baseline gap-2"><span className="text-[30px] font-semibold text-[#171416]">{evaluationRun.results.caseCount ?? completedCases}</span><span className="text-[13px] text-[#6e676a]">/ {totalCases || completedCases} {preferences.locale === "tr" ? "tamamlandı" : "completed"}</span></div><p className="mt-3 text-[12px] text-[#6e676a]">{preferences.locale === "tr" ? "Her case sonucu aşağıda ayrı incelenebilir." : "Inspect each case result below."}</p><div aria-valuemax={totalCases || completedCases || 1} aria-valuemin={0} aria-valuenow={completedCases} className="mt-4 h-2 overflow-hidden rounded-full bg-[#e7e2e4]" role="progressbar"><div className="h-full rounded-full bg-[#3f7a55]" style={{ width: `${Math.min(100, (completedCases / Math.max(1, totalCases || completedCases)) * 100)}%` }} /></div></aside>
                </div>
                <details className="mt-6 rounded-[12px] border border-[#e7e2e4] bg-white" data-testid="evaluation-run-details"><summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13px] font-medium text-[#171416]"><span>{preferences.locale === "tr" ? "Details / yapılandırma" : "Details / configuration"}</span><ChevronDown aria-hidden="true" className="size-4 text-[#969093]" /></summary><div className="grid gap-4 border-t border-[#e7e2e4] bg-[#fbfafb] p-4 sm:grid-cols-2"><div><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#969093]">{preferences.locale === "tr" ? "Yapılandırma" : "Configuration"}</p><p className="mt-1 text-[13px] text-[#171416]">{activeConfigSummary}</p></div><div><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#969093]">{preferences.locale === "tr" ? "Provenance" : "Provenance"}</p><p className="mt-1 text-[13px] text-[#171416]">{activeDocument?.fileName ?? "—"} · {activePipeline?.name ?? "—"}</p></div><div><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#969093]">{preferences.locale === "tr" ? "Çıktı" : "Output"}</p><p className="mt-1 text-[13px] text-[#171416]">{labels.cases}: {evaluationRun.results.caseCount ?? completedCases} · {labels.judgeModel}: {evaluationRun.results.judgeModel ?? capabilities?.judgeModel ?? "—"}</p></div><div><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#969093]">{preferences.locale === "tr" ? "Identifiers" : "Identifiers"}</p><p className="mt-1 break-all font-mono text-[11px] text-[#6e676a]">Run: {evaluationRun.id}</p><p className="mt-1 break-all font-mono text-[11px] text-[#6e676a]">Dataset: {evaluationRun.datasetId}</p></div></div></details>
                {evaluationRun.caseResults?.length ? (
                  <section aria-label={labels.caseDiagnostics} className="mt-8">
                    <h2 className="text-[13px] font-semibold text-[#171416]">{labels.caseDiagnostics}</h2>
                    <div className="mt-3 space-y-2">
                      {evaluationRun.caseResults.map((item, index) => {
                        const noAnswerCase = item.expectedOutcome === "insufficient_context";
                        const faithfulness = item.generationMetrics?.faithfulness ?? null;
                        const passed = noAnswerCase ? item.abstentionCorrect === true : (faithfulness ?? item.groundedness) >= 0.5 && item.citationValidity >= 0.5;
                        const outcomeLabel = noAnswerCase
                          ? item.abstentionCorrect === true
                            ? (preferences.locale === "tr" ? "Doğru no-answer" : "Correct no-answer")
                            : item.abstentionCorrect === false
                              ? (preferences.locale === "tr" ? "Beklenmeyen cevap" : "Unexpected answer")
                              : (preferences.locale === "tr" ? "No-answer ölçülmedi" : "No-answer not scored")
                          : `${faithfulness === null ? "Faithfulness —" : `Faithfulness ${faithfulness.toFixed(2)}`} · ${preferences.locale === "tr" ? "Citation üyeliği" : "Citation membership"} ${item.citationValidity.toFixed(2)}`;
                        return (
                          <details className="overflow-hidden rounded-[16px] border border-[#e7e2e4] bg-white" key={item.experimentId || `${item.question}-${index}`} open={activeCaseIndex === index}>
                            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3" onClick={() => setSelectedCaseIndex(index)}>
                              <span aria-hidden="true" className={passed ? "grid size-6 shrink-0 place-items-center rounded-full bg-[#eef4ef] text-[#3f7a55]" : "grid size-6 shrink-0 place-items-center rounded-full bg-[#fbefef] text-[#a23b3b]"}>{passed ? <CheckCircle2 className="size-3.5" /> : <TriangleAlert className="size-3.5" />}</span>
                              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#171416]">{item.question}</span>
                              <span className="shrink-0 text-right text-[11px] font-medium text-[#6e676a]">{outcomeLabel}</span>
                            </summary>
                            <div className="grid gap-4 border-t border-[#e7e2e4] bg-[#fbfafb] p-4 md:grid-cols-2">
                              <div>
                                <p className="text-[11px] uppercase tracking-wide text-[#969093]">{labels.expected}</p>
                                <p className="mt-2 text-[13px] text-[#711f3a]">{noAnswerCase ? (preferences.locale === "tr" ? "Cevap yok" : "No answer") : item.expectedElementIds.length || "—"}</p>
                                {item.expectedElementIds.length ? <SourceInspector documentId={activeDocument?.id ?? null} parseResult={parseResult} sourceElementIds={item.expectedElementIds} triggerLabel={labels.expected} /> : null}
                              </div>
                              <div>
                                <p className="text-[11px] uppercase tracking-wide text-[#969093]">{labels.retrieved}</p>
                                <p className="mt-2 text-[13px] text-[#171416]">{item.retrievedElementIds.length || "—"}</p>
                                {item.retrievedElementIds.length ? <SourceInspector documentId={activeDocument?.id ?? null} parseResult={parseResult} sourceElementIds={item.retrievedElementIds} triggerLabel={labels.retrieved} /> : null}
                              </div>
                              {noAnswerCase ? <div className="rounded-[10px] border border-[#eadfc9] bg-[#fffaf1] p-3 md:col-span-2"><p className="text-[11px] uppercase tracking-wide text-[#8d651e]">{preferences.locale === "tr" ? "Beklenen sonuç" : "Expected result"}</p><p className="mt-1 text-[13px] text-[#8d651e]">{preferences.locale === "tr" ? "Yetersiz bağlam → cevap üretmemeli" : "Insufficient context → no answer expected"}</p><p className="mt-2 text-[12px] text-[#6e676a]">{preferences.locale === "tr" ? "Abstention doğruluğu" : "Abstention correctness"}: {item.abstentionCorrect === null || item.abstentionCorrect === undefined ? "—" : item.abstentionCorrect ? (preferences.locale === "tr" ? "Doğru" : "Correct") : (preferences.locale === "tr" ? "Yanlış" : "Incorrect")}</p></div> : null}
                              <div className="md:col-span-2"><p className="text-[11px] uppercase tracking-wide text-[#969093]">{labels.answer}</p><p className="mt-2 text-[13px] leading-5 text-[#6e676a]">{item.answer || (noAnswerCase && item.insufficientContext ? (preferences.locale === "tr" ? "Sistem yetersiz bağlamı algıladı ve cevap üretmedi." : "The system detected insufficient context and did not generate an answer.") : labels.noAnswer)}</p></div>
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
                {evaluationStatus === "processing" && totalCases > 0 ? <div className="mt-4 rounded-[10px] border border-[#e7e2e4] bg-white p-3" role="status"><div className="flex justify-between text-xs"><span>{labels.progress}</span><span>{completedCases}/{totalCases}</span></div><div aria-valuemax={totalCases} aria-valuemin={0} aria-valuenow={completedCases} className="mt-2 h-2 overflow-hidden rounded-full bg-[#f2eff0]" role="progressbar"><div className="h-full bg-[#711f3a]" style={{ width: `${Math.min(100, (completedCases / totalCases) * 100)}%` }} /></div></div> : null}
              </>
            ) : (
              <div className="mt-8 flex min-h-[280px] flex-col items-center justify-center rounded-[16px] border border-[#e7e2e4] bg-white px-5 text-center"><BarChart3 aria-hidden="true" className="size-9 text-[#969093]" /><h2 className="mt-4 text-[18px] font-semibold text-[#171416]">{labels.noData}</h2><p className="mt-2 max-w-md text-sm leading-5 text-[#6e676a]">{copy.evaluation.emptyDescription}</p><p className="mt-2 text-xs text-[#969093]">{copy.evaluation.emptyNote}</p></div>
            )}
          </section>
        ) : null}

        {activeTab === "compare" ? (
          <section aria-labelledby="evaluation-tab-compare" className="mt-8" data-testid="evaluation-panel-compare" id="evaluation-panel-compare" role="tabpanel">
            {selectedRuns.length >= 2 ? <div data-testid="evaluation-compare-content">
              <div className="grid gap-6 lg:grid-cols-[1fr_48px_1fr] lg:items-center">
                <article className="rounded-[16px] border border-[#e7e2e4] bg-white p-5"><p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#711f3a]">{labels.runA}</p><h2 className="mt-3 text-[16px] font-medium text-[#171416]">{runIdentity(selectedRuns[0], 1)}</h2><p className="mt-2 text-[12px] text-[#6e676a]">{runDate(selectedRuns[0], preferences.locale) ?? "—"}</p><p className="mt-1 text-[12px] text-[#6e676a]">{selectedRuns[0].timing.durationMs === null ? "—" : `${selectedRuns[0].timing.durationMs} ms`} · {labels.cases} {selectedRuns[0].results?.caseCount ?? "—"}</p></article>
                <span className="hidden text-center text-[12px] text-[#969093] lg:block">VS</span>
                <article className="rounded-[16px] border border-[#e7e2e4] bg-white p-5"><p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#711f3a]">{labels.runB}</p><h2 className="mt-3 text-[16px] font-medium text-[#171416]">{runIdentity(selectedRuns[1], 2)}</h2><p className="mt-2 text-[12px] text-[#6e676a]">{runDate(selectedRuns[1], preferences.locale) ?? "—"}</p><p className="mt-1 text-[12px] text-[#6e676a]">{selectedRuns[1].timing.durationMs === null ? "—" : `${selectedRuns[1].timing.durationMs} ms`} · {labels.cases} {selectedRuns[1].results?.caseCount ?? "—"}</p></article>
              </div>
              <section className="mt-8 rounded-[16px] border border-[#e7e2e4] bg-white p-5" data-testid="evaluation-compare-context"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-[#969093]">{labels.compatibility}</h2><p className="mt-1 text-xs text-[#6e676a]">{labels.compareDescription}</p></div><label className="flex items-center gap-2 text-xs font-medium text-[#6e676a]" htmlFor="evaluation-only-changed">{labels.onlyChanged}<Switch checked={onlyChanged} id="evaluation-only-changed" onCheckedChange={setOnlyChanged} /></label></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{comparisonContext.map((item) => <div className="flex items-center justify-between gap-3 rounded-[10px] border border-[#e7e2e4] bg-[#fbfafb] px-3 py-2" key={item.key}><span className="text-xs text-[#6e676a]">{item.label}</span><span className={item.state === "same" ? "text-xs font-medium text-[#3f7a55]" : item.state === "different" ? "text-xs font-medium text-[#8d651e]" : "text-xs font-medium text-[#969093]"}>{comparisonStateLabel(item.state)}</span></div>)}</div><div className="mt-5 border-t border-[#e7e2e4] pt-4"><h3 className="text-[12px] font-semibold uppercase tracking-[0.05em] text-[#969093]">{labels.changedSettings}</h3>{visibleComparisonSettings.length ? <div className="mt-3 divide-y divide-[#e7e2e4]">{visibleComparisonSettings.map((item) => <div className="grid gap-2 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_1fr_1fr]" key={item.key}><span className="font-medium text-[#171416]">{item.label}</span><span className="text-[#6e676a]">{labels.runA}: {comparisonSettingValue(item.key, item.first)}</span><span className="text-[#6e676a]">{labels.runB}: {comparisonSettingValue(item.key, item.second)}</span></div>)}</div> : <p className="mt-3 text-xs text-[#969093]">{labels.noChanges}</p>}</div></section>
              <section className="mt-8"><div className="flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-[#969093]">{preferences.locale === "tr" ? "Metrik karşılaştırması" : "Metric comparison"}</h2><p className="mt-1 text-xs text-[#6e676a]">{preferences.locale === "tr" ? "Her satırda Run B'nin Run A'ya göre farkını açıkça görün." : "Read Run B against Run A without hiding the underlying values."}</p></div></div><div className="mt-4"><ComparisonMetricTable groups={[{ key: "retrieval", label: labels.retrievalQuality, metrics: [{ key: "hitAtK", label: labels.hit, first: selectedRuns[0].results.hitAtK, second: selectedRuns[1].results.hitAtK }, { key: "recallAtK", label: labels.recall, first: selectedRuns[0].results.recallAtK, second: selectedRuns[1].results.recallAtK }, { key: "precisionAtK", label: labels.precision, first: selectedRuns[0].results.precisionAtK, second: selectedRuns[1].results.precisionAtK }, { key: "mrr", label: labels.mrr, first: selectedRuns[0].results.mrr, second: selectedRuns[1].results.mrr }] }, { key: "answer", label: labels.answerQuality, metrics: [{ key: "faithfulness", label: "Faithfulness", first: selectedRuns[0].results.generationMetrics?.faithfulness ?? null, second: selectedRuns[1].results.generationMetrics?.faithfulness ?? null }, { key: "answerRelevance", label: "Answer relevance", first: selectedRuns[0].results.generationMetrics?.answerRelevance ?? null, second: selectedRuns[1].results.generationMetrics?.answerRelevance ?? null }, { key: "answerCorrectness", label: "Answer correctness", first: selectedRuns[0].results.generationMetrics?.answerCorrectness ?? null, second: selectedRuns[1].results.generationMetrics?.answerCorrectness ?? null }, { key: "citationValidity", label: labels.citation, first: selectedRuns[0].results.citationValidity, second: selectedRuns[1].results.citationValidity, description: preferences.locale === "tr" ? "Context ID üyeliği; iddia desteği değildir." : "Context ID membership; not claim support." }, { key: "abstentionAccuracy", label: preferences.locale === "tr" ? "No-answer doğruluğu" : "Abstention accuracy", first: selectedRuns[0].results.abstentionAccuracy, second: selectedRuns[1].results.abstentionAccuracy }] }]} labels={{ metric: preferences.locale === "tr" ? "Metrik" : "Metric", runA: labels.runA, runB: labels.runB, delta: "Δ", improved: preferences.locale === "tr" ? "Artış" : "Higher", declined: preferences.locale === "tr" ? "Düşüş" : "Lower", unchanged: preferences.locale === "tr" ? "Değişmedi" : "No change", comparison: preferences.locale === "tr" ? "Evaluation metrik karşılaştırması" : "Evaluation metric comparison" }} /></div></section>
            </div> : <div className="flex min-h-[280px] flex-col items-center justify-center rounded-[16px] border border-[#e7e2e4] bg-white px-5 text-center"><BarChart3 aria-hidden="true" className="size-9 text-[#969093]" /><h2 className="mt-4 text-[18px] font-semibold text-[#171416]">{labels.compareTitle}</h2><p className="mt-2 max-w-md text-sm leading-5 text-[#6e676a]">{labels.noCompare}</p></div>}
            <details className="mt-6 rounded-[12px] border border-[#e7e2e4] bg-white" data-testid="evaluation-history"><summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13px] font-medium text-[#171416]"><span>{labels.history}</span><ChevronDown aria-hidden="true" className="size-4 text-[#969093]" /></summary><div className="border-t border-[#e7e2e4] p-4">{evaluationHistory.length ? <Table><TableHeader><TableRow><TableHead>{labels.compare}</TableHead><TableHead>Run</TableHead><TableHead>{labels.hit}</TableHead><TableHead>{labels.recall}</TableHead><TableHead>{labels.precision}</TableHead><TableHead>{labels.mrr}</TableHead><TableHead>{labels.citation}</TableHead><TableHead>{labels.groundedness}</TableHead></TableRow></TableHeader><TableBody>{evaluationHistory.map((run, index) => <TableRow key={run.id}><TableCell><input aria-label={`${labels.compare} ${index + 1}`} checked={compareIds.includes(run.id)} disabled={!compareIds.includes(run.id) && compareIds.length >= 2} onChange={() => toggleCompare(run.id)} type="checkbox" /></TableCell><TableCell className="text-xs">{runIdentity(run, evaluationHistory.length - index)}</TableCell><TableCell>{metric(run.results.hitAtK)}</TableCell><TableCell>{metric(run.results.recallAtK)}</TableCell><TableCell>{metric(run.results.precisionAtK)}</TableCell><TableCell>{metric(run.results.mrr)}</TableCell><TableCell>{metric(run.results.citationValidity)}</TableCell><TableCell>{metric(run.results.generationMetrics?.faithfulness ?? null)}</TableCell></TableRow>)}</TableBody></Table> : <p className="text-sm text-[#6e676a]">{labels.noCompare}</p>}</div></details>
          </section>
        ) : null}
      </div>
    </div>
  );
}
