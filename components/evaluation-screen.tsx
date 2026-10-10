"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { PipelineErrorMessage } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { SourceInspector } from "@/components/source-inspector";
import { StageBlocker } from "@/components/stage-blocker";
import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { Disclosure, TechnicalDetails } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SlidingTabs, TransitionCheckbox, TransitionPanel } from "@/components/ui/transitions";
import { blocker, getPipelineAvailability } from "@/lib/blockers";
import { type AppCopy, type AppLocale, interpolate, runName, UI_COPY } from "@/lib/copy";
import type { ParsedElement } from "@/lib/document-parse-types";
import { formatCount, formatMs, formatNumber, formatScore } from "@/lib/format";
import type { EvaluationCaseResult, EvaluationRun, GenerationMetricMethod, RetrievalMode, StageRetrievalMetricsByStage } from "@/lib/rag-api-types";
import { cn } from "@/lib/utils";

type EvaluationTab = "dataset" | "results" | "compare";
type EvaluationOutcome = "answer" | "insufficient_context";
type EvaluationCopy = AppCopy["evaluation"];

const TABS: EvaluationTab[] = ["dataset", "results", "compare"];
/** Diagnostic review threshold for answer cases; it is not a correctness verdict. */
const CASE_THRESHOLD = 0.5;

