"use client";

import { TransitionDetails, TransitionPanel } from "@/components/ui/transitions";

import Link from "next/link";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import { ApiErrorText } from "@/components/api-error-message";
import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { SampleDocumentButton } from "@/components/sample-document-button";
import { usePreferences } from "@/components/preferences-provider";
import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { Button, buttonStyles } from "@/components/ui/button";
import { HowItWorks } from "@/components/ui/disclosure";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Label } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MetricValue } from "@/components/ui/metric";
import { Modal, ModalClose, ModalContent, ModalFooter } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { ProgressBar } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { isExceptionTone, PIPELINE_STEP_STATUS, StatusIcon, StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { useCopy } from "@/lib/copy";
import { blocker } from "@/lib/blockers";
import { journeyLockReason } from "@/lib/overview-view-model";
import {
  buildJourneyConnectorPath,
  deriveJourneyConnectorState,
  JOURNEY_CANVAS,
  JOURNEY_CONNECTOR_PAIRS,
  JOURNEY_FILL_TRACK,
  journeyConnectorVisualForState,
  journeyFillDelayMs,
  journeyFillDurationMs,
  journeyFillExtent,
  journeyGroupPosition,
  journeyNodePosition,
  journeyNodeVisualForState,
  type JourneyFill,
  type JourneyGroupKey,
  type JourneyStepKey,
} from "@/lib/overview-journey";
import type { PipelineStepDefinition, PipelineStepKey, PipelineStepState } from "@/lib/rag-ui-types";
import { cn } from "@/lib/utils";
import { buildWorkspaceOverview, countDoneJourneyStages } from "@/lib/workspace-overview";

const pipelineSteps = [
  { key: "document", icon: "document" },
  { key: "parse", icon: "parse" },
  { key: "chunk", icon: "chunk" },
  { key: "embed", icon: "embed" },
  { key: "retrieve", icon: "retrieve" },
  { key: "rerank", icon: "rerank" },
  { key: "context", icon: "context" },
  { key: "generate", icon: "generate" },
  { key: "evaluate", icon: "evaluate" },
] as const satisfies readonly PipelineStepDefinition[];

type JourneyPipelineStep = (typeof pipelineSteps)[number];

const stageHref: Record<PipelineStepKey, string> = {
  document: "/documents",
  parse: "/parse",
  chunk: "/chunking",
  embed: "/embeddings",
  index: "/embeddings",
  retrieve: "/playground",
  rerank: "/playground",
  context: "/playground",
  generate: "/playground",
  evaluate: "/evaluation",
};

const journeyIcons: Record<JourneyStepKey, SemanticIconName> = {
  document: "document",
  parse: "parse",
  chunk: "chunk",
  embed: "embed",
  retrieve: "retrieve",
  rerank: "rerank",
  context: "context",
  generate: "generate",
  evaluate: "evaluate",
};

/** The compact journey keeps the desktop grouping: Prepare · Test · Measure. */
const compactGroups: readonly { key: JourneyGroupKey; steps: readonly JourneyPipelineStep[] }[] = [
  { key: "prepare", steps: pipelineSteps.slice(0, 4) },
  { key: "test", steps: pipelineSteps.slice(4, 8) },
  { key: "measure", steps: pipelineSteps.slice(8) },
];

/** Exceptional continuation states get a visible status chip next to the progress readout. */
const exceptionStatus: Partial<Record<PipelineStepState, Status>> = { Processing: "processing", Error: "error", Stale: "stale" };

const menuItemClass = "flex h-9 w-full items-center rounded-md px-2.5 text-left text-sm font-medium text-secondary transition-colors duration-100 hover:bg-primary_hover hover:text-primary disabled:cursor-not-allowed disabled:text-disabled disabled:hover:bg-transparent";

function JourneyGlyph({ stepKey, state }: { stepKey: JourneyStepKey; state: PipelineStepState }) {
  const visual = journeyNodeVisualForState(state);
  return (
    <AppIcon
      aria-hidden="true"
      className="size-4.5"
      data-state={state}
      data-testid={`overview-journey-glyph-${stepKey}`}
      name={journeyIcons[stepKey]}
      style={{ color: visual.iconColor }}
    />
  );
}

const journeyCanvasProps = {
  "aria-hidden": true,
  className: "pointer-events-none absolute left-0 top-px z-[1] h-50 w-full overflow-visible",
  height: JOURNEY_CANVAS.height,
  preserveAspectRatio: "none",
  viewBox: `0 0 ${JOURNEY_CANVAS.width} ${JOURNEY_CANVAS.height}`,
  width: "100%",
} as const;

/** clip-path insets (right edge, % of the canvas) the green fill sweeps between; 6px covers the round cap. */
function journeyFillStyle(fill: JourneyFill): CSSProperties {
  const rightInset = (x: number) => `${((1 - x / JOURNEY_CANVAS.width) * 100).toFixed(3)}%`;
  return {
    "--journey-fill-dur": `${journeyFillDurationMs(fill)}ms`,
    "--journey-fill-from": rightInset(fill.startX),
    "--journey-fill-to": `calc(${rightInset(fill.endX)} - 6px)`,
  } as CSSProperties;
}

/**
 * The wave keeps one canonical connector layer (state, testids, geometry). Completed connectors sit
 * there as a neutral track; a second, clipped layer draws them green and sweeps left to right once
 * on mount, up to the last completed stage. It remounts when that extent changes, so the fill also
 * plays when pipeline data arrives after the first paint.
 */
function JourneyConnectors({ fill, stateFor }: { fill: JourneyFill | null; stateFor: (step: JourneyStepKey) => PipelineStepState }) {
  const connectors = JOURNEY_CONNECTOR_PAIRS.map(({ destination, source }) => ({
    d: buildJourneyConnectorPath(source, destination),
    destination,
    source,
    state: deriveJourneyConnectorState(stateFor(source), stateFor(destination)),
  }));
  return (
    <>
      <svg {...journeyCanvasProps} data-testid="overview-journey-connectors">
        {connectors.map(({ d, destination, source, state }) => {
          const visual = state === "Completed" ? JOURNEY_FILL_TRACK : journeyConnectorVisualForState(state);
          return (
            <path
              d={d}
              data-state={state}
              data-testid={`overview-journey-connector-${source}-${destination}`}
              fill="none"
              key={`${source}-${destination}`}
              stroke={visual.color}
              strokeLinecap="round"
              strokeOpacity={visual.opacity}
              strokeWidth={visual.width}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      {fill ? (
        <svg
          {...journeyCanvasProps}
          className={cn(journeyCanvasProps.className, "steplab-journey-fill")}
          data-testid="overview-journey-fill"
          key={`${fill.startX}-${fill.endX}`}
          style={journeyFillStyle(fill)}
        >
          {connectors.filter(({ state }) => state === "Completed").map(({ d, destination, source }) => {
            const visual = journeyConnectorVisualForState("Completed");
            return (
              <path
                d={d}
                fill="none"
                key={`${source}-${destination}`}
                stroke={visual.color}
                strokeLinecap="round"
                strokeOpacity={visual.opacity}
                strokeWidth={visual.width}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
      ) : null}
    </>
  );
}

function JourneyNode({
  fillDelayMs,
  href,
  labels,
  reason,
  state,
  step,
  onReveal,
}: {
  fillDelayMs: number;
  href: string;
  labels: Record<PipelineStepKey, string>;
  reason: string | null;
  state: PipelineStepState;
  step: JourneyPipelineStep;
  onReveal: (step: JourneyStepKey | null) => void;
}) {
  const position = journeyNodePosition(step.key);
  const visual = journeyNodeVisualForState(state);
  const completed = state === "Completed";
  const content = (
    <>
      <span
        className="relative grid size-10 place-items-center rounded-md border transition-colors"
        data-state={state}
        style={{
          backgroundColor: visual.backgroundColor,
          borderColor: visual.borderColor,
          color: visual.iconColor,
          opacity: visual.opacity,
        }}
      >
        <JourneyGlyph state={state} stepKey={step.key} />
        {completed ? (
          <span
            aria-hidden="true"
            className="steplab-journey-check absolute -right-1 -top-1 grid size-3.5 place-items-center rounded-full bg-fg-success-primary text-white"
            data-testid={`overview-journey-check-${step.key}`}
            style={{ animationDelay: `${fillDelayMs}ms` }}
          >
            <AppIcon name="check" className="size-2.5" strokeWidth={2.5} />
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "absolute left-1/2 w-28 -translate-x-1/2 text-center text-xs font-medium leading-4 text-primary",
          position.label === "above" ? "-top-6" : "top-12",
        )}
      >
        {labels[step.key]}
      </span>
    </>
  );

  const className = cn("absolute z-10 rounded-md", reason ? "cursor-help" : "hover:ring-2 hover:ring-control");
  const style = { left: position.left, top: position.top };
  // A locked node stays focusable so its reason is reachable by pointer, touch and keyboard (Q9).
  return reason ? (
    <div
      aria-describedby="overview-journey-reason"
      aria-disabled="true"
      aria-label={`${labels[step.key]}: ${reason}`}
      className={className}
      data-state={state}
      data-testid={`overview-journey-node-${step.key}`}
      onBlur={() => onReveal(null)}
      onClick={() => onReveal(step.key)}
      onFocus={() => onReveal(step.key)}
      onMouseEnter={() => onReveal(step.key)}
      onMouseLeave={() => onReveal(null)}
      role="link"
      style={style}
      tabIndex={0}
      title={reason}
    >
      {content}
    </div>
  ) : (
    <Link className={className} data-state={state} data-testid={`overview-journey-node-${step.key}`} href={href} style={style}>
      {content}
    </Link>
  );
}

/** Exceptions (processing/error/stale) show text; everything else stays icon-only. */
function JourneyStatus({ state }: { state: PipelineStepState }) {
  const copy = useCopy();
  const presentation = PIPELINE_STEP_STATUS[state];
  const label = copy.status[state];
  return isExceptionTone(presentation.tone)
    ? <StatusPill tone={presentation.tone}>{label}</StatusPill>
    : <StatusIcon icon={presentation.icon} label={label} tone={presentation.tone} />;
}

/**
 * Below 1440px the wave becomes three vertical timelines (Prepare · Test · Measure) using the
 * same node and connector colours, so the reading order and the "next step" stay identical.
 * Locked steps share their unlock reason, so it is shown once, on the first step it applies to;
 * later steps with the same reason point at that line for assistive technology.
 */
function JourneyCompact({ labels, groupLabels, reasonFor, stateFor }: { labels: Record<PipelineStepKey, string>; groupLabels: Record<JourneyGroupKey, string>; reasonFor: (step: PipelineStepKey) => string | null; stateFor: (step: PipelineStepKey) => PipelineStepState }) {
  const reasonOwner = new Map<string, JourneyStepKey>();
  for (const step of pipelineSteps) {
    const reason = reasonFor(step.key);
    if (reason && !reasonOwner.has(reason)) reasonOwner.set(reason, step.key);
  }
  return (
    <div className="grid gap-x-6 gap-y-5 md:grid-cols-3" data-testid="overview-journey-compact">
      {compactGroups.map((group) => (
        <section aria-label={groupLabels[group.key]} className="min-w-0" key={group.key}>
          <p className="mb-1 px-2 text-xs font-medium text-tertiary">{groupLabels[group.key]}</p>
          <ol className="flex flex-col">
            {group.steps.map((step, index) => {
              const reason = reasonFor(step.key);
              const reasonStep = reason ? reasonOwner.get(reason) : undefined;
              const showsReason = reasonStep === step.key;
              const state = stateFor(step.key);
              const visual = journeyNodeVisualForState(state);
              const next = group.steps[index + 1];
              const line = next ? journeyConnectorVisualForState(deriveJourneyConnectorState(state, stateFor(next.key))) : null;
              const content = (
                <>
                  <span
                    className="relative z-10 grid size-9 shrink-0 place-items-center rounded-lg border"
                    style={{ backgroundColor: visual.backgroundColor, borderColor: visual.borderColor, opacity: visual.opacity }}
                  >
                    <JourneyGlyph state={state} stepKey={step.key} />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className={cn("block truncate text-sm font-medium", reason ? "text-tertiary" : "text-primary")}>{labels[step.key]}</span>
                    {showsReason ? <span className="block text-xs text-tertiary" data-testid={`overview-compact-journey-reason-${step.key}`} id={`overview-compact-journey-reason-${step.key}`}>{reason}</span> : null}
                  </span>
                  <JourneyStatus state={state} />
                </>
              );
              const rowClass = "relative flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5";
              return (
                <li className="relative" key={step.key}>
                  {line ? (
                    <span
                      aria-hidden="true"
                      className="absolute top-10.5 -bottom-1.5 left-6.5 w-0.5 -translate-x-1/2 rounded-full"
                      style={{ backgroundColor: line.color, opacity: line.opacity }}
                    />
                  ) : null}
                  {reason
                    ? <div aria-describedby={reasonStep && !showsReason ? `overview-compact-journey-reason-${reasonStep}` : undefined} aria-disabled="true" className={rowClass} data-testid={`overview-compact-journey-node-${step.key}`}>{content}</div>
                    : <Link className={cn(rowClass, "transition-colors duration-150 hover:bg-primary_hover")} data-testid={`overview-compact-journey-node-${step.key}`} href={stageHref[step.key]}>{content}</Link>}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** Decorative first-use illustration: a PDF becomes chunks, chunks become a sourced answer. */
function FirstUseIllustration() {
  const bar = "block h-1.5 rounded-full bg-quaternary";
  return (
    <div aria-hidden="true" className="relative hidden shrink-0 items-center gap-4 lg:flex">
      <div className="w-28 rounded-xl bg-primary p-3 shadow-sm ring-1 ring-secondary transition-transform duration-300 ease-out group-hover/first-use:-translate-y-1">
        <div className="flex items-center gap-1.5">
          <AppIcon className="size-4 text-fg-quaternary" name="document" />
          <span className={cn(bar, "w-10 bg-tertiary")} />
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          <span className={cn(bar, "w-full")} />
          <span className={cn(bar, "w-4/5")} />
          <span className={cn(bar, "w-full")} />
          <span className={cn(bar, "w-2/3")} />
          <span className={cn(bar, "w-5/6")} />
          <span className={cn(bar, "w-1/2")} />
        </div>
      </div>
      <AppIcon className="size-4 text-fg-quaternary" name="arrowRight" />
      <div className="flex flex-col gap-2">
        {["w-full", "w-4/5", "w-2/3"].map((width, index) => (
          <div className={cn("flex w-24 flex-col gap-1 rounded-lg bg-secondary px-2.5 py-2 ring-1 ring-secondary transition-transform duration-300 ease-out", index === 1 && "translate-x-2 group-hover/first-use:translate-x-3")} key={width}>
            <span className={cn(bar, "h-1", width)} />
            <span className={cn(bar, "h-1 w-1/2")} />
          </div>
        ))}
      </div>
      <AppIcon className="size-4 text-fg-quaternary" name="arrowRight" />
      <div className="w-36 rounded-xl bg-primary p-3 shadow-sm ring-1 ring-secondary transition-transform duration-300 ease-out group-hover/first-use:-translate-y-1">
        <AppIcon className="size-4 text-fg-tertiary" name="generate" />
        <div className="mt-2.5 flex flex-col gap-1.5">
          <span className={cn(bar, "w-full")} />
          <span className={cn(bar, "w-3/4")} />
        </div>
        <div className="mt-3 flex gap-1">
          <span className="rounded-sm bg-tertiary px-1.5 text-xs font-semibold text-tertiary">S1</span>
          <span className="rounded-sm bg-tertiary px-1.5 text-xs font-semibold text-tertiary">S2</span>
        </div>
      </div>
    </div>
  );
}

export function OverviewScreen() {
  const { preferences } = usePreferences();
  const copy = useCopy();
  const labels = copy.overview.workspace;
  const pipelineContext = useDocumentPipeline();
  const {
    documents,
    activeDocumentId,
    activeDocument,
    persistenceStatus,
    persistenceError,
    pipelines,
    activePipelineId,
    activePipeline,
    selectPersistedDocument,
    selectPipeline,
    createPipeline,
    renamePipeline,
    deletePipeline,
  } = pipelineContext;
  const [editing, setEditing] = useState<"create" | "rename" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pipelineName, setPipelineName] = useState("");
  const [managementBusy, setManagementBusy] = useState(false);
  const [managementError, setManagementError] = useState<string | null>(null);
  const [revealedStep, setRevealedStep] = useState<JourneyStepKey | null>(null);
  const managementMenuRef = useRef<HTMLDetailsElement>(null);

  const overviewModel = buildWorkspaceOverview(pipelineContext);
  const pipelineState = overviewModel.pipelineState;
  const isFirstUse = persistenceStatus === "available" && documents.length === 0;
  const continuation = overviewModel.continuation;
  const continuationException = exceptionStatus[continuation.state];
  const progress = countDoneJourneyStages(pipelineState);
  const journeyFill = journeyFillExtent((step) => pipelineState[step]);
  const showProgress = persistenceStatus === "available" && continuation.kind !== "checking";
  const journeyLabels = copy.overview.journey.steps;
  const groupLabels = copy.navGroups;

  // The management menu is a <details> dropdown: close it on an outside press or Escape.
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const menu = managementMenuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
    }
    function handleKeyDown(event: KeyboardEvent) {
      const menu = managementMenuRef.current;
      if (event.key !== "Escape" || !menu?.open) return;
      menu.open = false;
      menu.querySelector("summary")?.focus();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function lockedReason(step: PipelineStepKey): string | null {
    const code = journeyLockReason(step, pipelineState);
    return code ? blocker(preferences.locale, code).message : null;
  }
  const revealedReason = revealedStep ? lockedReason(revealedStep) : null;

  async function savePipelineName() {
    const name = pipelineName.trim();
    if (!name || !activeDocumentId || managementBusy) return;
    setManagementBusy(true);
    setManagementError(null);
    try {
      const mode = editing;
      const result = mode === "create" ? await createPipeline(name) : mode === "rename" && activePipeline ? await renamePipeline(activePipeline.id, name) : null;
      if (!result) {
        setManagementError(labels.saveFailed);
        return;
      }
      setEditing(null);
      setPipelineName("");
      toast.success(mode === "create" ? labels.created : labels.renamed, { description: result.name });
    } finally {
      setManagementBusy(false);
    }
  }

  async function confirmPipelineDelete() {
    if (!activePipeline || managementBusy) return;
    const name = activePipeline.name;
    setManagementBusy(true);
    setManagementError(null);
    try {
      if (await deletePipeline(activePipeline.id)) {
        setConfirmDelete(false);
        toast.success(labels.deleted, { description: name });
      } else setManagementError(labels.deleteFailed);
    } finally {
      setManagementBusy(false);
    }
  }

  function closeManagementMenu() {
    if (managementMenuRef.current) managementMenuRef.current.open = false;
  }

  function beginCreatePipeline() {
    setConfirmDelete(false);
    setManagementError(null);
    setEditing("create");
    setPipelineName("");
    closeManagementMenu();
  }

  function beginRenamePipeline() {
    if (!activePipeline) return;
    setConfirmDelete(false);
    setManagementError(null);
    setEditing("rename");
    setPipelineName(activePipeline.name);
    closeManagementMenu();
  }

  return (
    <div className="min-w-0" data-testid="overview-screen">
      <div className="mx-auto w-full max-w-container p-10 max-md:p-4" data-testid="overview-main">
        <PageHeader
          data-testid="overview-page-header"
          help={preferences.showLearningHints ? <div data-testid="overview-learning-note"><HowItWorks>{copy.overview.howItWorks}</HowItWorks></div> : undefined}
          title={copy.overview.title}
        />

        <div className="mt-8 flex flex-col gap-6">
          {isFirstUse ? (
            <Panel as="section" className="group/first-use relative overflow-hidden" data-testid="overview-first-use" padding="none">
              <div className="flex items-center justify-between gap-10 p-6 sm:p-8">
                <div className="min-w-0 max-w-xl">
                  <FeaturedIcon icon="cloudUpload" size="lg" />
                  <h2 className="mt-5 text-xl font-semibold text-primary">{copy.overview.firstUse.title}</h2>
                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    <SampleDocumentButton primary size="lg" />
                    <Button asChild size="lg" variant="secondary">
                      <Link href="/documents">{copy.overview.firstUse.addOwnPdf}<AppIcon className="size-4" name="arrowRight" /></Link>
                    </Button>
                  </div>
                  <p className="mt-5 flex items-start gap-1.5 text-xs text-tertiary" data-testid="overview-privacy-note">
                    <AppIcon aria-hidden="true" className="mt-px size-3.5 shrink-0 text-fg-quaternary" name="lock" />
                    {copy.overview.firstUse.privacy}
                  </p>
                </div>
                <FirstUseIllustration />
              </div>
            </Panel>
          ) : (
            <Panel as="section" data-testid="workspace-control-plane" padding="none">
              <div className="flex flex-wrap items-end gap-3 p-5">
                <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">
                  <Label htmlFor="overview-document">{labels.document}</Label>
                  <Select disabled={persistenceStatus !== "available" || documents.length === 0} onValueChange={(value) => void selectPersistedDocument(value)} value={activeDocumentId ?? ""}>
                    <SelectTrigger aria-label={labels.document} className="max-w-full" data-testid="overview-document-selector" id="overview-document" size="lg" title={activeDocument?.fileName ?? labels.chooseDocument}><SelectValue placeholder={labels.chooseDocument} /></SelectTrigger>
                    <SelectContent>{documents.map((document) => <SelectItem className="wrap-anywhere" key={document.id} value={document.id}>{document.fileName}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">
                  <Label htmlFor="overview-pipeline">{labels.pipeline}</Label>
                  <Select disabled={!activeDocumentId || pipelines.length === 0} onValueChange={(value) => void selectPipeline(value)} value={activePipelineId ?? ""}>
                    <SelectTrigger aria-label={labels.pipeline} className="max-w-full" data-testid="overview-pipeline-selector" id="overview-pipeline" size="lg" title={activePipeline?.name ?? labels.choosePipeline}>
                      {/* The trigger shows only the name; the "default" marker lives in the list. */}
                      <SelectValue placeholder={labels.choosePipeline}>{activePipeline ? activePipeline.name : undefined}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>{pipelines.map((pipeline) => (
                      <SelectItem className="wrap-anywhere" key={pipeline.id} value={pipeline.id}>
                        {pipeline.name}{pipeline.isDefault ? <span className="ml-1.5 text-xs font-normal text-quaternary">{copy.common.defaultPipeline}</span> : null}
                      </SelectItem>
                    ))}</SelectContent>
                  </Select>
                </div>
                <TransitionDetails className="relative max-sm:w-full" data-testid="pipeline-management" ref={managementMenuRef} variant="dropdown">
                  <summary className={buttonStyles({ variant: "secondary", size: "lg", className: "w-full cursor-pointer list-none justify-between gap-2 [&::-webkit-details-marker]:hidden" })}>
                    <span>{labels.managePipeline}</span>
                    <AppIcon name="chevronDown" className="size-4 text-fg-quaternary" />
                  </summary>
                  <div className="absolute right-0 z-20 mt-2 flex w-60 flex-col rounded-xl bg-primary_alt p-1.5 shadow-lg ring-1 ring-secondary_alt">
                    <button className={menuItemClass} disabled={!activeDocumentId || persistenceStatus !== "available" || managementBusy} onClick={beginCreatePipeline} type="button">{labels.newPipeline}</button>
                    <button className={menuItemClass} disabled={!activePipeline || managementBusy} onClick={beginRenamePipeline} type="button">{labels.rename}</button>
                    {activePipeline ? <button className={menuItemClass} data-testid="clear-pipeline-selection" onClick={() => { closeManagementMenu(); void selectPipeline(null); }} type="button">{labels.clearPipeline}</button> : null}
                    <div aria-hidden="true" className="-mx-1.5 my-1.5 h-px bg-border-secondary" />
                    <button className={cn(menuItemClass, "text-error-primary hover:bg-error-primary hover:text-error-primary_hover")} disabled={!activePipeline || managementBusy} onClick={() => { setEditing(null); setManagementError(null); setConfirmDelete(true); closeManagementMenu(); }} type="button">{copy.common.delete}</button>
                  </div>
                </TransitionDetails>
              </div>

              {persistenceStatus === "unavailable" ? (
                <div className="px-5 pb-5">
                  <Notice role="alert" title={labels.unavailable} tone="error">{persistenceError ? <ApiErrorText error={persistenceError} fallback={copy.errors.workspaceLoadFailed} /> : null}</Notice>
                </div>
              ) : null}

              {editing ? (
                <TransitionPanel className="border-t border-secondary px-5 py-4" data-testid="pipeline-name-editor">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1.5 sm:max-w-sm">
                      <Label htmlFor="overview-pipeline-name">{labels.namePlaceholder}</Label>
                      <Input aria-invalid={managementError ? true : undefined} autoFocus id="overview-pipeline-name" maxLength={100} onChange={(event) => setPipelineName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void savePipelineName(); }} placeholder={labels.namePlaceholder} value={pipelineName} />
                    </div>
                    <Button disabled={!pipelineName.trim() || managementBusy} isLoading={managementBusy} onClick={() => void savePipelineName()}>{copy.common.save}</Button>
                    <Button disabled={managementBusy} onClick={() => { setEditing(null); setManagementError(null); }} variant="tertiary">{copy.common.cancel}</Button>
                  </div>
                  {managementError ? <p className="mt-2 text-sm text-error-primary" role="alert">{managementError}</p> : null}
                </TransitionPanel>
              ) : null}

              <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-b-xl border-t border-secondary bg-secondary px-5 py-3.5 max-sm:flex-col max-sm:items-stretch" data-testid="continue-surface">
                {/* While the workspace loads or the service is down there is no lineage to measure. */}
                {showProgress ? <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
                  {continuationException ? <StatusBadge appearance="pill" status={continuationException}>{copy.status[continuation.state]}</StatusBadge> : null}
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-tertiary">{copy.overview.journey.progress}</span>
                    <span className="inline-flex items-baseline gap-0.5 text-sm font-semibold text-primary tabular-nums"><MetricValue value={progress.done} /><span className="font-normal text-quaternary">/</span><span className="font-normal text-quaternary">{progress.total}</span></span>
                    <ProgressBar className="steplab-progress-grow w-24" label={copy.overview.journey.progress} max={progress.total} tone="success" value={progress.done} />
                  </div>
                </div> : <span aria-hidden="true" />}
                {continuation.kind === "checking" ? (
                  <Button className="min-w-0" data-testid="overview-continue-action" disabled size="lg">{copy.overview.continuation.checking}</Button>
                ) : (
                  <Button asChild className="min-w-0" data-testid="overview-continue-action" size="lg">
                    <Link href={continuation.href}>{copy.overview.continuation[continuation.kind]}<AppIcon name="arrowRight" className="size-4" /></Link>
                  </Button>
                )}
              </div>

              <Modal onOpenChange={(open) => { if (!open && !managementBusy) { setConfirmDelete(false); setManagementError(null); } }} open={confirmDelete && Boolean(activePipeline)}>
                {activePipeline ? (
                  <ModalContent
                    data-testid="delete-pipeline-dialog"
                    description={<><span className="font-medium text-primary wrap-anywhere">{activePipeline.name}</span> — {labels.deleteDescription}</>}
                    icon="trash"
                    iconColor="error"
                    size="sm"
                    title={labels.deleteTitle}
                  >
                    {managementError ? <p className="px-6 pt-4 text-sm text-error-primary" role="alert">{managementError}</p> : null}
                    <ModalFooter>
                      <ModalClose asChild><Button disabled={managementBusy} size="lg" variant="secondary">{copy.common.cancel}</Button></ModalClose>
                      <Button disabled={managementBusy} isLoading={managementBusy} onClick={() => void confirmPipelineDelete()} size="lg" variant="destructive">{copy.common.delete}</Button>
                    </ModalFooter>
                  </ModalContent>
                ) : null}
              </Modal>
            </Panel>
          )}

          <Panel as="section" className="pb-4" data-testid="overview-pipeline">
            <h2 className="text-md font-semibold text-primary">{copy.overview.journey.title}</h2>
            <div className="relative mt-2 w-full overflow-hidden" data-testid="overview-journey">
              {/* Node labels and check badges sit outside their 40px node boxes by design, inside this canvas. */}
              <div className="relative hidden h-54 w-full pt-3 min-[1440px]:block" data-overflow-intentional="" data-testid="overview-journey-desktop">
                <div className="relative h-50 w-full">
                  <div className="absolute top-1 h-48 rounded-lg border border-tertiary bg-secondary" data-testid="overview-group-prepare" style={journeyGroupPosition("prepare")}><span className="absolute left-3.5 top-3 text-xs font-medium text-tertiary">{groupLabels.prepare}</span></div>
                  <div className="absolute top-1 h-48 rounded-lg border border-tertiary bg-secondary" data-testid="overview-group-test" style={journeyGroupPosition("test")}><span className="absolute left-3.5 top-3 text-xs font-medium text-tertiary">{groupLabels.test}</span></div>
                  <div className="absolute top-1 h-48 rounded-lg border border-tertiary bg-secondary" data-testid="overview-group-measure" style={journeyGroupPosition("measure")}><span className="absolute left-3.5 top-3 text-xs font-medium text-tertiary">{groupLabels.measure}</span></div>
                  <JourneyConnectors fill={journeyFill} stateFor={(step) => pipelineState[step]} />
                  {pipelineSteps.map((step) => <JourneyNode fillDelayMs={journeyFillDelayMs(step.key, journeyFill)} href={stageHref[step.key]} key={step.key} labels={journeyLabels} onReveal={setRevealedStep} reason={lockedReason(step.key)} state={pipelineState[step.key]} step={step} />)}
                </div>
              </div>
              <div className="pt-2 min-[1440px]:hidden">
                <JourneyCompact groupLabels={groupLabels} labels={journeyLabels} reasonFor={lockedReason} stateFor={(step) => pipelineState[step]} />
              </div>
            </div>
            {/* Visible reason for the hovered/focused/tapped locked desktop node (Q9). */}
            <p aria-live="polite" className="mt-1 hidden min-h-5 text-xs text-tertiary min-[1440px]:block" data-testid="overview-journey-reason" id="overview-journey-reason">
              {revealedReason ? <><AppIcon aria-hidden="true" name="lock" className="mr-1.5 inline size-3.5 align-[-2px]" />{journeyLabels[revealedStep!]}: {revealedReason}</> : null}
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
