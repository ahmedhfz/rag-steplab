"use client";

import NumberFlow, { NumberFlowGroup, useIsSupported } from "@number-flow/react";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { usePreferences } from "@/components/preferences-provider";
import { SourceInspector } from "@/components/source-inspector";
import { StageBlocker } from "@/components/stage-blocker";
import { AppIcon } from "@/components/ui/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { chartColors, type ChartColor } from "@/components/ui/chart-colors";
import { CheckboxBox } from "@/components/ui/checkbox";
import { Disclosure, TechnicalDetails } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelHeader, Section } from "@/components/ui/panel";
import { ProgressBar } from "@/components/ui/progress";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { type Status, StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCard, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { InfoTip } from "@/components/ui/info-tip";
import { Tooltip } from "@/components/ui/tooltip";
import { Tracker, type TrackerBlock } from "@/components/ui/tracker";
import { TransitionCheckbox, TransitionPanel } from "@/components/ui/transitions";
import { useSlidingIndicator } from "@/components/ui/use-sliding-indicator";
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
const RETRIEVAL_MODES = ["dense", "hybrid", "keyword"] as const;
/** Diagnostic review threshold for answer cases; it is not a correctness verdict. */
const CASE_THRESHOLD = 0.5;
/** Scores keep the locale-independent `0.50` notation of `formatScore` in every language. */
const SCORE_FORMAT = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

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

function isFiniteScore(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

/* ----------------------------------------------------------------------------------------------
 * Screen-local presentation helpers
 * -------------------------------------------------------------------------------------------- */

/**
 * A diagnostic score. A missing value is "not measured", never a measured 0. `animate` rolls the
 * digits with NumberFlow (pinned to the `0.50` notation used everywhere else); the readable text
 * stays in the DOM for assistive tech, copy and tests.
 */
function Score({ animate = false, className, copy, value }: { animate?: boolean; className?: string; copy: EvaluationCopy; value: number | null | undefined }) {
  // Progressive enhancement: environments that cannot animate (server render, jsdom) get plain text.
  const canRoll = useIsSupported();
  if (!isFiniteScore(value)) return <span className={cn("text-quaternary", className)} title={copy.notMeasured}>—<span className="sr-only"> {copy.notMeasured}</span></span>;
  if (!animate || !canRoll) return <span className={cn("tabular-nums", className)}>{formatScore(value)}</span>;
  // Same box as MetricValue: absorb NumberFlow's 0.5em fade-mask spill so it is not a layout overflow.
  return (
    <span className={cn("-mx-[0.5em] px-[0.5em] tabular-nums", className)} data-overflow-intentional="">
      <span aria-hidden="true"><NumberFlow format={SCORE_FORMAT} locales="en-US" value={value} willChange /></span>
      <span className="sr-only">{formatScore(value)}</span>
    </span>
  );
}

/** Decorative 0–1 meter under a score; neutral ink because a higher diagnostic is not a verdict. */
function Meter({ className, value }: { className?: string; value: number | null | undefined }) {
  const width = isFiniteScore(value) ? Math.min(1, Math.max(0, value)) * 100 : 0;
  return (
    <span aria-hidden="true" className={cn("block h-1 w-full overflow-hidden rounded-full bg-tertiary", className)}>
      <span className="block h-full rounded-full bg-fg-quaternary transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${width}%` }} />
    </span>
  );
}

/** A metric label whose (?) stays glued to the last word when the label wraps. */
function LabelWithInfo({ copy, hint, label }: { copy: EvaluationCopy; hint?: string; label: string }) {
  if (!hint) return <>{label}</>;
  const split = label.lastIndexOf(" ") + 1;
  return (
    <>
      {label.slice(0, split)}
      <span className="whitespace-nowrap">
        {label.slice(split)}
        <InfoTip className="ml-1 inline-grid align-top" label={interpolate(copy.infoLabel, { label })} title={hint} />
      </span>
    </>
  );
}

/** The one "diagnostic, not proof" line per view. */
function DiagnosticNote({ className, copy }: { className?: string; copy: EvaluationCopy }) {
  return (
    <p className={cn("flex items-start gap-2 text-sm text-tertiary", className)} data-testid="evaluation-diagnostic-note">
      <AppIcon className="mt-0.5 size-4 shrink-0 text-fg-quaternary" name="info" />
      {copy.diagnosticNote}
    </p>
  );
}

/** Small A/B marker shared by the compare cards, the settings table and the history rows. */
function RunLetter({ letter, className }: { letter: string; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-grid size-6 shrink-0 place-items-center rounded-md bg-primary-solid text-xs font-semibold text-white", className)}>{letter}</span>;
}

function SourcePicker({ copy, elementTypes, elements, hasParse, inputId, locale, onChange, value }: {
  copy: EvaluationCopy;
  elementTypes: AppCopy["documents"]["elementTypes"];
  elements: PickerElement[];
  /** Without a parse the form's blocker already explains why there is nothing to pick. */
  hasParse: boolean;
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
      <p className="text-sm font-medium text-secondary">{copy.evidence}</p>
      <p className="sr-only" id={`${inputId}-hint`}>{copy.evidenceHint}</p>
      {selectedIds.length ? (
        <ul aria-label={copy.evidence} className="mt-2 flex flex-wrap gap-1.5">
          {selectedIds.map((id) => {
            const item = byId.get(id);
            const label = item ? [pageLabel(item), item.summary].filter(Boolean).join(" · ") : id;
            return (
              <li className="inline-flex h-7 min-w-0 max-w-full items-center gap-1 rounded-md bg-primary pr-1 pl-2.5 text-xs font-medium text-secondary shadow-xs ring-1 ring-primary ring-inset" key={id}>
                <span className={cn("truncate", !item && "font-mono")}>{label}</span>
                <button aria-label={interpolate(copy.removeSource, { label })} className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-fg-quaternary transition-colors hover:bg-primary_hover hover:text-fg-secondary" onClick={() => toggle(id)} type="button"><AppIcon className="size-3" name="close" /></button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {elements.length ? (
        <Button aria-controls={`${inputId}-panel`} aria-describedby={`${inputId}-hint`} aria-expanded={open} className="mt-2" iconLeading="fileSearch" onClick={() => setOpen((current) => !current)} size="sm" type="button" variant="secondary">
          {open ? copy.hideSources : copy.chooseSources}<span className="font-medium text-quaternary tabular-nums">{formatNumber(locale, elements.length)}</span>
        </Button>
      ) : hasParse ? <p className="mt-2 text-sm text-tertiary">{copy.noSources}</p> : null}
      {open ? (
        <div className="mt-2.5 overflow-hidden rounded-lg bg-primary ring-1 ring-secondary" id={`${inputId}-panel`}>
          <div className="flex flex-wrap gap-2 border-b border-secondary bg-secondary p-2">
            <Input aria-label={copy.searchSources} className="min-w-48 flex-1" icon="retrieve" onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} size="sm" type="search" value={query} wrapperClassName="min-w-48 flex-1" />
            {pages.length > 1 ? (
              <Select onValueChange={setPage} value={page}>
                <SelectTrigger aria-label={copy.pageFilter} className="w-auto min-w-32" size="sm"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">{copy.allPages}</SelectItem>{pages.map((number) => <SelectItem key={number} value={String(number)}>{interpolate(copy.pageOption, { page: number })}</SelectItem>)}</SelectContent>
              </Select>
            ) : null}
            {sections.length > 1 ? (
              <Select onValueChange={setSection} value={section}>
                <SelectTrigger aria-label={copy.sectionFilter} className="w-auto max-w-full min-w-40" size="sm"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">{copy.allSections}</SelectItem>{sections.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
              </Select>
            ) : null}
          </div>
          <p aria-live="polite" className="px-3 pt-2.5 pb-1 text-xs font-medium text-quaternary tabular-nums">{interpolate(copy.matchCount, { shown: formatNumber(locale, filtered.length), total: formatNumber(locale, elements.length) })}</p>
          {filtered.length ? (
            // One bounded scroll area; default overscroll lets the page keep scrolling at its ends.
            <ul aria-label={copy.sourceList} className="max-h-72 overflow-y-auto px-1.5 pb-1.5">
              {filtered.map((item) => {
                const selected = selectedIds.includes(item.element.id);
                return (
                  <li key={item.element.id}>
                    <button aria-pressed={selected} className={cn("flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 text-left text-xs transition-colors hover:bg-primary_hover", selected && "bg-active")} onClick={() => toggle(item.element.id)} type="button">
                      <CheckboxBox className="mt-px" isSelected={selected} />
                      <span className="min-w-0 flex-1">
                        {/* Extracted document text is untrusted data: plain text only. */}
                        <span className="line-clamp-2 break-words text-secondary">{item.summary}</span>
                        <span className="mt-0.5 block text-quaternary tabular-nums">{[elementTypes[item.element.type], pageLabel(item), item.section && item.element.type !== "heading" ? item.section : null].filter(Boolean).join(" · ")}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : <p className="px-3 pt-1 pb-3 text-sm text-tertiary">{copy.noMatches}</p>}
        </div>
      ) : null}
      <TechnicalDetails className="mt-3" title={copy.technicalSources}>
        <Input aria-describedby={`${inputId}-hint`} aria-label={copy.technicalSources} className="font-mono text-xs" id={inputId} onChange={(event) => onChange(event.target.value)} placeholder="element-1, element-4" size="sm" value={value} />
      </TechnicalDetails>
    </div>
  );
}

function OutcomeSelect({ copy, onChange, value }: { copy: EvaluationCopy; onChange: (value: EvaluationOutcome) => void; value: EvaluationOutcome }) {
  return (
    <Field label={copy.expectedResult}>
      {(control) => (
        <Select onValueChange={(next) => onChange(next as EvaluationOutcome)} value={value}>
          <SelectTrigger {...control}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="answer">{copy.outcomes.answer}</SelectItem>
            <SelectItem value="insufficient_context">{copy.outcomes.insufficient_context}</SelectItem>
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

type MetricRow = { key: string; label: string; value: number | null | undefined; hint?: string; sampleSize?: number | null };

/** Scorecard grid: label (caveat behind its (?) tooltip), rolling value and 0–1 meter. */
function ScoreGrid({ className, copy, locale, rows, sampleSize, testId }: { className?: string; copy: EvaluationCopy; locale: AppLocale; rows: MetricRow[]; sampleSize: number | null | undefined; testId: string }) {
  return (
    <dl className={cn("grid gap-x-8 gap-y-7", className)} data-testid={testId}>
      {rows.map((row) => (
        // Labels may wrap on phones; values stay on one baseline across the row.
        <div className="flex min-w-0 flex-col" key={row.key}>
          <dt className="flex-1 text-sm font-medium text-tertiary"><LabelWithInfo copy={copy} hint={row.hint} label={row.label} /></dt>
          <dd className="mt-1.5">
            <span className="flex items-baseline gap-2">
              <Score animate className="text-display-xs font-semibold text-primary" copy={copy} value={row.value} />
              {typeof row.sampleSize === "number" && row.sampleSize !== sampleSize ? <span className="text-xs text-quaternary tabular-nums">{interpolate(copy.sampleSize, { count: formatNumber(locale, row.sampleSize) })}</span> : null}
            </span>
            <Meter className="mt-3" value={row.value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function StageRetrievalTable({ copy, locale, metrics }: { copy: EvaluationCopy; locale: AppLocale; metrics: StageRetrievalMetricsByStage }) {
  const stages = (["retrieval", "reranking", "context"] as const).filter((stage) => metrics[stage]);
  if (!stages.length) return null;
  return (
    <Disclosure className="mt-7" contentClassName="pt-3" title={copy.perStage} variant="inline">
      <div>
        <Table aria-label={copy.perStage} containerClassName="rounded-lg">
          <TableHeader><TableRow><TableHead scope="col">{copy.stage}</TableHead><TableHead numeric scope="col">{copy.metrics.hitAtK}</TableHead><TableHead numeric scope="col">{copy.metrics.recallAtK}</TableHead><TableHead numeric scope="col">{copy.metrics.precisionAtK}</TableHead><TableHead numeric scope="col">{copy.metrics.mrr}</TableHead><TableHead numeric scope="col">n</TableHead></TableRow></TableHeader>
          <TableBody>
            {stages.map((stage) => {
              const row = metrics[stage]!;
              return <TableRow key={stage}><TableHead className="text-sm font-medium text-primary" scope="row">{copy.stageNames[stage]}</TableHead><TableCell numeric><Score copy={copy} value={row.hitAtK} /></TableCell><TableCell numeric><Score copy={copy} value={row.recallAtK} /></TableCell><TableCell numeric><Score copy={copy} value={row.precisionAtK} /></TableCell><TableCell numeric><Score copy={copy} value={row.mrr} /></TableCell><TableCell className="text-tertiary" numeric>{formatNumber(locale, row.eligibleCaseCount)}</TableCell></TableRow>;
            })}
          </TableBody>
        </Table>
      </div>
    </Disclosure>
  );
}

type CaseState = "ok" | "review" | "notMeasured";

/** Case triage on the shared status language: neutral when fine, amber to review, idle when unmeasured. */
const CASE_STATUS: Record<CaseState, { status: Status; icon: "completed" | "warningTriangle" | "circle"; color?: ChartColor }> = {
  ok: { status: "completed", icon: "completed", color: "gray" },
  review: { status: "warning", icon: "warningTriangle", color: "warning" },
  notMeasured: { status: "idle", icon: "circle" },
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
  if (!comparable) return <span className="text-sm text-quaternary" title={copy.notComparable}>—<span className="sr-only"> {copy.notComparable}</span></span>;
  if (typeof first !== "number" || typeof second !== "number") return <span className="text-sm text-quaternary" title={copy.notMeasured}>—<span className="sr-only"> {copy.notMeasured}</span></span>;
  const delta = second - first;
  if (Math.abs(delta) < 0.005) return <span className="text-sm text-quaternary tabular-nums">0.00<span className="sr-only"> {copy.unchanged}</span></span>;
  // Neutral on purpose: the arrow gives the direction, colour must not read as better/worse.
  return (
    <span className="inline-flex h-6 items-center gap-0.5 rounded-md bg-tertiary px-1.5 text-xs font-semibold text-secondary tabular-nums">
      <AppIcon aria-hidden="true" className="size-3 text-fg-tertiary" name={delta > 0 ? "trendUp" : "trendDown"} strokeWidth={2.25} />
      {delta > 0 ? "+" : "−"}{formatScore(Math.abs(delta))}
      <span className="sr-only"> {delta > 0 ? copy.higher : copy.lower}</span>
    </span>
  );
}

type ComparisonMetric = { key: string; label: string; first: number | null | undefined; second: number | null | undefined; comparable: boolean; hint?: string };

function ComparisonMetricTable({ copy, groups }: { copy: EvaluationCopy; groups: Array<{ key: string; label: string; metrics: ComparisonMetric[] }> }) {
  return (
    <TableCard>
      <Table aria-label={copy.metricComparison} data-testid="evaluation-compare-metrics">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{copy.metric}</TableHead>
            <TableHead className="w-14 px-2 sm:w-20 sm:px-4" numeric scope="col">{copy.runA}</TableHead>
            <TableHead className="w-14 px-2 sm:w-20 sm:px-4" numeric scope="col">{copy.runB}</TableHead>
            <TableHead className="w-22 sm:w-28" numeric scope="col"><abbr className="no-underline" title={copy.deltaNote}>{copy.delta}</abbr></TableHead>
          </TableRow>
        </TableHeader>
        {groups.map((group) => (
          <TableBody key={group.key}>
            <tr className="border-b border-secondary"><th className="px-4 pt-5 pb-2 text-left text-xs font-semibold text-tertiary" colSpan={4} scope="rowgroup">{group.label}</th></tr>
            {group.metrics.map((item) => (
              <TableRow key={item.key}>
                <TableHead className="h-auto py-3 text-sm font-medium whitespace-normal text-primary" scope="row"><LabelWithInfo copy={copy} hint={item.hint} label={item.label} /></TableHead>
                <TableCell className="px-2 text-tertiary sm:px-4" numeric><Score copy={copy} value={item.first} /></TableCell>
                <TableCell className="px-2 font-medium text-primary sm:px-4" numeric><Score copy={copy} value={item.second} /></TableCell>
                <TableCell numeric><DeltaValue comparable={item.comparable} copy={copy} first={item.first} second={item.second} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        ))}
      </Table>
    </TableCard>
  );
}

/**
 * Underline tabs on the Tabs look (brand indicator slides via useSlidingIndicator). Kept on native
 * buttons because the panels are labelled by stable ids (`evaluation-tab-*`) that React Aria's
 * generated ids cannot provide.
 */
function EvaluationTabList({ activeTab, copy, onKeyDown, onSelect, tabRefs }: {
  activeTab: EvaluationTab;
  copy: EvaluationCopy;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onSelect: (tab: EvaluationTab) => void;
  tabRefs: { current: Partial<Record<EvaluationTab, HTMLButtonElement | null>> };
}) {
  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLDivElement>('[role="tab"][aria-selected="true"]', "underline");
  return (
    <div className="relative mt-8 before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-border-secondary" ref={containerRef}>
      <span aria-hidden="true" className="pointer-events-none absolute top-0 left-0 rounded-full bg-fg-brand-primary opacity-0 transition-[translate,width,opacity] duration-(--tabs-dur) ease-(--tabs-ease)" ref={indicatorRef} />
      <div aria-label={copy.tabsLabel} className="relative flex gap-5" data-testid="evaluation-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            aria-controls={activeTab === tab ? `evaluation-panel-${tab}` : undefined}
            aria-selected={activeTab === tab}
            className="relative z-10 flex cursor-pointer items-center rounded-sm pt-0.5 pb-3 text-sm font-semibold whitespace-nowrap text-quaternary outline-none transition-colors duration-150 ease-out select-none hover:text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring aria-selected:text-brand-secondary"
            data-testid={`evaluation-tab-${tab}`}
            id={`evaluation-tab-${tab}`}
            key={tab}
            onClick={() => onSelect(tab)}
            onKeyDown={onKeyDown}
            ref={(element) => { tabRefs.current[tab] = element; }}
            role="tab"
            tabIndex={activeTab === tab ? 0 : -1}
            type="button"
          >
            {copy.tabs[tab]}
          </button>
        ))}
      </div>
    </div>
  );
}

function LegendSwatch({ color }: { color?: ChartColor }) {
  return <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-xs", color ? chartColors[color].solid : "bg-quaternary")} />;
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
  /** Open question row; `null` once the reader collapses it. */
  const [selectedCaseIndex, setSelectedCaseIndex] = useState<number | null>(0);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [pendingCreateFrom, setPendingCreateFrom] = useState<string[] | null>(null);
  const [createdDataset, setCreatedDataset] = useState<{ id: string; name: string; description: string } | null>(null);
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
      setCreatedDataset({ id: created.id, name: created.name, description: `${interpolate(copy.datasetVersion, { version: created.version })} · ${formatCount(locale, created.caseCount, units.question)}` });
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
  const processing = evaluationStatus === "processing";
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

  // Transient confirmations: a saved dataset, and a tracked run that finished or stopped.
  const announcedDataset = useRef<string | null>(null);
  const datasetSavedMessage = createdDataset ? interpolate(copy.datasetSaved, { name: createdDataset.name }) : null;
  useEffect(() => {
    if (!createdDataset || !datasetSavedMessage || announcedDataset.current === createdDataset.id) return;
    announcedDataset.current = createdDataset.id;
    toast.success(datasetSavedMessage, { description: createdDataset.description });
  }, [createdDataset, datasetSavedMessage]);

  const trackedRun = useRef<{ id: string; status: string } | null>(null);
  const runId = evaluationRun?.id ?? null;
  const runStatus = evaluationRun?.status ?? null;
  const runLabel = evaluationRun ? evaluationName(evaluationRun) : "";
  const runFinishedMessage = interpolate(copy.runFinished, { name: runLabel });
  const runStoppedMessage = interpolate(copy.runStopped, { name: runLabel });
  const runFinishedDescription = evaluationRun ? formatCount(locale, evaluationRun.results.caseCount ?? completedCases, units.question) : "";
  useEffect(() => {
    if (!runId || !runStatus) return;
    const previous = trackedRun.current;
    trackedRun.current = { id: runId, status: runStatus };
    if (previous?.id !== runId || (previous.status !== "running" && previous.status !== "queued")) return;
    if (runStatus === "completed") toast(runFinishedMessage, { description: runFinishedDescription, icon: <AppIcon className="size-5 text-fg-tertiary" name="evaluate" /> });
    else if (runStatus === "failed") toast.error(runStoppedMessage);
  }, [runId, runStatus, runFinishedMessage, runStoppedMessage, runFinishedDescription]);

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

  /** One question block of the dataset form; the first question keeps its historical ids. */
  function caseFields(args: {
    legend: string;
    ids: { question: string; elements: string; reference: string };
    value: DraftEvaluationCase;
    onChange: (patch: Partial<DraftEvaluationCase>) => void;
    actions?: ReactNode;
    key: string;
  }) {
    return (
      <fieldset className="min-w-0 border-t border-secondary px-5 pt-5 pb-6 sm:px-6" key={args.key}>
        <legend className="float-left flex h-8 items-center text-sm font-semibold text-primary">{args.legend}</legend>
        {args.actions ? <div className="float-right -mr-2 flex items-center gap-0.5">{args.actions}</div> : null}
        <div className="clear-both grid gap-x-4 gap-y-5 pt-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
          <Field label={copy.question}><Input id={args.ids.question} onChange={(event) => args.onChange({ question: event.target.value })} value={args.value.question} /></Field>
          <OutcomeSelect copy={copy} onChange={(next) => args.onChange({ expectedOutcome: next })} value={args.value.expectedOutcome} />
          {args.value.expectedOutcome === "answer"
            ? <SourcePicker copy={copy} elementTypes={allCopy.documents.elementTypes} elements={parseElements} hasParse={Boolean(parseResult)} inputId={args.ids.elements} locale={locale} onChange={(next) => args.onChange({ elements: next })} value={args.value.elements} />
            : <p className="text-sm text-tertiary sm:col-span-2">{copy.noEvidenceNeeded}</p>}
          <Field className="sm:col-span-2" label={copy.reference}><Input id={args.ids.reference} onChange={(event) => args.onChange({ reference: event.target.value })} value={args.value.reference} /></Field>
        </div>
      </fieldset>
    );
  }

  function caseAction(label: string, icon: "copy" | "trendUp" | "trendDown" | "trash", onPress: () => void, disabled = false) {
    return (
      <Tooltip title={label}>
        <Button aria-label={label} disabled={disabled} iconLeading={icon} onClick={onPress} size="icon-sm" type="button" variant="tertiary" />
      </Tooltip>
    );
  }

  /** "Expected sources · 2" opens those elements in the source inspector; no ids, no button. */
  function sourceButton(label: string, ids: string[]) {
    const text = `${label} · ${ids.length ? formatNumber(locale, ids.length) : "—"}`;
    if (!ids.length) return <span className="text-sm text-tertiary tabular-nums">{text}</span>;
    return <SourceInspector documentId={activeDocument?.id ?? null} parseResult={parseResult} sourceElementIds={ids} triggerAriaLabel={interpolate(retrievalCopy.inspectSource, { label: text })} triggerLabel={text} />;
  }

  const runFailed = evaluationRun?.status === "failed";
  const runInFlight = evaluationRun?.status === "queued" || evaluationRun?.status === "running";

  return (
    <div className="min-w-0 bg-canvas" data-testid="evaluation-screen">
      <div className="mx-auto w-full max-w-7xl p-10 max-md:p-4">
        <PageHeader data-testid="evaluation-page-header" description={copy.description} title={copy.title} />

        <section aria-label={copy.contextLabel} className="mt-5" data-testid="evaluation-workspace-context">
          <div className="flex flex-col gap-1.5 text-sm md:flex-row md:items-center md:gap-3">
            <p className="flex min-w-0 items-center gap-2">
              <AppIcon className="size-4 shrink-0 text-fg-quaternary" name="database" />
              <span className="min-w-0 truncate">
                {selectedDataset ? <span className="font-medium text-secondary">{selectedDataset.name}</span> : <span className="text-tertiary">{copy.noDataset}</span>}
                {selectedDataset ? <span className="text-tertiary tabular-nums"> {interpolate(copy.datasetVersion, { version: selectedDataset.version })} · {formatCount(locale, selectedDataset.caseCount, units.question)}</span> : null}
              </span>
            </p>
            <span aria-hidden="true" className="hidden h-4 w-px bg-border-secondary md:block" />
            <p className="flex min-w-0 items-center gap-2 text-tertiary">
              <AppIcon className="size-4 shrink-0 text-fg-quaternary" name="settings" />
              <span className="min-w-0 break-words" data-testid="evaluation-config-summary">{activeConfigSummary}</span>
            </p>
          </div>
        </section>

        <EvaluationTabList activeTab={activeTab} copy={copy} onKeyDown={handleTabKeyDown} onSelect={selectTab} tabRefs={tabRefs} />

        {activeTab === "dataset" ? (
          <TransitionPanel aria-labelledby="evaluation-tab-dataset" as="section" className="mt-6" data-testid="evaluation-panel-dataset" id="evaluation-panel-dataset" role="tabpanel" transitionKey={activeTab}>
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <Panel padding="none">
                <div className="px-5 pt-5 pb-6 sm:px-6 sm:pt-6">
                  <PanelHeader title={copy.newDataset} />
                  <Field className="mt-5 max-w-md" label={copy.name}>
                    <Input id="dataset-name" onChange={(event) => { editForm(); setDatasetName(event.target.value); }} value={datasetName} />
                  </Field>
                </div>
                {caseFields({
                  key: "case-first",
                  legend: interpolate(copy.questionNumber, { number: 1 }),
                  ids: { question: "golden-question", elements: "relevant-elements", reference: "reference-answer" },
                  value: { question, elements: elementIds, reference: referenceAnswer, expectedOutcome },
                  onChange: (patch) => {
                    editForm();
                    if (patch.question !== undefined) setQuestion(patch.question);
                    if (patch.elements !== undefined) setElementIds(patch.elements);
                    if (patch.reference !== undefined) setReferenceAnswer(patch.reference);
                    if (patch.expectedOutcome !== undefined) setExpectedOutcome(patch.expectedOutcome);
                  },
                })}
                {additionalCases.map((item, index) => caseFields({
                  key: `case-${index}`,
                  legend: interpolate(copy.questionNumber, { number: index + 2 }),
                  ids: { question: `case-question-${index}`, elements: `case-elements-${index}`, reference: `case-reference-${index}` },
                  value: item,
                  onChange: (patch) => updateCase(index, patch),
                  actions: (
                    <>
                      {caseAction(copy.duplicate, "copy", () => { editForm(); setAdditionalCases((current) => [...current.slice(0, index + 1), { ...item }, ...current.slice(index + 1)]); })}
                      {caseAction(copy.moveUp, "trendUp", () => setAdditionalCases((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; }), index === 0)}
                      {caseAction(copy.moveDown, "trendDown", () => setAdditionalCases((current) => { const next = [...current]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; }), index === additionalCases.length - 1)}
                      {caseAction(copy.removeCase, "trash", () => setAdditionalCases((current) => current.filter((_, entryIndex) => entryIndex !== index)))}
                    </>
                  ),
                }))}
                <div className="border-t border-secondary px-5 py-4 sm:px-6">
                  <Button iconLeading="plus" onClick={() => { editForm(); setAdditionalCases((current) => [...current, { question: "", elements: "", reference: "", expectedOutcome: "answer" }]); }} size="sm" type="button" variant="secondary">{copy.addCase}</Button>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-b-xl border-t border-secondary bg-secondary px-5 py-4 sm:px-6">
                  <Button aria-busy={processing} aria-describedby={showDatasetBlocker ? "dataset-disabled-reason" : showFormError ? "dataset-form-error" : undefined} disabled={!datasetAvailability.allowed} iconLeading="database" onClick={handleCreateDataset}>{copy.create}</Button>
                  {showDatasetBlocker ? <StageBlocker blocker={datasetAvailability} id="dataset-disabled-reason" /> : showFormError ? <p className={cn("text-sm", submitAttempted ? "text-error-primary" : "text-tertiary")} id="dataset-form-error" role="status">{formError}</p> : null}
                </div>
              </Panel>
              <aside aria-labelledby="evaluation-datasets-title" className="min-w-0 lg:sticky lg:top-6">
                <div className="flex items-baseline justify-between gap-2 px-1">
                  <h3 className="text-sm font-semibold text-primary" id="evaluation-datasets-title">{copy.datasets}</h3>
                  {evaluationDatasets.length ? <span className="text-xs font-medium text-quaternary tabular-nums">{formatNumber(locale, evaluationDatasets.length)}</span> : null}
                </div>
                {evaluationDatasets.length ? (
                  <ul className="mt-3 space-y-1">
                    {evaluationDatasets.map((dataset) => {
                      const selected = dataset.id === selectedDatasetId;
                      return (
                        <li key={dataset.id}>
                          <button aria-pressed={selected} className={cn("flex w-full cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-[background-color,box-shadow] duration-150", selected ? "bg-primary shadow-xs ring-1 ring-secondary" : "hover:bg-primary_hover")} onClick={() => { setDatasetId(dataset.id); setBaseDatasetId(dataset.id); }} type="button">
                            <AppIcon className={cn("mt-0.5 size-4 shrink-0", selected ? "text-fg-brand-primary" : "text-fg-quaternary")} name="database" />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span className="min-w-0 truncate text-sm font-medium text-primary">{dataset.name}</span>
                                <Badge className="shrink-0" size="sm">{interpolate(copy.datasetVersion, { version: dataset.version })}</Badge>
                              </span>
                              <span className="mt-0.5 block text-xs text-tertiary tabular-nums">{formatCount(locale, dataset.caseCount, units.question)}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="mt-3 px-1 text-sm text-tertiary">{copy.noDatasets}</p>}
              </aside>
            </div>
            {evaluationError && activeTab === "dataset" ? <Notice className="mt-4" tone="error">{evaluationError.message}</Notice> : null}
          </TransitionPanel>
        ) : null}

        {activeTab === "results" ? (
          <TransitionPanel aria-labelledby="evaluation-tab-results" as="section" className="mt-6" data-testid="evaluation-panel-results" id="evaluation-panel-results" role="tabpanel" transitionKey={activeTab}>
            <Panel padding="none">
              <div className="flex flex-wrap items-end gap-x-6 gap-y-4 px-5 pt-5 pb-4 sm:px-6">
                <Field className="w-full sm:w-64" label={copy.selectDataset}>
                  {(control) => (
                    <Select onValueChange={(value) => { setDatasetId(value); setBaseDatasetId(value); }} value={selectedDatasetId}>
                      <SelectTrigger {...control}><SelectValue placeholder={copy.noDataset} /></SelectTrigger>
                      <SelectContent>{evaluationDatasets.map((dataset) => <SelectItem key={dataset.id} value={dataset.id}>{dataset.name} · {interpolate(copy.datasetVersion, { version: dataset.version })}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </Field>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-secondary" id="evaluation-mode-label">{retrievalCopy.retrieval}</span>
                  <SegmentedControl aria-labelledby="evaluation-mode-label" onChange={setMode} options={RETRIEVAL_MODES.map((value) => ({ value, label: retrievalCopy.modes[value] }))} value={mode} />
                </div>
                <Field className="w-24" label={retrievalCopy.topK}>
                  {(control) => (
                    <Select onValueChange={setTopK} value={topK}>
                      <SelectTrigger {...control} className="tabular-nums"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="3">3</SelectItem><SelectItem value="5">5</SelectItem><SelectItem value="10">10</SelectItem></SelectContent>
                    </Select>
                  )}
                </Field>
                <div className="flex flex-col gap-1.5">
                  <span aria-hidden="true" className="text-sm font-medium text-secondary">{retrievalCopy.reranker}</span>
                  <label className="flex h-9 cursor-pointer items-center gap-2 text-sm text-tertiary" data-testid="evaluation-reranker-control" htmlFor="evaluation-reranker">
                    <Switch aria-label={retrievalCopy.reranker} checked={reranker} id="evaluation-reranker" onCheckedChange={setReranker} />
                    <span className="min-w-7">{reranker ? retrievalCopy.on : retrievalCopy.off}</span>
                  </label>
                </div>
                <Button aria-busy={processing} aria-describedby={!canRun ? "evaluation-disabled-reason" : undefined} className="max-sm:w-full sm:ml-auto" disabled={!canRun} iconLeading={processing ? <Spinner size="xs" tone="current" /> : "play"} onClick={handleRun} size="lg">{copy.run}</Button>
              </div>
              <div className="border-t border-secondary px-5 py-3 sm:px-6">
                <Disclosure contentClassName="pt-3 pb-1" title={copy.advanced} variant="inline">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Switch aria-describedby={capabilities?.judgeModel ? "evaluation-judge-model" : undefined} checked={judge} id="evaluation-judge" onCheckedChange={setJudge} />
                    <label className="text-sm font-medium text-secondary" htmlFor="evaluation-judge">{copy.judge}</label>
                    {capabilities?.judgeModel ? <span className="text-sm text-quaternary wrap-anywhere" id="evaluation-judge-model">{capabilities.judgeModel}</span> : null}
                  </div>
                </Disclosure>
              </div>
              {!canRun ? <span className="sr-only" id="evaluation-disabled-reason">{runAvailability.message}</span> : null}
            </Panel>
            <StageBlocker blocker={showRunBlocker ? runAvailability : null} className="mt-3 px-1" data-testid="evaluation-blocker" />
            {evaluationError ? <Notice className="mt-4" tone="error">{evaluationError.code === "run_poll_timeout" ? copy.trackingPaused : evaluationError.message}</Notice> : null}
            {runInFlight && !processing ? <Button className="mt-3" iconLeading="refresh" onClick={() => void resumeRunTracking("evaluation")} size="sm" variant="secondary">{copy.resumeTracking}</Button> : null}

            {evaluationRun ? (() => {
              const results = evaluationRun.results;
              const judgeUsed = usedJudge(evaluationRun);
              const generationMetrics = results.generationMetrics;
              const caseCount = results.caseCount ?? completedCases;
              const caseResults = evaluationRun.caseResults ?? [];
              const failedCases = caseResults.filter((item) => item.status === "failed");
              const measuredCases = caseResults.filter((item) => item.status !== "failed");
              const activeCase = selectedCaseIndex === null ? -1 : measuredCases[selectedCaseIndex] ? selectedCaseIndex : 0;
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
              const answerSampleSize = results.completedCaseCount ?? caseCount;
              // Which ranking the headline retrieval scores come from, then their sample size.
              const retrievalMeta = [
                results.stageRetrievalMetrics ? copy.retrievalStageNote : null,
                typeof results.retrievalEligibleCaseCount === "number" ? interpolate(copy.sampleSize, { count: formatCount(locale, results.retrievalEligibleCaseCount, units.question) }) : null,
              ].filter((item): item is string => Boolean(item));
              // In-flight runs show the questions still to come as empty blocks.
              const pendingCount = runInFlight && evaluationRun.datasetId === selectedDatasetId ? Math.max(0, totalCases - caseResults.length) : 0;
              const diagnoses = caseResults.map((item) => item.status === "failed" ? null : caseDiagnosis(item, judgeUsed, copy));
              const legend = [
                { key: "ok", color: CASE_STATUS.ok.color, count: diagnoses.filter((item) => item?.state === "ok").length, label: copy.caseLegend.ok },
                { key: "review", color: CASE_STATUS.review.color, count: diagnoses.filter((item) => item?.state === "review").length, label: copy.caseLegend.review },
                { key: "notMeasured", color: undefined, count: diagnoses.filter((item) => item?.state === "notMeasured").length, label: copy.caseLegend.notMeasured },
                { key: "failed", color: "error" as const, count: failedCases.length, label: copy.caseLegend.failed },
                { key: "pending", color: undefined, count: pendingCount, label: copy.caseLegend.pending },
              ].filter((item) => item.count > 0);
              const trackerData: TrackerBlock[] = [
                ...caseResults.map((item, index) => {
                  const diagnosis = diagnoses[index];
                  const state = diagnosis ? copy.caseLegend[diagnosis.state] : copy.caseLegend.failed;
                  return { key: `case-${index}`, color: diagnosis ? CASE_STATUS[diagnosis.state].color : "error" as const, tooltip: `${index + 1}. ${truncate(item.question, 70)} — ${state}` };
                }),
                ...Array.from({ length: pendingCount }, (_, index) => ({ key: `pending-${index}`, tooltip: `${caseResults.length + index + 1}. ${copy.caseLegend.pending}` })),
              ];
              const runStatusBadge = runInFlight ? <StatusBadge appearance="pill" status="processing">{allCopy.runs.running}</StatusBadge>
                : runFailed ? <StatusBadge appearance="pill" status="error">{allCopy.runs.failed}</StatusBadge> : null;
              return (
                <>
                  <header className="mt-10 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <h2 className="text-lg font-semibold text-primary">{evaluationName(evaluationRun)}</h2>
                        {runStatusBadge}
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-tertiary tabular-nums" data-testid="evaluation-run-summary">
                        {runDate(evaluationRun, locale) ? <span>{runDate(evaluationRun, locale)} ·</span> : null}
                        <span>{interpolate(copy.sampleSize, { count: formatCount(locale, caseCount, units.question) })}</span>
                        {results.failedCaseCount ? <span className="font-medium text-error-primary">· {interpolate(copy.failedSummary, { count: formatNumber(locale, results.failedCaseCount) })}</span> : null}
                      </p>
                      {/* The settings that produced these numbers; the form above may already differ. */}
                      <p className="mt-0.5 text-sm text-quaternary">{configSummary(evaluationConfig(evaluationRun))}</p>
                    </div>
                  </header>
                  {processing && totalCases > 0 ? (
                    <div className="mt-4" role="status">
                      <ProgressBar label={copy.progress} max={totalCases} showLabel showValue size="md" value={completedCases} valueFormatter={(value) => `${formatNumber(locale, value)}/${formatNumber(locale, totalCases)}`} />
                    </div>
                  ) : null}

                  <NumberFlowGroup>
                    <Panel className="mt-5" padding="none">
                      <Section actions={retrievalMeta.length ? <span className="text-sm text-quaternary tabular-nums">{retrievalMeta.join(" · ")}</span> : null} className="p-5 sm:p-6" title={copy.retrievalQuality}>
                        <ScoreGrid className="mt-5 grid-cols-2 lg:grid-cols-4" copy={copy} locale={locale} rows={[
                          { key: "hitAtK", label: copy.metrics.hitAtK, value: results.hitAtK },
                          { key: "recallAtK", label: copy.metrics.recallAtK, value: results.recallAtK },
                          { key: "precisionAtK", label: copy.metrics.precisionAtK, value: results.precisionAtK },
                          { key: "mrr", label: copy.metrics.mrr, value: results.mrr },
                        ]} sampleSize={results.retrievalEligibleCaseCount} testId="evaluation-retrieval-metrics" />
                        {results.stageRetrievalMetrics ? <StageRetrievalTable copy={copy} locale={locale} metrics={results.stageRetrievalMetrics} /> : null}
                      </Section>
                      <Separator />
                      <Section actions={<span className="text-sm text-quaternary tabular-nums">{interpolate(copy.sampleSize, { count: formatCount(locale, answerSampleSize, units.question) })}</span>} className="p-5 sm:p-6" title={copy.answerQuality}>
                        <ScoreGrid className="mt-5 grid-cols-2 lg:grid-cols-4" copy={copy} locale={locale} rows={answerRows} sampleSize={answerSampleSize} testId="evaluation-answer-metrics" />
                      </Section>
                      <DiagnosticNote className="border-t border-secondary px-5 py-3.5 sm:px-6" copy={copy} />
                    </Panel>
                  </NumberFlowGroup>

                  {caseResults.length || pendingCount ? (
                    <section aria-labelledby="evaluation-cases-title" className="mt-10">
                      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                        <h3 className="text-md font-semibold text-primary" id="evaluation-cases-title">{copy.cases}</h3>
                        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-tertiary">
                          {legend.map((item) => <li className="inline-flex items-center gap-1.5" key={item.key}><LegendSwatch color={item.color} /><span className="font-medium text-primary tabular-nums">{formatNumber(locale, item.count)}</span>{item.label}</li>)}
                        </ul>
                      </div>
                      {measuredCases.length ? <p className="mt-1 max-w-3xl text-sm text-tertiary" data-testid="evaluation-case-threshold">{interpolate(copy.threshold, { grounding: groundingLabel })}</p> : null}
                      <Tracker aria-label={copy.caseOutcomes} className="mt-4 h-6" data={trackerData} />

                      {measuredCases.length ? (
                        <Panel className="mt-5 overflow-hidden" padding="none">
                          {measuredCases.map((item, index) => {
                            const noAnswerCase = item.expectedOutcome === "insufficient_context";
                            const diagnosis = caseDiagnosis(item, judgeUsed, copy);
                            const status = CASE_STATUS[diagnosis.state];
                            return (
                              <Disclosure
                                contentClassName="grid gap-y-4 px-5 pt-1 pb-5 sm:pl-14"
                                data-state={diagnosis.state}
                                data-testid="evaluation-case"
                                key={`${item.experimentId || item.question}-${index}`}
                                onToggle={(event) => {
                                  const open = event.currentTarget.open;
                                  if (open) setSelectedCaseIndex(index);
                                  else if (activeCase === index) setSelectedCaseIndex(null);
                                }}
                                open={activeCase === index}
                                summaryClassName="min-h-13 gap-3 px-5 py-3 font-medium hover:bg-primary_hover"
                                title={(
                                  <span className="flex min-w-0 items-start gap-3 sm:items-center">
                                    <StatusBadge appearance="icon" className="mt-0.5 sm:mt-0" icon={status.icon} status={status.status}>{copy.caseLegend[diagnosis.state]}</StatusBadge>
                                    {/* The diagnosis sits beside the question on wide screens and under it on phones. */}
                                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
                                      <span className="min-w-0 flex-1 sm:truncate">{item.question}</span>
                                      <span className="shrink-0 text-xs font-medium text-quaternary tabular-nums">{diagnosis.meta}</span>
                                    </span>
                                  </span>
                                )}
                                variant="plain"
                              >
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                                  {noAnswerCase ? <span className="text-sm text-tertiary">{copy.noAnswerExpected}</span> : sourceButton(copy.expectedSources, item.expectedElementIds)}
                                  {sourceButton(copy.retrievedSources, item.retrievedElementIds)}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-tertiary">{copy.generatedAnswer}</p>
                                  {/* Generated text is shown as plain text; it is model output, not a verdict. */}
                                  <p className="mt-2 border-l-2 border-secondary pl-3.5 text-sm break-words text-secondary">{item.answer || (item.insufficientContext ? copy.abstained : copy.noGeneration)}</p>
                                </div>
                              </Disclosure>
                            );
                          })}
                        </Panel>
                      ) : null}

                      {failedCases.length ? (
                        <section aria-labelledby="evaluation-failed-title" className="mt-8" data-testid="evaluation-failed-cases">
                          <h4 className="text-sm font-semibold text-primary" id="evaluation-failed-title">{copy.failedCases}</h4>
                          <Panel className="mt-3" padding="none">
                            <ul className="divide-y divide-secondary">
                              {failedCases.map((item, index) => (
                                <li className="flex items-start gap-3 px-5 py-4" key={`${item.question}-${index}`}>
                                  <StatusBadge appearance="icon" className="mt-0.5" status="error">{copy.caseLegend.failed}</StatusBadge>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
                                      <p className="min-w-0 text-sm font-medium text-primary">{item.question}</p>
                                      <span className="inline-flex items-center text-xs"><span className="sr-only">{copy.errorCode}: </span><code className="rounded-sm bg-error-primary px-1.5 py-0.5 font-mono text-xs text-error-primary">{item.errorCode ?? "—"}</code></span>
                                    </div>
                                    {item.errorMessage ? <p className="mt-1 text-sm break-words text-tertiary">{item.errorMessage}</p> : null}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </Panel>
                        </section>
                      ) : null}
                    </section>
                  ) : null}

                  {/* The run's settings are in its header above; this keeps lineage, judge and method. */}
                  <Disclosure className="mt-10" contentClassName="grid gap-x-8 gap-y-5 px-5 py-4 sm:grid-cols-3" data-testid="evaluation-run-details" title={copy.details}>
                    <div className="min-w-0"><p className="text-sm text-tertiary">{copy.provenance}</p><p className="mt-1 text-sm text-primary wrap-anywhere">{activeDocument?.fileName ?? "—"} · {activePipeline?.name ?? "—"}</p></div>
                    <div className="min-w-0"><p className="text-sm text-tertiary">{copy.judge}</p><p className="mt-1 text-sm text-primary wrap-anywhere">{results.judgeModel ?? (judgeUsed ? capabilities?.judgeModel : null) ?? "—"}</p></div>
                    <div className="min-w-0"><p className="text-sm text-tertiary">{copy.metricMethod}</p><p className="mt-1 text-sm text-primary">{methodLabel(generationMetrics?.method)}</p></div>
                    <TechnicalDetails className="self-start sm:col-span-3" title={copy.identifiers}><p className="font-mono text-xs break-all text-tertiary">Run: {evaluationRun.id}</p><p className="mt-1 font-mono text-xs break-all text-tertiary">Dataset: {evaluationRun.datasetId}</p>{generationMetrics?.metricVersion ? <p className="mt-1 font-mono text-xs break-all text-tertiary">Metric: {generationMetrics.metricVersion}</p> : null}</TechnicalDetails>
                  </Disclosure>
                </>
              );
            })() : processing ? (
              totalCases > 0 ? (
                <div className="mt-8" role="status">
                  <ProgressBar label={copy.progress} max={totalCases} showLabel showValue size="md" value={completedCases} valueFormatter={(value) => `${formatNumber(locale, value)}/${formatNumber(locale, totalCases)}`} />
                </div>
              ) : null
            ) : (
              <Panel className="mt-6">
                <EmptyState
                  action={!selectedDataset ? <Button iconLeading="plus" onClick={() => selectTab("dataset")} variant={datasetAvailability.allowed ? "primary" : "secondary"}>{copy.goToDataset}</Button> : null}
                  description={selectedDataset ? interpolate(copy.noRunsDescription, { dataset: selectedDataset.name }) : copy.noDatasetDescription}
                  icon="evaluate"
                  title={copy.noDataTitle}
                  titleAs="h2"
                />
              </Panel>
            )}
          </TransitionPanel>
        ) : null}

        {activeTab === "compare" ? (
          <TransitionPanel aria-labelledby="evaluation-tab-compare" as="section" className="mt-6" data-testid="evaluation-panel-compare" id="evaluation-panel-compare" role="tabpanel" transitionKey={activeTab}>
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
                  <Panel padding="none">
                    <div className="grid divide-y divide-secondary sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                      {selectedRuns.map((run, index) => {
                        const letter = index === 0 ? copy.runA : copy.runB;
                        return (
                          <article className="flex min-w-0 items-start gap-3.5 p-5 sm:p-6" data-testid={`evaluation-compare-run-${index === 0 ? "a" : "b"}`} key={run.id}>
                            <RunLetter className="mt-0.5" letter={letter} />
                            <div className="min-w-0">
                              <h2 className="truncate text-md font-semibold text-primary"><span className="sr-only">{letter}: </span>{evaluationName(run)}</h2>
                              <p className="mt-0.5 text-sm text-tertiary tabular-nums">{[runDate(run, locale) ?? "—", formatMs(locale, run.timing.durationMs), formatCount(locale, run.results.caseCount ?? 0, units.question)].join(" · ")}</p>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                    <section aria-labelledby="evaluation-compatibility-title" className="border-t border-secondary" data-testid="evaluation-compare-context">
                      <div className="px-5 pt-5 sm:px-6">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h2 className="text-sm font-semibold text-primary" id="evaluation-compatibility-title">{copy.compatibility}</h2>
                          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-secondary" htmlFor="evaluation-only-changed">{copy.onlyChanged}<Switch checked={onlyChanged} className="-my-2.5" id="evaluation-only-changed" onCheckedChange={setOnlyChanged} /></label>
                        </div>
                        <ul className="mt-3 flex flex-wrap gap-2" data-testid="evaluation-compare-checks">
                          {comparisonChecks.map((item) => (
                            <li key={item.key}>
                              <StatusBadge appearance="pill" status={item.state === "same" ? "success" : item.state === "different" ? "warning" : "idle"}>
                                {copy.contextChecks[item.key]}
                                {item.state === "same" ? <span className="sr-only"> {copy.same}</span> : <span className="font-normal"> · {item.state === "different" ? copy.different : copy.unknown}</span>}
                              </StatusBadge>
                            </li>
                          ))}
                          <li><StatusBadge appearance="pill" status={settingsDiffer ? "warning" : "completed"}>{settingsDiffer ? copy.settingsDifferent : copy.settingsSame}</StatusBadge></li>
                        </ul>
                        <h3 className="mt-6 text-sm font-semibold text-primary">{copy.changedSettings}</h3>
                      </div>
                      {visibleComparisonSettings.length ? (
                        <Table aria-label={copy.changedSettings} className="mt-3" containerClassName="rounded-b-xl">
                          <TableHeader>
                            <TableRow>
                              <TableHead className="pl-5 sm:pl-6" scope="col">{copy.setting}</TableHead>
                              <TableHead scope="col">{copy.runA}</TableHead>
                              <TableHead className="pr-5 sm:pr-6" scope="col">{copy.runB}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {visibleComparisonSettings.map((item) => {
                              const changed = item.first !== null && item.second !== null && item.first !== item.second;
                              return (
                                <TableRow data-changed={changed || undefined} key={item.key}>
                                  <TableHead className={cn("h-auto py-3 pl-5 text-sm font-medium sm:pl-6", changed ? "text-primary" : "text-tertiary")} scope="row">{copy.settings[item.key]}</TableHead>
                                  <TableCell className={cn("whitespace-normal", changed ? "text-tertiary" : "text-quaternary")}>{settingValue(item.key, item.first)}</TableCell>
                                  <TableCell className={cn("pr-5 whitespace-normal sm:pr-6", changed ? "font-semibold text-primary" : "text-quaternary")}>
                                    <span className="inline-flex items-center gap-2">{changed ? <AppIcon aria-hidden="true" className="size-3.5 text-fg-quaternary" name="arrowRight" /> : null}{settingValue(item.key, item.second)}</span>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      ) : <p className="px-5 pt-2 pb-5 text-sm text-tertiary sm:px-6">{copy.noChanges}</p>}
                    </section>
                  </Panel>

                  <section aria-labelledby="evaluation-metric-comparison-title" className="mt-10">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h2 className="text-md font-semibold text-primary" id="evaluation-metric-comparison-title">{copy.metricComparison}</h2>
                      <span className="text-sm text-quaternary">{copy.deltaNote}</span>
                    </div>
                    {!methodsMatch ? <Notice className="mt-3" data-testid="evaluation-method-mismatch" tone="warning">{interpolate(copy.methodMismatch, { a: methodLabel(methodA), b: methodLabel(methodB) })}</Notice> : null}
                    <div className="mt-4">
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
                    <DiagnosticNote className="mt-3 px-1" copy={copy} />
                  </section>
                </div>
              );
            })() : (
              <Panel>
                <EmptyState description={evaluationHistory.length >= 2 ? copy.noCompare : copy.notEnoughRuns} icon="evaluate" size="sm" title={copy.compareTitle} titleAs="h2" />
              </Panel>
            )}
            {/* With fewer than two selected runs the next step is picking them, so the history starts open. */}
            <Disclosure className="mt-10" contentClassName="p-0" data-testid="evaluation-history" defaultOpen={selectedRuns.length < 2} meta={formatNumber(locale, evaluationHistory.length)} title={copy.history}>
              {evaluationHistory.length ? (
                <Table containerClassName="rounded-b-xl">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 pl-4"><span className="sr-only">{copy.tabs.compare}</span></TableHead>
                      <TableHead>{copy.runColumn}</TableHead>
                      <TableHead numeric>{copy.metrics.hitAtK}</TableHead>
                      <TableHead numeric>{copy.metrics.mrr}</TableHead>
                      <TableHead className="hidden sm:table-cell" numeric>{copy.metrics.recallAtK}</TableHead>
                      <TableHead className="hidden sm:table-cell" numeric>{copy.metrics.precisionAtK}</TableHead>
                      <TableHead className="hidden md:table-cell" numeric>{copy.metrics.citationValidity}</TableHead>
                      <TableHead className="hidden pr-5 md:table-cell" numeric>{copy.groundingShort.lexical}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {evaluationHistory.map((run) => {
                      const name = evaluationName(run);
                      const position = compareIds.indexOf(run.id);
                      const selected = position >= 0;
                      return (
                        <TableRow data-state={selected ? "selected" : undefined} key={run.id}>
                          <TableCell className="pl-4"><TransitionCheckbox aria-label={interpolate(copy.compareRun, { name })} checked={selected} disabled={!selected && compareIds.length >= 2} onChange={() => toggleCompare(run.id)} /></TableCell>
                          <TableCell className="py-2.5 whitespace-normal">
                            <span className="flex items-center gap-2">
                              <span className="text-sm font-medium text-primary">{name}</span>
                              {selected && compareIds.length > 0 ? <RunLetter className="size-5 rounded-sm" letter={position === 0 ? copy.runA : copy.runB} /> : null}
                              {run.status === "failed" ? <StatusBadge status="error">{allCopy.runs.failed}</StatusBadge> : run.status === "running" || run.status === "queued" ? <StatusBadge status="processing">{allCopy.runs.running}</StatusBadge> : null}
                            </span>
                            <span className="mt-0.5 block text-xs text-tertiary">{[runDate(run, locale) ?? "—", configSummary(evaluationConfig(run))].join(" · ")}</span>
                          </TableCell>
                          <TableCell numeric><Score copy={copy} value={run.results.hitAtK} /></TableCell>
                          <TableCell numeric><Score copy={copy} value={run.results.mrr} /></TableCell>
                          <TableCell className="hidden sm:table-cell" numeric><Score copy={copy} value={run.results.recallAtK} /></TableCell>
                          <TableCell className="hidden sm:table-cell" numeric><Score copy={copy} value={run.results.precisionAtK} /></TableCell>
                          <TableCell className="hidden md:table-cell" numeric><Score copy={copy} value={run.results.citationValidity} /></TableCell>
                          <TableCell className="hidden pr-5 md:table-cell" numeric><Score copy={copy} value={run.results.generationMetrics?.lexicalOverlap} /></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : <p className="p-5 text-sm text-tertiary">{copy.notEnoughRuns}</p>}
            </Disclosure>
          </TransitionPanel>
        ) : null}
      </div>
    </div>
  );
}