type DraftEvaluationCase = {
  question: string;
  elements: string;
  reference: string;
  expectedOutcome: EvaluationOutcome;
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

function splitIds(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
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

/** The judge produced the answer metrics (directly via `method`, or inferred for older runs). */
function usedJudge(run: EvaluationRun) {
  const metrics = run.results.generationMetrics;
  if (metrics?.method) return metrics.method !== "citation_token_overlap_v1";
  const judge = evaluationConfig(run).judge;
  return judge ?? (metrics?.faithfulness !== null && metrics?.faithfulness !== undefined);
}

function comparableValue(left: string | number | boolean | null, right: string | number | boolean | null) {
  if (left === null || right === null) return "unknown" as const;
  return left === right ? "same" as const : "different" as const;
}

function runDate(run: EvaluationRun, locale: AppLocale) {
  const value = run.createdAt ?? run.timing.startedAt;
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(date);
}

function truncate(text: string, max: number) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

type PickerElement = { element: ParsedElement; section: string | null; summary: string };

/** One-line, plain-text summary; table pipes become "Table · 4 rows · first cells…". */
function elementSummary(element: ParsedElement, copy: EvaluationCopy, locale: AppLocale) {
  const units = UI_COPY[locale].units;
  if (element.type === "table") {
    const rows = element.table?.rows?.length
      ? element.table.rows
      : element.text.split("\n").filter((line) => line.includes("|") && !/^[\s|:-]+$/.test(line)).map((line) => line.split("|").map((cell) => cell.trim()).filter(Boolean));
    if (rows.length) {
      return interpolate(copy.tableSummary, { rows: formatCount(locale, rows.length, units.row), cells: truncate(rows[0].join(", "), 60) });
    }
  }
  return truncate(element.text || element.id, 160);
}

function buildPickerElements(elements: ParsedElement[], copy: EvaluationCopy, locale: AppLocale): PickerElement[] {
  const seen = new Set<string>();
  let section: string | null = null;
  const items: PickerElement[] = [];
  for (const element of elements) {
    if (seen.has(element.id)) continue;
    seen.add(element.id);
    if (element.type === "heading" && element.text.trim()) section = truncate(element.text, 60);
    items.push({ element, section, summary: elementSummary(element, copy, locale) });
  }
  return items;
}

function SourcePicker({ copy, elementTypes, elements, inputId, locale, onChange, value }: {
  copy: EvaluationCopy;
  elementTypes: AppCopy["documents"]["elementTypes"];
  elements: PickerElement[];
  inputId: string;
  locale: AppLocale;
  onChange: (value: string) => void;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState("all");
  const [section, setSection] = useState("all");
  const selectedIds = splitIds(value);
  const byId = useMemo(() => new Map(elements.map((item) => [item.element.id, item])), [elements]);
  const pages = useMemo(() => Array.from(new Set(elements.flatMap((item) => item.element.pageNumbers))).sort((a, b) => a - b), [elements]);
  const sections = useMemo(() => Array.from(new Set(elements.map((item) => item.section).filter((item): item is string => Boolean(item)))), [elements]);
  const needle = query.trim().toLocaleLowerCase(locale);
  const filtered = elements.filter((item) =>
    (page === "all" || item.element.pageNumbers.includes(Number(page)))
    && (section === "all" || item.section === section)
    && (!needle || item.element.text.toLocaleLowerCase(locale).includes(needle) || item.summary.toLocaleLowerCase(locale).includes(needle)));
  const toggle = (id: string) => onChange(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id).join(", ") : [...selectedIds, id].join(", "));
  const pageLabel = (item: PickerElement) => item.element.pageNumbers[0] ? `${UI_COPY[locale].units.pageShort} ${item.element.pageNumbers[0]}` : null;

  return (
    <div className="min-w-0 sm:col-span-2" data-testid={`source-picker-${inputId}`}>
      <p className="text-sm font-medium text-foreground">{copy.evidence}</p>
      <p className="mt-0.5 text-xs text-muted-foreground" id={`${inputId}-hint`}>{copy.evidenceHint}</p>
      {selectedIds.length ? (
        <ul aria-label={copy.evidence} className="mt-2 flex flex-wrap gap-1.5">
          {selectedIds.map((id) => {
            const item = byId.get(id);
            const label = item ? [pageLabel(item), item.summary].filter(Boolean).join(" · ") : id;
            return (
              <li className="inline-flex min-w-0 max-w-full items-center gap-0.5 rounded-sm bg-secondary py-0.5 pl-2 pr-0.5 text-xs text-foreground" key={id}>
                <span className={cn("truncate", !item && "font-mono")}>{label}</span>
                <button aria-label={interpolate(copy.removeSource, { label })} className="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-surface-subtle hover:text-foreground" onClick={() => toggle(id)} type="button"><AppIcon name="close" className="size-3" /></button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {elements.length ? (
        <Button aria-controls={`${inputId}-panel`} aria-expanded={open} className="mt-2" onClick={() => setOpen((current) => !current)} size="sm" type="button" variant="outline">
          <AppIcon name="fileSearch" className="size-4" />{open ? copy.hideSources : copy.chooseSources}<span className="text-subtle-foreground tabular-nums">{formatNumber(locale, elements.length)}</span>
        </Button>
      ) : <p className="mt-2 text-xs text-muted-foreground">{copy.noSources}</p>}
      {open ? (
        <div className="mt-2 rounded-md border border-border" id={`${inputId}-panel`}>
          <div className="flex flex-wrap gap-2 border-b border-border p-2">
            <Input aria-label={copy.searchSources} className="h-8 min-w-[12rem] flex-1" onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} type="search" value={query} />
            {pages.length > 1 ? (
              <Select onValueChange={setPage} value={page}>
                <SelectTrigger aria-label={copy.pageFilter} className="h-8 w-auto min-w-[8rem]"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">{copy.allPages}</SelectItem>{pages.map((number) => <SelectItem key={number} value={String(number)}>{interpolate(copy.pageOption, { page: number })}</SelectItem>)}</SelectContent>
              </Select>
            ) : null}
            {sections.length > 1 ? (
              <Select onValueChange={setSection} value={section}>
                <SelectTrigger aria-label={copy.sectionFilter} className="h-8 w-auto min-w-[10rem] max-w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">{copy.allSections}</SelectItem>{sections.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
              </Select>
            ) : null}
          </div>
          <p aria-live="polite" className="px-3 pt-2 text-xs text-muted-foreground tabular-nums">{interpolate(copy.matchCount, { shown: formatNumber(locale, filtered.length), total: formatNumber(locale, elements.length) })}</p>
          {filtered.length ? (
            // One bounded scroll area; default overscroll lets the page keep scrolling at its ends.
            <ul aria-label={copy.sourceList} className="max-h-72 overflow-y-auto p-1">
              {filtered.map((item) => {
                const selected = selectedIds.includes(item.element.id);
                return (
                  <li key={item.element.id}>
                    <button aria-pressed={selected} className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-surface-subtle" onClick={() => toggle(item.element.id)} type="button">
                      <span aria-hidden="true" className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-sm border", selected ? "border-foreground bg-foreground text-background" : "border-input")}>{selected ? <AppIcon name="check" className="size-3" /> : null}</span>
                      <span className="min-w-0 flex-1">
                        {/* Extracted document text is untrusted data: plain text only. */}
                        <span className="line-clamp-2 break-words text-foreground">{item.summary}</span>
                        <span className="mt-0.5 block text-muted-foreground tabular-nums">{[elementTypes[item.element.type], pageLabel(item), item.section && item.element.type !== "heading" ? item.section : null].filter(Boolean).join(" · ")}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : <p className="p-3 text-xs text-muted-foreground">{copy.noMatches}</p>}
        </div>
      ) : null}
      <TechnicalDetails className="mt-2" title={copy.technicalSources}>
        <Input aria-describedby={`${inputId}-hint`} aria-label={copy.technicalSources} className="font-mono text-xs" id={inputId} onChange={(event) => onChange(event.target.value)} placeholder="element-1, element-4" value={value} />
      </TechnicalDetails>
    </div>
  );
}

function OutcomeSelect({ copy, id, onChange, value }: { copy: EvaluationCopy; id: string; onChange: (value: EvaluationOutcome) => void; value: EvaluationOutcome }) {
  return (
    <label className="text-sm font-medium text-foreground" htmlFor={id}>
      {copy.expectedResult}
      <Select onValueChange={(next) => onChange(next as EvaluationOutcome)} value={value}>
        <SelectTrigger className="mt-1.5" id={id}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="answer">{copy.outcomes.answer}</SelectItem>
          <SelectItem value="insufficient_context">{copy.outcomes.insufficient_context}</SelectItem>
        </SelectContent>
      </Select>
    </label>
  );
}

/** A missing metric is "not measured" — never shown as a measured 0. */
function MetricValue({ copy, value, className }: { copy: EvaluationCopy; value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className={cn("text-subtle-foreground", className)} title={copy.notMeasured}>—<span className="sr-only"> {copy.notMeasured}</span></span>;
  return <span className={cn("text-foreground tabular-nums", className)}>{formatScore(value)}</span>;
}

type MetricRow = { key: string; label: string; value: number | null | undefined; hint?: string; sampleSize?: number | null };

function MetricGroup({ children, copy, locale, note, rows, sampleSize, testId, title }: { children?: ReactNode; copy: EvaluationCopy; locale: AppLocale; note?: string | null; rows: MetricRow[]; sampleSize: number | null | undefined; testId: string; title: string }) {
  const units = UI_COPY[locale].units;
  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {typeof sampleSize === "number" ? <span className="text-xs text-muted-foreground tabular-nums">{interpolate(copy.sampleSize, { count: formatCount(locale, sampleSize, units.question) })}</span> : null}
      </div>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
      <dl className="mt-2 divide-y divide-border rounded-lg border border-border bg-card px-4" data-testid={testId}>
        {rows.map((row) => (
          <div className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-5" key={row.key}>
            <dt className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{row.label}</span>
              {row.hint ? <span className="mt-0.5 block max-w-[560px] text-xs text-muted-foreground">{row.hint}</span> : null}
            </dt>
            <dd className="flex items-baseline gap-2 sm:justify-end">
              <MetricValue className="text-lg font-semibold" copy={copy} value={row.value} />
              {typeof row.sampleSize === "number" && row.sampleSize !== sampleSize ? <span className="text-xs text-subtle-foreground tabular-nums">{interpolate(copy.sampleSize, { count: formatNumber(locale, row.sampleSize) })}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      {children}
    </section>
  );
}

function StageRetrievalTable({ copy, locale, metrics }: { copy: EvaluationCopy; locale: AppLocale; metrics: StageRetrievalMetricsByStage }) {
  const stages = (["retrieval", "reranking", "context"] as const).filter((stage) => metrics[stage]);
  if (!stages.length) return null;
  return (
    <Disclosure className="mt-2" title={copy.perStage} variant="inline">
      <Table aria-label={copy.perStage}>
        <TableHeader><TableRow><TableHead scope="col">{copy.stage}</TableHead><TableHead className="text-right" scope="col">{copy.metrics.hitAtK}</TableHead><TableHead className="text-right" scope="col">{copy.metrics.recallAtK}</TableHead><TableHead className="text-right" scope="col">{copy.metrics.precisionAtK}</TableHead><TableHead className="text-right" scope="col">{copy.metrics.mrr}</TableHead><TableHead className="text-right" scope="col">n</TableHead></TableRow></TableHeader>
        <TableBody>
          {stages.map((stage) => {
            const row = metrics[stage]!;
            return <TableRow key={stage}><TableHead className="normal-case tracking-normal text-foreground" scope="row">{copy.stageNames[stage]}</TableHead><TableCell className="text-right"><MetricValue copy={copy} value={row.hitAtK} /></TableCell><TableCell className="text-right"><MetricValue copy={copy} value={row.recallAtK} /></TableCell><TableCell className="text-right"><MetricValue copy={copy} value={row.precisionAtK} /></TableCell><TableCell className="text-right"><MetricValue copy={copy} value={row.mrr} /></TableCell><TableCell className="text-right">{formatNumber(locale, row.eligibleCaseCount)}</TableCell></TableRow>;
          })}
        </TableBody>
      </Table>
    </Disclosure>
  );
}

type CaseState = "ok" | "review" | "notMeasured";

const caseIcon: Record<CaseState, { icon: SemanticIconName; className: string }> = {
  ok: { icon: "completed", className: "bg-secondary text-muted-foreground" },
  review: { icon: "warningTriangle", className: "bg-warning-subtle text-warning" },
  notMeasured: { icon: "circle", className: "bg-secondary text-subtle-foreground" },
};

/** Diagnostic triage of one question: the threshold flags what to review, it is not a pass/fail verdict. */
function caseDiagnosis(item: EvaluationCaseResult, judge: boolean, copy: EvaluationCopy): { state: CaseState; meta: string } {
  if (item.expectedOutcome === "insufficient_context") {
    if (item.abstentionCorrect === true) return { state: "ok", meta: copy.correctAbstention };
    if (item.abstentionCorrect === false) return { state: "review", meta: copy.unexpectedAnswer };
    return { state: "notMeasured", meta: copy.abstentionNotScored };
  }
  const outcome = item.generationOutcome ?? (item.insufficientContext ? "insufficient_context" : "answered");
  if (outcome === "grounding_rejected") return { state: "review", meta: copy.groundingRejected };
  if (outcome === "insufficient_context") return { state: "review", meta: copy.noAnswerGiven };
  const grounding = (judge ? item.generationMetrics?.faithfulness : item.generationMetrics?.lexicalOverlap) ?? item.groundedness;
  const groundingLabel = judge ? copy.groundingShort.judge : copy.groundingShort.lexical;
  const meta = `${groundingLabel} ${formatScore(grounding)} · ${copy.citationShort} ${formatScore(item.citationValidity)}`;
  if (grounding === null || grounding === undefined || item.citationValidity === null) return { state: "notMeasured", meta };
  return { state: grounding >= CASE_THRESHOLD && item.citationValidity >= CASE_THRESHOLD ? "ok" : "review", meta };
}

function DeltaValue({ comparable, copy, first, second }: { comparable: boolean; copy: EvaluationCopy; first: number | null | undefined; second: number | null | undefined }) {
  if (!comparable) return <span className="text-xs text-subtle-foreground" title={copy.notComparable}>—<span className="sr-only"> {copy.notComparable}</span></span>;
  if (typeof first !== "number" || typeof second !== "number") return <span className="text-xs text-subtle-foreground" title={copy.notMeasured}>—<span className="sr-only"> {copy.notMeasured}</span></span>;
  const delta = second - first;
  if (Math.abs(delta) < 0.005) return <span className="text-xs text-muted-foreground tabular-nums">0.00<span className="sr-only"> {copy.unchanged}</span></span>;
  // Neutral on purpose: the arrow gives the direction, colour must not read as better/worse.
  return (
    <span className="inline-flex items-center justify-end gap-1 text-xs font-medium text-foreground tabular-nums">
      <AppIcon aria-hidden="true" className="size-3 text-muted-foreground" name={delta > 0 ? "trendUp" : "trendDown"} />
      {delta > 0 ? "+" : "−"}{formatScore(Math.abs(delta))}
      <span className="sr-only"> {delta > 0 ? copy.higher : copy.lower}</span>
    </span>
  );
}

type ComparisonMetric = { key: string; label: string; first: number | null | undefined; second: number | null | undefined; comparable: boolean; hint?: string };

function ComparisonMetricTable({ copy, groups }: { copy: EvaluationCopy; groups: Array<{ key: string; label: string; metrics: ComparisonMetric[] }> }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table aria-label={copy.metricComparison} className="w-full text-sm" data-testid="evaluation-compare-metrics">
        <thead>
          <tr className="border-b border-border">
            <th className="px-3 py-2 text-left text-2xs font-medium uppercase tracking-wide text-muted-foreground" scope="col">{copy.metric}</th>
            <th className="w-14 px-2 py-2 text-right text-2xs font-medium uppercase tracking-wide text-muted-foreground" scope="col">{copy.runA}</th>
            <th className="w-14 px-2 py-2 text-right text-2xs font-medium uppercase tracking-wide text-muted-foreground" scope="col">{copy.runB}</th>
            <th className="w-20 px-3 py-2 text-right text-2xs font-medium uppercase tracking-wide text-muted-foreground" scope="col"><abbr className="no-underline" title={copy.deltaNote}>{copy.delta}</abbr></th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.key}>
            <tr><th className="bg-technical px-3 py-2 text-left text-xs font-semibold text-muted-foreground" colSpan={4} scope="rowgroup">{group.label}</th></tr>
            {group.metrics.map((item) => (
              <tr className="border-t border-border" key={item.key}>
                <th className="px-3 py-2.5 text-left font-medium text-foreground" scope="row">{item.label}{item.hint ? <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{item.hint}</span> : null}</th>
                <td className="px-2 py-2.5 text-right"><MetricValue copy={copy} value={item.first} /></td>
                <td className="px-2 py-2.5 text-right"><MetricValue copy={copy} value={item.second} /></td>
                <td className="px-3 py-2.5 text-right"><DeltaValue comparable={item.comparable} copy={copy} first={item.first} second={item.second} /></td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/**
 * Local drafts (dataset form, selected dataset, comparison) belong to one
 * document lineage; remounting on a document, pipeline or parse change keeps
 * them from leaking into another lineage.
 */
export function EvaluationScreen() {
  const { activeDocumentId, activePipelineId, selectedParseRunId } = useDocumentPipeline();
  return <EvaluationWorkspace key={`${activeDocumentId ?? ""}:${activePipelineId ?? ""}:${selectedParseRunId ?? ""}`} />;
}

function EvaluationWorkspace() {
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const allCopy = UI_COPY[locale];
  const copy = allCopy.evaluation;
  const retrievalCopy = allCopy.retrieval;
  const units = allCopy.units;
  const {
    activeDocument,
    activePipeline,
    selectedParseResult: parseResult,
    persistenceStatus,
    workspaceStatus,
    selectedParseRunId,
    selectedChunkRunId,
    selectedEmbeddingRunId,
    capabilities,
    evaluationDatasets,
    evaluationStatus,
    evaluationRun,
    evaluationError,
    resumeRunTracking,
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
  const [chosenTab, setChosenTab] = useState<EvaluationTab | null>(null);
  const [selectedCaseIndex, setSelectedCaseIndex] = useState(0);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [pendingCreateFrom, setPendingCreateFrom] = useState<string[] | null>(null);
  const tabRefs = useRef<Partial<Record<EvaluationTab, HTMLButtonElement | null>>>({});

  // A created dataset becomes the selection and the results view (the next step is running it).
  if (pendingCreateFrom) {
    const created = evaluationDatasets.find((dataset) => !pendingCreateFrom.includes(dataset.id));
    if (created) {
      setPendingCreateFrom(null);
      setDatasetId(created.id);
      setBaseDatasetId(created.id);
      setSubmitAttempted(false);
      setChosenTab("results");
    }
  }
  // Smart default: with a dataset the next step is running it, without one it is creating one.
  const activeTab: EvaluationTab = chosenTab ?? (evaluationDatasets.length ? "results" : "dataset");
  const editForm = () => { if (chosenTab === null) setChosenTab("dataset"); };

  const lineageInput = {
    document: activeDocument,
    pipeline: activePipeline,
    selection: { selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId },
    parseRun: activeDocument?.parseRuns?.find((run) => run.id === selectedParseRunId) ?? null,
    chunkRun: activeDocument?.chunkRuns?.find((run) => run.id === selectedChunkRunId) ?? null,
    embeddingRun: mode === "keyword" ? null : activeDocument?.embeddingRuns?.find((run) => run.id === selectedEmbeddingRunId) ?? null,
    persistenceStatus,
    workspaceStatus,
    processing: evaluationStatus === "processing",
  };
  const datasetAvailability = getPipelineAvailability(locale, "dataset", lineageInput);
  const formError = !datasetName.trim()
    ? blocker(locale, "missing_dataset_name").message
    : !question.trim() || additionalCases.some((item) => !item.question.trim())
      ? copy.enterQuestion
      : (expectedOutcome === "answer" && !elementIds.trim()) || additionalCases.some((item) => item.expectedOutcome === "answer" && !item.elements.trim())
        ? blocker(locale, "missing_sources").message
        : null;
  // A pristine form is not an error: validation speaks only after input or a submit attempt.
  const formDirty = Boolean(datasetName || question || elementIds || referenceAnswer || additionalCases.length);
  const showFormError = Boolean(formError) && (submitAttempted || formDirty);
  // A dataset choice only counts while it belongs to the current lineage's dataset list.
  const selectedDatasetId = evaluationDatasets.some((dataset) => dataset.id === datasetId) ? datasetId : evaluationDatasets[0]?.id ?? "";
  const runAvailability = getPipelineAvailability(locale, "evaluation", { ...lineageInput, hasDataset: Boolean(selectedDatasetId), retrievalMode: mode });
  const canRun = runAvailability.allowed;
  const showRunBlocker = !runAvailability.allowed && !["loading", "processing", "missing_dataset"].includes(runAvailability.code ?? "");
  const showDatasetBlocker = !datasetAvailability.allowed && datasetAvailability.code !== "loading" && datasetAvailability.code !== "processing";
  const selectedRuns = useMemo(() => compareIds.map((id) => evaluationHistory.find((run) => run.id === id)).filter((run): run is EvaluationRun => Boolean(run)).slice(0, 2), [compareIds, evaluationHistory]);
  const selectedDataset = evaluationDatasets.find((dataset) => dataset.id === selectedDatasetId);
  const completedCases = evaluationRun?.caseResults?.length ?? 0;
  const totalCases = selectedDataset?.caseCount ?? 0;
  const parseElements = useMemo(() => buildPickerElements(parseResult?.structured.pages.flatMap((page) => page.elements) ?? [], copy, locale), [copy, locale, parseResult]);
  const configSummary = (config: { retrievalMode: string | null; topK: number | string | null; rerankerEnabled: boolean | null; judge: boolean | null }) => [
    config.retrievalMode && config.retrievalMode in retrievalCopy.modes ? retrievalCopy.modes[config.retrievalMode as RetrievalMode] : config.retrievalMode ?? "—",
    interpolate(copy.configTopK, { k: config.topK ?? "—" }),
    config.rerankerEnabled ? copy.rerankerOn : copy.rerankerOff,
    config.judge ? copy.judgeOn : copy.judgeOff,
  ].join(" · ");
  const activeConfigSummary = configSummary({ retrievalMode: mode, topK, rerankerEnabled: reranker, judge });
  const historyPosition = (runId: string) => {
    const index = evaluationHistory.findIndex((run) => run.id === runId);
    return index < 0 ? 1 : evaluationHistory.length - index;
  };
  const evaluationName = (run: EvaluationRun) => runName(allCopy, "evaluation", run.runNumber ?? historyPosition(run.id));
  const methodLabel = (method: GenerationMetricMethod | null | undefined) => method ? copy.methods[method] : copy.unknown;

  useEffect(() => {
    if (selectedDatasetId) {
      void loadEvaluationDataset(selectedDatasetId);
      void refreshEvaluationRuns(selectedDatasetId);
    }
  }, [loadEvaluationDataset, refreshEvaluationRuns, selectedDatasetId]);

  function selectTab(tab: EvaluationTab) {
    setChosenTab(tab);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = TABS.indexOf(activeTab);
    const next = event.key === "ArrowRight" ? TABS[(index + 1) % TABS.length]
      : event.key === "ArrowLeft" ? TABS[(index - 1 + TABS.length) % TABS.length]
        : event.key === "Home" ? TABS[0]
          : event.key === "End" ? TABS[TABS.length - 1]
            : null;
    if (!next) return;
    event.preventDefault();
    selectTab(next);
    tabRefs.current[next]?.focus();
  }

  function handleCreateDataset() {
    setSubmitAttempted(true);
    if (!datasetAvailability.allowed || formError) return;
    setPendingCreateFrom(evaluationDatasets.map((dataset) => dataset.id));
    void createDataset(datasetName.trim(), [
      { question: question.trim(), relevantElementIds: splitIds(elementIds), referenceAnswer: referenceAnswer.trim() || null, expectedOutcome },
      ...additionalCases.map((item) => ({ question: item.question.trim(), relevantElementIds: splitIds(item.elements), referenceAnswer: item.reference.trim() || null, expectedOutcome: item.expectedOutcome })),
    ], evaluationDatasets.some((dataset) => dataset.id === baseDatasetId) ? baseDatasetId : null);
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

  function updateCase(index: number, patch: Partial<DraftEvaluationCase>) {
    editForm();
    setAdditionalCases((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...patch } : entry));
  }

  const comparisonConfigs = selectedRuns.length >= 2 ? selectedRuns.map((run) => evaluationConfig(run)) : [];
  const comparisonSettings: Array<{ key: keyof EvaluationCopy["settings"]; first: string | number | boolean | null; second: string | number | boolean | null }> = comparisonConfigs.length === 2 ? [
    { key: "retrieval", first: comparisonConfigs[0].retrievalMode, second: comparisonConfigs[1].retrievalMode },
    { key: "topK", first: comparisonConfigs[0].topK, second: comparisonConfigs[1].topK },
    { key: "reranker", first: comparisonConfigs[0].rerankerEnabled, second: comparisonConfigs[1].rerankerEnabled },
    { key: "candidateCount", first: comparisonConfigs[0].candidateCount, second: comparisonConfigs[1].candidateCount },
    { key: "context", first: comparisonConfigs[0].tokenBudget, second: comparisonConfigs[1].tokenBudget },
    { key: "temperature", first: comparisonConfigs[0].temperature, second: comparisonConfigs[1].temperature },
    { key: "maxOutputTokens", first: comparisonConfigs[0].maxOutputTokens, second: comparisonConfigs[1].maxOutputTokens },
    { key: "judge", first: comparisonConfigs[0].judge, second: comparisonConfigs[1].judge },
  ] : [];
  const changedSettings = comparisonSettings.filter((item) => item.first !== null && item.second !== null && item.first !== item.second);
  const visibleComparisonSettings = onlyChanged ? changedSettings : comparisonSettings;
  const comparisonChecks = comparisonConfigs.length === 2 ? [
    { key: "dataset" as const, state: comparableValue(selectedRuns[0].datasetId, selectedRuns[1].datasetId) },
    { key: "pipeline" as const, state: comparableValue(comparisonConfigs[0].pipelineId ?? stringValue(selectedRuns[0].upstream.pipelineId), comparisonConfigs[1].pipelineId ?? stringValue(selectedRuns[1].upstream.pipelineId)) },
    { key: "embedding" as const, state: comparableValue(comparisonConfigs[0].embeddingRunId, comparisonConfigs[1].embeddingRunId) },
  ] : [];

  function settingValue(key: keyof EvaluationCopy["settings"], value: string | number | boolean | null) {
    if (value === null) return copy.unknown;
    if (typeof value === "boolean") return key === "judge" ? (value ? copy.judgeOn : copy.judgeOff) : (value ? copy.rerankerOn : copy.rerankerOff);
    if (typeof value === "string" && value in retrievalCopy.modes) return retrievalCopy.modes[value as RetrievalMode];
    return typeof value === "number" ? formatNumber(locale, value) : value;
  }

  const panelClass = "mt-6";
  return (
    <div className="min-w-0 bg-background" data-testid="evaluation-screen">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <PageHeader data-testid="evaluation-page-header" description={copy.description} title={copy.title} />

        <section aria-label={copy.contextLabel} className="mt-6 rounded-lg border border-border bg-card px-4 py-3" data-testid="evaluation-workspace-context">
          <div className="flex flex-col gap-1 md:flex-row md:items-center md:gap-3">
            <p className="min-w-0 truncate text-sm font-medium text-foreground">
              {selectedDataset ? selectedDataset.name : copy.noDataset}
              {selectedDataset ? <span className="font-normal text-muted-foreground tabular-nums"> {interpolate(copy.datasetVersion, { version: selectedDataset.version })} · {formatCount(locale, selectedDataset.caseCount, units.question)}</span> : null}
            </p>
            <span aria-hidden="true" className="hidden text-subtle-foreground md:inline">—</span>
            <p className="min-w-0 break-words text-sm text-muted-foreground" data-testid="evaluation-config-summary">{activeConfigSummary}</p>
            {!selectedDataset ? <StatusPill className="md:ml-auto" tone="idle">{copy.datasetNeeded}</StatusPill> : null}
          </div>
        </section>

        <div className="mt-4 border-b border-border">
          <SlidingTabs aria-label={copy.tabsLabel} className="flex gap-2" data-testid="evaluation-tabs" role="tablist" underline value={activeTab}>
            {TABS.map((tab) => (
              <button
                aria-controls={activeTab === tab ? `evaluation-panel-${tab}` : undefined}
                aria-selected={activeTab === tab}
                className={activeTab === tab ? "border-b-2 border-foreground px-1 py-2.5 text-sm font-medium text-foreground" : "border-b-2 border-transparent px-1 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground"}
                data-testid={`evaluation-tab-${tab}`}
                id={`evaluation-tab-${tab}`}
                key={tab}
                onClick={() => selectTab(tab)}
                onKeyDown={handleTabKeyDown}
                ref={(element) => { tabRefs.current[tab] = element; }}
                role="tab"
                tabIndex={activeTab === tab ? 0 : -1}
                type="button"
              >
                {copy.tabs[tab]}
              </button>
            ))}
          </SlidingTabs>
        </div>

        {activeTab === "dataset" ? (
          <TransitionPanel aria-labelledby="evaluation-tab-dataset" as="section" className={panelClass} data-testid="evaluation-panel-dataset" id="evaluation-panel-dataset" role="tabpanel" transitionKey={activeTab}>
            <p className="text-sm text-muted-foreground">{copy.datasetIntro}</p>
            <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="min-w-0 rounded-lg border border-border bg-card p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-medium text-foreground" htmlFor="dataset-name">{copy.name}<Input className="mt-1.5" id="dataset-name" onChange={(event) => { editForm(); setDatasetName(event.target.value); }} value={datasetName} /></label>
                  <label className="text-sm font-medium text-foreground" htmlFor="golden-question">{copy.question}<Input className="mt-1.5" id="golden-question" onChange={(event) => { editForm(); setQuestion(event.target.value); }} value={question} /></label>
                  <OutcomeSelect copy={copy} id="expected-outcome" onChange={(value) => { editForm(); setExpectedOutcome(value); }} value={expectedOutcome} />
                  {expectedOutcome === "answer"
                    ? <SourcePicker copy={copy} elementTypes={allCopy.documents.elementTypes} elements={parseElements} inputId="relevant-elements" locale={locale} onChange={(value) => { editForm(); setElementIds(value); }} value={elementIds} />
                    : <p className="text-xs text-muted-foreground sm:col-span-2" data-testid="insufficient-context-case-hint">{copy.abstentionHint}</p>}
                  <label className="text-sm font-medium text-foreground sm:col-span-2" htmlFor="reference-answer">{copy.reference}<Input className="mt-1.5" id="reference-answer" onChange={(event) => { editForm(); setReferenceAnswer(event.target.value); }} value={referenceAnswer} /></label>
                </div>
                {additionalCases.map((item, index) => (
                  <fieldset className="mt-5 grid min-w-0 gap-4 border-t border-border pt-4 sm:grid-cols-2" key={`case-${index}`}>
                    <legend className="float-left text-xs font-semibold text-muted-foreground sm:col-span-2">{interpolate(copy.questionNumber, { number: index + 2 })}</legend>
                    <label className="clear-left text-sm font-medium text-foreground" htmlFor={`case-question-${index}`}>{copy.question}<Input className="mt-1.5" id={`case-question-${index}`} onChange={(event) => updateCase(index, { question: event.target.value })} value={item.question} /></label>
                    <OutcomeSelect copy={copy} id={`case-outcome-${index}`} onChange={(value) => updateCase(index, { expectedOutcome: value })} value={item.expectedOutcome} />
                    {item.expectedOutcome === "answer"
                      ? <SourcePicker copy={copy} elementTypes={allCopy.documents.elementTypes} elements={parseElements} inputId={`case-elements-${index}`} locale={locale} onChange={(value) => updateCase(index, { elements: value })} value={item.elements} />
                      : <p className="text-xs text-muted-foreground sm:col-span-2">{copy.noEvidenceNeeded}</p>}
                    <label className="text-sm font-medium text-foreground sm:col-span-2" htmlFor={`case-reference-${index}`}>{copy.reference}<Input className="mt-1.5" id={`case-reference-${index}`} onChange={(event) => updateCase(index, { reference: event.target.value })} value={item.reference} /></label>
                    <div className="flex flex-wrap gap-1.5 sm:col-span-2">
                      <Button onClick={() => { editForm(); setAdditionalCases((current) => [...current.slice(0, index + 1), { ...item }, ...current.slice(index + 1)]); }} size="sm" type="button" variant="outline">{copy.duplicate}</Button>
                      <Button disabled={index === 0} onClick={() => setAdditionalCases((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })} size="sm" type="button" variant="ghost">{copy.moveUp}</Button>
                      <Button disabled={index === additionalCases.length - 1} onClick={() => setAdditionalCases((current) => { const next = [...current]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; })} size="sm" type="button" variant="ghost">{copy.moveDown}</Button>
                      <Button onClick={() => setAdditionalCases((current) => current.filter((_, entryIndex) => entryIndex !== index))} size="sm" type="button" variant="ghost">{copy.removeCase}</Button>
                    </div>
                  </fieldset>
                ))}
                <Button className="mt-5" onClick={() => { editForm(); setAdditionalCases((current) => [...current, { question: "", elements: "", reference: "", expectedOutcome: "answer" }]); }} size="sm" type="button" variant="outline"><AppIcon name="plus" className="size-4" />{copy.addCase}</Button>
              </div>
              <aside aria-labelledby="evaluation-datasets-title" className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground" id="evaluation-datasets-title">{copy.datasets}</h3>
                {evaluationDatasets.length ? (
                  <ul className="mt-2 space-y-1.5">
                    {evaluationDatasets.map((dataset) => (
                      <li key={dataset.id}>
                        <button aria-pressed={dataset.id === selectedDatasetId} className={dataset.id === selectedDatasetId ? "block w-full rounded-md border border-hover-border bg-secondary px-3 py-2 text-left" : "block w-full rounded-md border border-border bg-card px-3 py-2 text-left hover:bg-surface-subtle"} onClick={() => { setDatasetId(dataset.id); setBaseDatasetId(dataset.id); }} type="button">
                          <span className="block truncate text-sm font-medium text-foreground">{dataset.name} · {interpolate(copy.datasetVersion, { version: dataset.version })}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">{formatCount(locale, dataset.caseCount, units.question)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-2 text-xs text-muted-foreground">{copy.noDatasets}</p>}
              </aside>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              <Button aria-busy={evaluationStatus === "processing"} aria-describedby={showDatasetBlocker ? "dataset-disabled-reason" : showFormError ? "dataset-form-error" : undefined} disabled={!datasetAvailability.allowed} onClick={handleCreateDataset}><AppIcon name="database" className="size-3.5" />{copy.create}</Button>
              {showDatasetBlocker ? <StageBlocker blocker={datasetAvailability} id="dataset-disabled-reason" /> : showFormError ? <p className={cn("text-xs", submitAttempted ? "text-destructive" : "text-muted-foreground")} id="dataset-form-error" role="status">{formError}</p> : null}
            </div>
            {evaluationError && activeTab === "dataset" ? <div className="mt-3"><PipelineErrorMessage message={evaluationError.message} /></div> : null}
          </TransitionPanel>
        ) : null}

        {activeTab === "results" ? (
          <TransitionPanel aria-labelledby="evaluation-tab-results" as="section" className={panelClass} data-testid="evaluation-panel-results" id="evaluation-panel-results" role="tabpanel" transitionKey={activeTab}>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
                <label className="min-w-[180px] text-xs font-medium text-muted-foreground" htmlFor="evaluation-dataset">{copy.selectDataset}<Select onValueChange={(value) => { setDatasetId(value); setBaseDatasetId(value); }} value={selectedDatasetId}><SelectTrigger className="mt-1.5" id="evaluation-dataset"><SelectValue placeholder={copy.noDataset} /></SelectTrigger><SelectContent>{evaluationDatasets.map((dataset) => <SelectItem key={dataset.id} value={dataset.id}>{dataset.name} · {interpolate(copy.datasetVersion, { version: dataset.version })}</SelectItem>)}</SelectContent></Select></label>
                <fieldset><legend className="text-xs font-medium text-muted-foreground">{retrievalCopy.retrieval}</legend><div aria-label={retrievalCopy.mode} className="mt-1.5 flex h-9 items-center rounded-md border border-border bg-secondary p-1" role="group">{(["dense", "hybrid", "keyword"] as const).map((value) => <button aria-pressed={mode === value} className={mode === value ? "h-full rounded-sm bg-card px-3 text-xs font-medium text-foreground shadow-sm" : "h-full rounded-sm px-3 text-xs text-muted-foreground hover:bg-card/70"} key={value} onClick={() => setMode(value)} type="button">{retrievalCopy.modes[value]}</button>)}</div></fieldset>
                <label className="text-xs font-medium text-muted-foreground" htmlFor="evaluation-top-k">{retrievalCopy.topK}<Select onValueChange={setTopK} value={topK}><SelectTrigger className="mt-1.5 w-[76px] tabular-nums" id="evaluation-top-k"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="3">3</SelectItem><SelectItem value="5">5</SelectItem><SelectItem value="10">10</SelectItem></SelectContent></Select></label>
                <div>
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{retrievalCopy.reranker}</span>
                  <label className="flex h-9 min-w-[108px] items-center justify-between gap-3 rounded-md border border-input bg-card pl-3 pr-1 text-xs font-medium text-muted-foreground" data-testid="evaluation-reranker-control" htmlFor="evaluation-reranker">
                    <span>{reranker ? retrievalCopy.on : retrievalCopy.off}</span>
                    <Switch aria-label={retrievalCopy.reranker} checked={reranker} className="h-9" id="evaluation-reranker" onCheckedChange={setReranker} />
                  </label>
                </div>
                <Button aria-busy={evaluationStatus === "processing"} aria-describedby={!canRun ? "evaluation-disabled-reason" : undefined} className="sm:ml-auto" disabled={!canRun} onClick={handleRun}><AppIcon name="play" className="size-4" />{copy.run}</Button>
              </div>
              <Disclosure className="mt-3" title={copy.advanced} variant="inline">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center justify-between gap-3 text-xs font-medium text-foreground" htmlFor="evaluation-judge"><span>{copy.judge}<span className="mt-1 block font-normal text-muted-foreground">{capabilities?.judgeModel ? interpolate(copy.judgeHint, { model: capabilities.judgeModel }) : copy.judgeHintGeneric}</span></span><Switch checked={judge} id="evaluation-judge" onCheckedChange={setJudge} /></label>
                  <p className="text-xs text-muted-foreground">{copy.separateMetrics}</p>
                </div>
              </Disclosure>
              {!canRun ? <span className="sr-only" id="evaluation-disabled-reason">{runAvailability.message}</span> : null}
            </div>
            <StageBlocker blocker={showRunBlocker ? runAvailability : null} className="mt-3" data-testid="evaluation-blocker" />
            {evaluationError ? <div className="mt-3"><PipelineErrorMessage message={evaluationError.code === "run_poll_timeout" ? copy.trackingPaused : evaluationError.message} /></div> : null}
            {evaluationRun && (evaluationRun.status === "queued" || evaluationRun.status === "running") && evaluationStatus !== "processing" ? <Button className="mt-3" onClick={() => void resumeRunTracking("evaluation")} variant="outline">{copy.resumeTracking}</Button> : null}
            {evaluationStatus === "processing" && totalCases > 0 ? (
              <div className="mt-4" role="status">
                <div className="flex justify-between text-xs text-muted-foreground"><span>{copy.progress}</span><span className="tabular-nums">{formatNumber(locale, completedCases)}/{formatNumber(locale, totalCases)}</span></div>
                <div aria-label={copy.progress} aria-valuemax={totalCases} aria-valuemin={0} aria-valuenow={completedCases} className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar"><div className="h-full origin-left bg-muted-foreground transition-transform duration-300 motion-reduce:transition-none" style={{ transform: `scaleX(${Math.min(1, completedCases / totalCases)})` }} /></div>
              </div>
            ) : null}

            {evaluationRun ? (() => {
              const results = evaluationRun.results;
              const judgeUsed = usedJudge(evaluationRun);
              const generationMetrics = results.generationMetrics;
              const caseCount = results.caseCount ?? completedCases;
              const failedCases = evaluationRun.caseResults?.filter((item) => item.status === "failed") ?? [];
              const measuredCases = evaluationRun.caseResults?.filter((item) => item.status !== "failed") ?? [];
              const activeCase = measuredCases[selectedCaseIndex] ? selectedCaseIndex : 0;
              const groundingLabel = judgeUsed ? copy.metrics.faithfulness : copy.metrics.lexicalOverlap;
              const answerRows: MetricRow[] = [
                ...(judgeUsed ? [
                  { key: "faithfulness", label: copy.metrics.faithfulness, value: generationMetrics?.faithfulness, hint: copy.metricHints.faithfulness, sampleSize: generationMetrics?.scoredCaseCount },
                  { key: "answerRelevance", label: copy.metrics.answerRelevance, value: generationMetrics?.answerRelevance, sampleSize: generationMetrics?.scoredCaseCount },
                  { key: "answerCorrectness", label: copy.metrics.answerCorrectness, value: generationMetrics?.answerCorrectness, sampleSize: generationMetrics?.eligibleCaseCount },
                ] : []),
                ...(!judgeUsed || typeof generationMetrics?.lexicalOverlap === "number" ? [{ key: "lexicalOverlap", label: copy.metrics.lexicalOverlap, value: generationMetrics?.lexicalOverlap, hint: copy.metricHints.lexicalOverlap, sampleSize: generationMetrics?.lexicalScoredCaseCount }] : []),
                { key: "citationValidity", label: copy.metrics.citationValidity, value: results.citationValidity, hint: copy.metricHints.citationValidity, sampleSize: results.citationValidityEligibleCaseCount },
                { key: "abstentionAccuracy", label: copy.metrics.abstentionAccuracy, value: results.abstentionAccuracy, hint: copy.metricHints.abstentionAccuracy, sampleSize: results.abstentionEligibleCaseCount },
                ...(typeof results.answerableCaseCount === "number" ? [{ key: "falseAbstentionRate", label: copy.metrics.falseAbstentionRate, value: results.falseAbstentionRate, hint: copy.metricHints.falseAbstentionRate, sampleSize: results.answerableCaseCount }] : []),
              ];
              return (
                <>
                  <p className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground tabular-nums" data-testid="evaluation-run-summary">
                    <span className="font-medium text-foreground">{evaluationName(evaluationRun)}</span>
                    <span>· {interpolate(copy.sampleSize, { count: formatCount(locale, caseCount, units.question) })}</span>
                    {typeof results.retrievalEligibleCaseCount === "number" ? <span>· {interpolate(copy.retrievalEligible, { count: formatNumber(locale, results.retrievalEligibleCaseCount) })}</span> : null}
                    {results.failedCaseCount ? <span className="text-destructive">· {interpolate(copy.failedSummary, { count: formatNumber(locale, results.failedCaseCount) })}</span> : null}
                  </p>
                  <div className="mt-4 grid gap-6 lg:grid-cols-2">
                    <MetricGroup copy={copy} locale={locale} note={results.stageRetrievalMetrics ? copy.retrievalStageNote : null} rows={[
                      { key: "hitAtK", label: copy.metrics.hitAtK, value: results.hitAtK },
                      { key: "recallAtK", label: copy.metrics.recallAtK, value: results.recallAtK },
                      { key: "precisionAtK", label: copy.metrics.precisionAtK, value: results.precisionAtK },
                      { key: "mrr", label: copy.metrics.mrr, value: results.mrr },
                    ]} sampleSize={results.retrievalEligibleCaseCount} testId="evaluation-retrieval-metrics" title={copy.retrievalQuality}>
                      {results.stageRetrievalMetrics ? <StageRetrievalTable copy={copy} locale={locale} metrics={results.stageRetrievalMetrics} /> : null}
                    </MetricGroup>
                    <MetricGroup copy={copy} locale={locale} rows={answerRows} sampleSize={results.completedCaseCount ?? caseCount} testId="evaluation-answer-metrics" title={copy.answerQuality} />
                  </div>

                  {measuredCases.length ? (
                    <section aria-labelledby="evaluation-cases-title" className="mt-8">
                      <h2 className="text-sm font-semibold text-foreground" id="evaluation-cases-title">{copy.cases}</h2>
                      <p className="mt-1 text-xs text-muted-foreground" data-testid="evaluation-case-threshold">{interpolate(copy.threshold, { grounding: groundingLabel })}</p>
                      <div className="mt-3 space-y-2">
                        {measuredCases.map((item, index) => {
                          const noAnswerCase = item.expectedOutcome === "insufficient_context";
                          const diagnosis = caseDiagnosis(item, judgeUsed, copy);
                          const icon = caseIcon[diagnosis.state];
                          return (
                            <Disclosure contentClassName="grid gap-4 p-4 md:grid-cols-2" data-state={diagnosis.state} data-testid="evaluation-case" key={item.experimentId || `${item.question}-${index}`} meta={diagnosis.meta} onToggle={(event) => { if (event.currentTarget.open) setSelectedCaseIndex(index); }} open={activeCase === index} title={<span className="flex min-w-0 items-center gap-3"><span className={cn("grid size-6 shrink-0 place-items-center rounded-full", icon.className)} title={copy.caseStates[diagnosis.state]}><AppIcon aria-hidden="true" className="size-3.5" name={icon.icon} /><span className="sr-only">{copy.caseStates[diagnosis.state]}</span></span><span className="min-w-0 flex-1 truncate">{item.question}</span></span>}>
                              <div>
                                <p className="text-xs text-muted-foreground">{copy.expectedSources}</p>
                                <p className="mt-1 text-sm text-foreground tabular-nums">{noAnswerCase ? copy.noAnswerExpected : item.expectedElementIds.length || "—"}</p>
                                {item.expectedElementIds.length ? <div className="mt-2"><SourceInspector documentId={activeDocument?.id ?? null} parseResult={parseResult} sourceElementIds={item.expectedElementIds} triggerAriaLabel={interpolate(retrievalCopy.inspectSource, { label: copy.expectedSources })} triggerLabel={copy.expectedSources} /></div> : null}
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">{copy.retrievedSources}</p>
                                <p className="mt-1 text-sm text-foreground tabular-nums">{item.retrievedElementIds.length || "—"}</p>
                                {item.retrievedElementIds.length ? <div className="mt-2"><SourceInspector documentId={activeDocument?.id ?? null} parseResult={parseResult} sourceElementIds={item.retrievedElementIds} triggerAriaLabel={interpolate(retrievalCopy.inspectSource, { label: copy.retrievedSources })} triggerLabel={copy.retrievedSources} /></div> : null}
                              </div>
                              {noAnswerCase ? <p className="text-xs text-muted-foreground md:col-span-2">{copy.abstentionCorrectness}: <span className="text-foreground">{item.abstentionCorrect === null || item.abstentionCorrect === undefined ? copy.notMeasured : item.abstentionCorrect ? copy.correct : copy.incorrect}</span></p> : null}
                              <div className="md:col-span-2">
                                <p className="text-xs text-muted-foreground">{copy.generatedAnswer}</p>
                                <p className="mt-1 break-words text-sm text-foreground">{item.answer || (item.insufficientContext ? copy.abstained : copy.noGeneration)}</p>
                              </div>
                            </Disclosure>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}

                  {failedCases.length ? (
                    <section aria-labelledby="evaluation-failed-title" className="mt-6" data-testid="evaluation-failed-cases">
                      <h2 className="text-sm font-semibold text-foreground" id="evaluation-failed-title">{copy.failedCases}</h2>
                      <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-card">
                        {failedCases.map((item, index) => (
                          <li className="px-4 py-3" key={`${item.question}-${index}`}>
                            <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="min-w-0 text-sm text-foreground">{item.question}</p><span className="text-xs text-destructive">{copy.errorCode}: <span className="font-mono">{item.errorCode ?? "—"}</span></span></div>
                            {item.errorMessage ? <TechnicalDetails className="mt-1"><p className="break-words text-xs text-muted-foreground">{item.errorMessage}</p></TechnicalDetails> : null}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  <Disclosure className="mt-6" contentClassName="grid gap-4 p-4 text-xs sm:grid-cols-2" data-testid="evaluation-run-details" title={copy.details}>
                    <div><p className="text-muted-foreground">{copy.configuration}</p><p className="mt-1 text-sm text-foreground">{configSummary(evaluationConfig(evaluationRun))}</p></div>
                    <div className="min-w-0"><p className="text-muted-foreground">{copy.provenance}</p><p className="mt-1 text-sm text-foreground [overflow-wrap:anywhere]">{activeDocument?.fileName ?? "—"} · {activePipeline?.name ?? "—"}</p></div>
                    <div><p className="text-muted-foreground">{copy.output}</p><p className="mt-1 text-sm text-foreground tabular-nums">{formatCount(locale, caseCount, units.question)} · {copy.judge}: {results.judgeModel ?? (judgeUsed ? capabilities?.judgeModel : null) ?? "—"} · {copy.metricMethod}: {methodLabel(generationMetrics?.method)}</p></div>
                    <TechnicalDetails title={copy.identifiers}><p className="break-all font-mono text-xs text-muted-foreground">Run: {evaluationRun.id}</p><p className="mt-1 break-all font-mono text-xs text-muted-foreground">Dataset: {evaluationRun.datasetId}</p>{generationMetrics?.metricVersion ? <p className="mt-1 break-all font-mono text-xs text-muted-foreground">Metric: {generationMetrics.metricVersion}</p> : null}</TechnicalDetails>
                  </Disclosure>
                </>
              );
            })() : evaluationStatus !== "processing" ? (
              <EmptyState
                action={!selectedDataset ? <Button onClick={() => selectTab("dataset")} size="sm" variant="outline">{copy.goToDataset}</Button> : null}
                className="mt-6 min-h-[210px] rounded-lg border border-border bg-card"
                description={selectedDataset ? interpolate(copy.noRunsDescription, { dataset: selectedDataset.name }) : copy.noDatasetDescription}
                icon="evaluate"
                title={copy.noDataTitle}
                titleAs="h2"
              />
            ) : null}
          </TransitionPanel>
        ) : null}

        {activeTab === "compare" ? (
          <TransitionPanel aria-labelledby="evaluation-tab-compare" as="section" className={panelClass} data-testid="evaluation-panel-compare" id="evaluation-panel-compare" role="tabpanel" transitionKey={activeTab}>
            {selectedRuns.length >= 2 ? (() => {
              const [runA, runB] = selectedRuns;
              const methodA = runA.results.generationMetrics?.method ?? null;
              const methodB = runB.results.generationMetrics?.method ?? null;
              const methodsMatch = methodA === methodB;
              const anyJudge = usedJudge(runA) || usedJudge(runB);
              const settingsDiffer = changedSettings.length > 0;
              const metric = (key: string, label: string, pick: (run: EvaluationRun) => number | null | undefined, comparable = true, hint?: string): ComparisonMetric => ({ key, label, first: pick(runA), second: pick(runB), comparable, hint });
              return (
                <div data-testid="evaluation-compare-content">
                  <div className="grid gap-3 lg:grid-cols-2">
                    {selectedRuns.map((run, index) => {
                      const letter = index === 0 ? copy.runA : copy.runB;
                      return (
                        <article className="min-w-0 rounded-lg border border-border bg-card px-4 py-3" data-testid={`evaluation-compare-run-${index === 0 ? "a" : "b"}`} key={run.id}>
                          <div className="flex items-center justify-between gap-2">
                            <span aria-hidden="true" className="grid size-6 place-items-center rounded-sm bg-secondary text-xs font-semibold text-foreground">{letter}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">{runDate(run, locale) ?? "—"}</span>
                          </div>
                          <h2 className="mt-1.5 truncate text-base font-medium text-foreground"><span className="sr-only">{letter}: </span>{evaluationName(run)}</h2>
                          <p className="mt-1 text-xs text-muted-foreground tabular-nums">{formatMs(locale, run.timing.durationMs)} · {formatCount(locale, run.results.caseCount ?? 0, units.question)}</p>
                        </article>
                      );
                    })}
                  </div>
                  <section aria-labelledby="evaluation-compatibility-title" className="mt-5 rounded-lg border border-border bg-card p-4" data-testid="evaluation-compare-context">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 className="text-sm font-semibold text-foreground" id="evaluation-compatibility-title">{copy.compatibility}</h2>
                      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground" htmlFor="evaluation-only-changed">{copy.onlyChanged}<Switch checked={onlyChanged} id="evaluation-only-changed" onCheckedChange={setOnlyChanged} /></label>
                    </div>
                    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-y border-border py-2.5 text-xs" data-testid="evaluation-compare-checks">
                      {comparisonChecks.map((item) => (
                        <li className="inline-flex items-center gap-1.5" key={item.key}>
                          <span className="text-foreground">{copy.contextChecks[item.key]}</span>
                          {item.state === "same"
                            ? <span className="inline-flex text-muted-foreground" title={copy.same}><AppIcon aria-hidden="true" className="size-3.5" name="check" /><span className="sr-only">{copy.same}</span></span>
                            : <span className={item.state === "different" ? "text-warning" : "text-subtle-foreground"}>{item.state === "different" ? copy.different : copy.unknown}</span>}
                        </li>
                      ))}
                      <li className={settingsDiffer ? "text-warning" : "text-muted-foreground"}>{settingsDiffer ? copy.settingsDifferent : copy.settingsSame}</li>
                    </ul>
                    <h3 className="mt-3 text-xs font-semibold text-muted-foreground">{copy.changedSettings}</h3>
                    {visibleComparisonSettings.length ? (
                      <table aria-label={copy.changedSettings} className="mt-2 w-full text-xs">
                        <thead><tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground"><th className="py-1.5 pr-3 font-medium" scope="col">{copy.setting}</th><th className="px-2 py-1.5 font-medium" scope="col">{copy.runA}</th><th className="py-1.5 pl-2 font-medium" scope="col">{copy.runB}</th></tr></thead>
                        <tbody className="divide-y divide-border">
                          {visibleComparisonSettings.map((item) => {
                            const changed = item.first !== null && item.second !== null && item.first !== item.second;
                            return <tr key={item.key}><th className="py-2 pr-3 text-left font-medium text-foreground" scope="row">{copy.settings[item.key]}</th><td className={cn("px-2 py-2", changed ? "font-medium text-foreground" : "text-muted-foreground")}>{settingValue(item.key, item.first)}</td><td className={cn("py-2 pl-2", changed ? "font-medium text-foreground" : "text-muted-foreground")}>{settingValue(item.key, item.second)}</td></tr>;
                          })}
                        </tbody>
                      </table>
                    ) : <p className="mt-2 text-xs text-muted-foreground">{copy.noChanges}</p>}
                  </section>
                  <section aria-labelledby="evaluation-metric-comparison-title" className="mt-8">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h2 className="text-sm font-semibold text-foreground" id="evaluation-metric-comparison-title">{copy.metricComparison}</h2>
                      <span className="text-xs text-muted-foreground">{copy.deltaNote}</span>
                    </div>
                    {!methodsMatch ? <p className="mt-1 text-xs text-muted-foreground" data-testid="evaluation-method-mismatch">{interpolate(copy.methodMismatch, { a: methodLabel(methodA), b: methodLabel(methodB) })}</p> : null}
                    <div className="mt-3">
                      <ComparisonMetricTable copy={copy} groups={[
                        { key: "retrieval", label: copy.retrievalQuality, metrics: [
                          metric("hitAtK", copy.metrics.hitAtK, (run) => run.results.hitAtK),
                          metric("recallAtK", copy.metrics.recallAtK, (run) => run.results.recallAtK),
                          metric("precisionAtK", copy.metrics.precisionAtK, (run) => run.results.precisionAtK),
                          metric("mrr", copy.metrics.mrr, (run) => run.results.mrr),
                        ] },
                        { key: "answer", label: copy.answerQuality, metrics: [
                          ...(anyJudge ? [
                            metric("faithfulness", copy.metrics.faithfulness, (run) => run.results.generationMetrics?.faithfulness, methodsMatch),
                            metric("answerRelevance", copy.metrics.answerRelevance, (run) => run.results.generationMetrics?.answerRelevance, methodsMatch),
                            metric("answerCorrectness", copy.metrics.answerCorrectness, (run) => run.results.generationMetrics?.answerCorrectness, methodsMatch),
                          ] : []),
                          metric("lexicalOverlap", copy.metrics.lexicalOverlap, (run) => run.results.generationMetrics?.lexicalOverlap),
                          metric("citationValidity", copy.metrics.citationValidity, (run) => run.results.citationValidity, true, copy.metricHints.citationValidity),
                          metric("abstentionAccuracy", copy.metrics.abstentionAccuracy, (run) => run.results.abstentionAccuracy),
                          ...(typeof runA.results.falseAbstentionRate === "number" || typeof runB.results.falseAbstentionRate === "number" ? [metric("falseAbstentionRate", copy.metrics.falseAbstentionRate, (run) => run.results.falseAbstentionRate)] : []),
                        ] },
                      ]} />
                    </div>
                  </section>
                </div>
              );
            })() : <EmptyState className="min-h-[210px] rounded-lg border border-border bg-card" description={evaluationHistory.length >= 2 ? copy.noCompare : copy.notEnoughRuns} icon="evaluate" title={copy.compareTitle} titleAs="h2" />}
            {/* With fewer than two selected runs the next step is picking them, so the history starts open. */}
            <Disclosure className="mt-6" contentClassName="p-0" data-testid="evaluation-history" defaultOpen={selectedRuns.length < 2} meta={formatNumber(locale, evaluationHistory.length)} title={copy.history}>
              {evaluationHistory.length ? (
                <Table>
                  <TableHeader><TableRow><TableHead className="w-10 pl-4"><span className="sr-only">{copy.tabs.compare}</span></TableHead><TableHead>{copy.runColumn}</TableHead><TableHead className="text-right">{copy.metrics.hitAtK}</TableHead><TableHead className="text-right">{copy.metrics.mrr}</TableHead><TableHead className="hidden text-right sm:table-cell">{copy.metrics.recallAtK}</TableHead><TableHead className="hidden text-right sm:table-cell">{copy.metrics.precisionAtK}</TableHead><TableHead className="hidden text-right md:table-cell">{copy.metrics.citationValidity}</TableHead><TableHead className="hidden pr-4 text-right md:table-cell">{copy.groundingShort.lexical}</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {evaluationHistory.map((run) => {
                      const name = evaluationName(run);
                      return (
                        <TableRow key={run.id}>
                          <TableCell className="pl-4"><TransitionCheckbox aria-label={interpolate(copy.compareRun, { name })} checked={compareIds.includes(run.id)} disabled={!compareIds.includes(run.id) && compareIds.length >= 2} onChange={() => toggleCompare(run.id)} /></TableCell>
                          <TableCell className="text-xs"><span className="block font-medium">{name}</span><span className="block text-muted-foreground">{runDate(run, locale) ?? "—"}</span></TableCell>
                          <TableCell className="text-right"><MetricValue copy={copy} value={run.results.hitAtK} /></TableCell>
                          <TableCell className="text-right"><MetricValue copy={copy} value={run.results.mrr} /></TableCell>
                          <TableCell className="hidden text-right sm:table-cell"><MetricValue copy={copy} value={run.results.recallAtK} /></TableCell>
                          <TableCell className="hidden text-right sm:table-cell"><MetricValue copy={copy} value={run.results.precisionAtK} /></TableCell>
                          <TableCell className="hidden text-right md:table-cell"><MetricValue copy={copy} value={run.results.citationValidity} /></TableCell>
                          <TableCell className="hidden pr-4 text-right md:table-cell"><MetricValue copy={copy} value={run.results.generationMetrics?.lexicalOverlap} /></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : <p className="p-4 text-sm text-muted-foreground">{copy.notEnoughRuns}</p>}
            </Disclosure>
          </TransitionPanel>
        ) : null}
      </div>
    </div>
  );
}
