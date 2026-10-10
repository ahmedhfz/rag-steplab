"use client";

import { TransitionDetails, TransitionPanel } from "@/components/ui/transitions";
import { TransitionDialogContent } from "@/components/ui/transition-surface";

import Link from "next/link";
import { useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { SampleDocumentButton } from "@/components/sample-document-button";
import { PipelineErrorMessage } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { HowItWorks } from "@/components/ui/disclosure";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isExceptionTone, PIPELINE_STEP_STATUS, StatusIcon, StatusPill } from "@/components/ui/status-pill";
import { useCopy } from "@/lib/copy";
import { blocker } from "@/lib/blockers";
import { buildOverviewViewModel, journeyLockReason } from "@/lib/overview-view-model";
import {
  buildJourneyConnectorPath,
  deriveJourneyConnectorState,
  JOURNEY_CANVAS,
  JOURNEY_CONNECTOR_PAIRS,
  journeyConnectorVisualForState,
  journeyGroupPosition,
  journeyNodePosition,
  journeyNodeVisualForState,
  type JourneyStepKey,
} from "@/lib/overview-journey";
import type { PipelineStepDefinition, PipelineStepKey, PipelineStepState } from "@/lib/rag-ui-types";
import { cn } from "@/lib/utils";

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

const selectorTriggerClass = "min-w-0 max-w-full overflow-hidden [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:flex-1 [&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]]:whitespace-nowrap";
const selectorItemClass = "h-auto min-h-8 whitespace-normal [overflow-wrap:anywhere]";

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

function JourneyConnectors({ stateFor }: { stateFor: (step: JourneyStepKey) => PipelineStepState }) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-px z-[1] h-50 w-full overflow-visible"
      data-testid="overview-journey-connectors"
      height={JOURNEY_CANVAS.height}
      preserveAspectRatio="none"
      viewBox={`0 0 ${JOURNEY_CANVAS.width} ${JOURNEY_CANVAS.height}`}
      width="100%"
    >
      {JOURNEY_CONNECTOR_PAIRS.map(({ destination, source }) => {
        const state = deriveJourneyConnectorState(stateFor(source), stateFor(destination));
        const visual = journeyConnectorVisualForState(state);
        return (
          <path
            d={buildJourneyConnectorPath(source, destination)}
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
  );
}

function JourneyNode({
  href,
  labels,
  reason,
  state,
  step,
  onReveal,
}: {
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
          <span aria-hidden="true" className="absolute -right-1 -top-1 grid size-3.5 place-items-center rounded-full bg-muted-foreground text-card" data-testid={`overview-journey-check-${step.key}`}>
            <AppIcon name="check" className="size-2.5" strokeWidth={2.5} />
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "absolute left-1/2 w-28 -translate-x-1/2 text-center text-xs font-medium leading-4 text-foreground",
          position.label === "above" ? "-top-6" : "top-12",
        )}
      >
        {labels[step.key]}
      </span>
    </>
  );

  const className = cn("absolute z-10 rounded-md", reason ? "cursor-help" : "hover:ring-2 hover:ring-input");
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

function JourneyCompact({ labels, reasonFor, stateFor }: { labels: Record<PipelineStepKey, string>; reasonFor: (step: PipelineStepKey) => string | null; stateFor: (step: PipelineStepKey) => PipelineStepState }) {
  return (
    <ol className="grid gap-2" data-testid="overview-journey-compact">
      {pipelineSteps.map((step) => {
        const reason = reasonFor(step.key);
        const state = stateFor(step.key);
        const content = (
          <>
            <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-card">
              <JourneyGlyph state={state} stepKey={step.key} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-medium text-foreground">{labels[step.key]}</span>
              {reason ? <span className="block text-xs text-muted-foreground" data-testid={`overview-compact-journey-reason-${step.key}`}>{reason}</span> : null}
            </span>
            <JourneyStatus state={state} />
          </>
        );
        return (
          <li key={step.key}>
            {reason
              ? <div aria-disabled="true" className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5" data-testid={`overview-compact-journey-node-${step.key}`}>{content}</div>
              : <Link className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5 hover:bg-surface-subtle" data-testid={`overview-compact-journey-node-${step.key}`} href={stageHref[step.key]}>{content}</Link>}
          </li>
        );
      })}
    </ol>
  );
}

export function OverviewScreen() {
  const { preferences } = usePreferences();
  const copy = useCopy();
  const labels = copy.overview.workspace;
  const {
    documents,
    activeDocumentId,
    activeDocument,
    persistenceStatus,
    persistenceError,
    workspaceStatus,
    selectedParseRunId,
    selectedChunkRunId,
    selectedEmbeddingRunId,
    chunkStatus,
    embeddingStatus,
    pipelines,
    activePipelineId,
    activePipeline,
    selectPersistedDocument,
    selectPipeline,
    createPipeline,
    renamePipeline,
    deletePipeline,
  } = useDocumentPipeline();
  const [editing, setEditing] = useState<"create" | "rename" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pipelineName, setPipelineName] = useState("");
  const [managementBusy, setManagementBusy] = useState(false);
  const [managementError, setManagementError] = useState<string | null>(null);
  const [revealedStep, setRevealedStep] = useState<JourneyStepKey | null>(null);
  const managementMenuRef = useRef<HTMLDetailsElement>(null);

  const parseSummary = activeDocument?.parseRuns.find((run) => run.id === selectedParseRunId);
  const chunkSummary = activeDocument?.chunkRuns.find((run) => run.id === selectedChunkRunId);
  const embeddingSummary = activeDocument?.embeddingRuns.find((run) => run.id === selectedEmbeddingRunId);
  const matchingExperiment = activeDocument?.experiments.find(
    (run) => run.isCompatible && run.chunkRunId === selectedChunkRunId && (run.embeddingRunId === null || run.embeddingRunId === selectedEmbeddingRunId),
  );
  const matchingDatasetIds = new Set(
    activeDocument?.evaluationDatasets.filter((dataset) => dataset.parseRunId === selectedParseRunId).map((dataset) => dataset.id) ?? [],
  );
  const matchingEvaluation = activeDocument?.evaluationRuns.find(
    (run) => matchingDatasetIds.has(run.datasetId) && run.chunkRunId === selectedChunkRunId && run.embeddingRunId === selectedEmbeddingRunId,
  );
  const overviewModel = buildOverviewViewModel({
    activeDocument: activeDocument ? { parseRuns: activeDocument.parseRuns } : undefined,
    activeDocumentId,
    chunk: chunkSummary,
    chunkStatus,
    embedding: embeddingSummary,
    embeddingStatus,
    evaluation: matchingEvaluation,
    experiment: matchingExperiment,
    hasEvaluationDataset: matchingDatasetIds.size > 0,
    parse: parseSummary,
    // While the active lineage is still loading, the continuation stays neutral.
    persistenceStatus: workspaceStatus === "loading" && persistenceStatus === "available" ? "checking" : persistenceStatus,
    selectedChunkRunId,
    selectedEmbeddingRunId,
    selectedParseRunId,
  });
  const pipelineState = overviewModel.pipelineState;
  const isFirstUse = persistenceStatus === "available" && documents.length === 0;
  const continuation = overviewModel.continuation;
  const continuationStatus = PIPELINE_STEP_STATUS[continuation.state];
  const journeyLabels = copy.overview.journey.steps;
  const groupLabels = copy.navGroups;

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
      const result = editing === "create" ? await createPipeline(name) : editing === "rename" && activePipeline ? await renamePipeline(activePipeline.id, name) : null;
      if (!result) {
        setManagementError(labels.saveFailed);
        return;
      }
      setEditing(null);
      setPipelineName("");
    } finally {
      setManagementBusy(false);
    }
  }

  async function confirmPipelineDelete() {
    if (!activePipeline || managementBusy) return;
    setManagementBusy(true);
    setManagementError(null);
    try {
      if (await deletePipeline(activePipeline.id)) setConfirmDelete(false);
      else setManagementError(labels.deleteFailed);
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
    <div className="min-w-0 bg-background" data-testid="overview-screen">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4" data-testid="overview-main">
        <PageHeader
          data-testid="overview-page-header"
          description={isFirstUse ? copy.overview.firstUseDescription : copy.overview.description}
          help={preferences.showLearningHints ? <div data-testid="overview-learning-note"><HowItWorks>{copy.overview.howItWorks}</HowItWorks></div> : undefined}
          title={copy.overview.title}
        />

        {isFirstUse ? (
          <section className="mt-6 rounded-lg border border-border bg-card p-5 sm:p-6" data-testid="overview-first-use">
            <h2 className="text-lg font-semibold text-foreground">{copy.overview.firstUse.title}</h2>
            <ol className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground" data-testid="overview-first-use-steps">
              {copy.overview.firstUse.steps.map((step, index) => (
                <li className="flex items-center gap-2" key={step}>
                  {index > 0 ? <AppIcon aria-hidden="true" name="arrowRight" className="size-3.5 text-subtle-foreground" /> : null}
                  <span className="tabular-nums text-subtle-foreground">{index + 1}</span>
                  <span className="text-foreground">{step}</span>
                </li>
              ))}
            </ol>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <SampleDocumentButton primary />
              <Button asChild variant="outline"><Link href="/documents">{copy.overview.firstUse.addOwnPdf}<AppIcon className="size-4" name="arrowRight" /></Link></Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground" data-testid="overview-privacy-note">{copy.overview.firstUse.privacy}</p>
          </section>
        ) : (
          <section className="mt-6 rounded-lg border border-border bg-card p-4" data-testid="workspace-control-plane">
            <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <label className="mb-1.5 block text-xs font-medium text-foreground" htmlFor="overview-document">{labels.document}</label>
                <Select disabled={persistenceStatus !== "available" || documents.length === 0} onValueChange={(value) => void selectPersistedDocument(value)} value={activeDocumentId ?? ""}>
                  <SelectTrigger aria-label={labels.document} className={selectorTriggerClass} data-testid="overview-document-selector" id="overview-document" title={activeDocument?.fileName ?? labels.chooseDocument}><SelectValue placeholder={labels.chooseDocument} /></SelectTrigger>
                  <SelectContent>{documents.map((document) => <SelectItem className={selectorItemClass} key={document.id} value={document.id}>{document.fileName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="min-w-0">
                <label className="mb-1.5 block text-xs font-medium text-foreground" htmlFor="overview-pipeline">{labels.pipeline}</label>
                <Select disabled={!activeDocumentId || pipelines.length === 0} onValueChange={(value) => void selectPipeline(value)} value={activePipelineId ?? ""}>
                  <SelectTrigger aria-label={labels.pipeline} className={selectorTriggerClass} data-testid="overview-pipeline-selector" id="overview-pipeline" title={activePipeline?.name ?? labels.choosePipeline}>
                    {/* The trigger shows only the name; the "default" marker lives in the list. */}
                    <SelectValue placeholder={labels.choosePipeline}>{activePipeline ? activePipeline.name : undefined}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>{pipelines.map((pipeline) => (
                    <SelectItem className={selectorItemClass} key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}{pipeline.isDefault ? <span className="ml-1.5 text-xs font-normal text-subtle-foreground">{copy.common.defaultPipeline}</span> : null}
                    </SelectItem>
                  ))}</SelectContent>
                </Select>
              </div>
              <TransitionDetails className="relative self-end" data-testid="pipeline-management" ref={managementMenuRef} variant="dropdown">
                <summary className="flex h-9 cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary [&::-webkit-details-marker]:hidden">
                  <span>{labels.managePipeline}</span>
                  <AppIcon name="chevronDown" className="size-4 text-subtle-foreground" />
                </summary>
                <div className="absolute right-0 z-20 mt-2 flex w-[min(28rem,calc(100vw-4rem))] flex-wrap gap-2 rounded-md border border-border bg-card p-3 shadow-lg">
                  <Button disabled={!activeDocumentId || persistenceStatus !== "available" || managementBusy} onClick={beginCreatePipeline} size="sm" variant="secondary">{labels.newPipeline}</Button>
                  {activePipeline ? <Button onClick={() => void selectPipeline(null)} size="sm" variant="ghost" data-testid="clear-pipeline-selection">{labels.clearPipeline}</Button> : null}
                  <Button disabled={!activePipeline || managementBusy} onClick={beginRenamePipeline} size="sm" variant="outline">{labels.rename}</Button>
                  <Button disabled={!activePipeline || managementBusy} onClick={() => { setEditing(null); setManagementError(null); setConfirmDelete(true); closeManagementMenu(); }} size="sm" variant="ghost">{copy.common.delete}</Button>
                </div>
              </TransitionDetails>
            </div>

            <div className="mt-3.5 flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-border pt-3" data-testid="continue-surface">
              {isExceptionTone(continuationStatus.tone) ? <StatusPill className="mr-auto" tone={continuationStatus.tone}>{copy.status[continuation.state]}</StatusPill> : null}
              {continuation.kind === "checking" ? (
                <Button className="min-w-0 max-sm:w-full" data-testid="overview-continue-action" disabled>{copy.overview.continuation.checking}</Button>
              ) : (
                <Button asChild className="min-w-0 max-sm:w-full" data-testid="overview-continue-action">
                  <Link href={continuation.href}>{copy.overview.continuation[continuation.kind]}<AppIcon name="arrowRight" className="size-4" /></Link>
                </Button>
              )}
            </div>

            {editing ? (
              <TransitionPanel className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4" data-testid="pipeline-name-editor">
                <label className="sr-only" htmlFor="overview-pipeline-name">{labels.namePlaceholder}</label>
                <Input autoFocus className="max-w-sm" id="overview-pipeline-name" maxLength={100} onChange={(event) => setPipelineName(event.target.value)} placeholder={labels.namePlaceholder} value={pipelineName} />
                <Button disabled={!pipelineName.trim() || managementBusy} onClick={() => void savePipelineName()} size="sm">{managementBusy ? copy.common.saving : copy.common.save}</Button>
                <Button disabled={managementBusy} onClick={() => { setEditing(null); setManagementError(null); }} size="sm" variant="ghost">{copy.common.cancel}</Button>
              </TransitionPanel>
            ) : null}

            <DialogPrimitive.Root onOpenChange={(open) => { if (!open && !managementBusy) { setConfirmDelete(false); setManagementError(null); } }} open={confirmDelete && Boolean(activePipeline)}>
              {activePipeline ? <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="steplab-overlay fixed inset-0 z-50 bg-overlay/35 dark:bg-overlay/65" />
                <TransitionDialogContent className="fixed left-1/2 top-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl focus:outline-none sm:p-6" data-testid="delete-pipeline-dialog">
                  <DialogPrimitive.Title className="text-base font-semibold text-foreground">{labels.deleteTitle}</DialogPrimitive.Title>
                  <DialogPrimitive.Description className="mt-2 text-sm leading-6 text-muted-foreground"><span className="font-medium text-foreground [overflow-wrap:anywhere]">{activePipeline.name}</span> — {labels.deleteDescription}</DialogPrimitive.Description>
                  {managementError ? <p className="mt-3 text-sm text-destructive" role="alert">{managementError}</p> : null}
                  <div className="mt-5 flex justify-end gap-2">
                    <DialogPrimitive.Close asChild><Button disabled={managementBusy} size="sm" variant="outline">{copy.common.cancel}</Button></DialogPrimitive.Close>
                    <Button disabled={managementBusy} onClick={() => void confirmPipelineDelete()} size="sm" variant="destructive">{managementBusy ? copy.common.deleting : copy.common.delete}</Button>
                  </div>
                </TransitionDialogContent>
              </DialogPrimitive.Portal> : null}
            </DialogPrimitive.Root>
            {editing && managementError ? <p className="mt-2 text-sm text-destructive" role="alert">{managementError}</p> : null}

            {activeDocumentId && !activePipeline ? <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">{labels.noActivePipeline}</p> : null}
            {!activeDocumentId && documents.length > 0 ? <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">{labels.selectDocumentForPipeline}</p> : null}
            {persistenceStatus === "unavailable" ? <div className="mt-4 space-y-2 border-t border-border pt-3"><p className="text-xs leading-5 text-destructive">{labels.unavailable}</p><PipelineErrorMessage message={persistenceError?.message} /></div> : null}
          </section>
        )}

        <section className="mt-6 rounded-lg border border-border bg-card px-5 pb-4 pt-5" data-testid="overview-pipeline">
          <h2 className="m-0 text-base font-semibold text-foreground">{copy.overview.journey.title}</h2>
          <div className="relative mt-2 w-full overflow-hidden" data-testid="overview-journey">
            <div className="relative hidden h-54 w-full pt-3 min-[1440px]:block" data-testid="overview-journey-desktop">
              <div className="relative h-50 w-full">
                <div className="absolute top-1 h-48 rounded-lg border border-border-subtle bg-technical" data-testid="overview-group-prepare" style={journeyGroupPosition("prepare")}><span className="absolute left-3.5 top-3 text-xs font-medium text-muted-foreground">{groupLabels.prepare}</span></div>
                <div className="absolute top-1 h-48 rounded-lg border border-border-subtle bg-technical" data-testid="overview-group-test" style={journeyGroupPosition("test")}><span className="absolute left-3.5 top-3 text-xs font-medium text-muted-foreground">{groupLabels.test}</span></div>
                <div className="absolute top-1 h-48 rounded-lg border border-border-subtle bg-technical" data-testid="overview-group-measure" style={journeyGroupPosition("measure")}><span className="absolute left-3.5 top-3 text-xs font-medium text-muted-foreground">{groupLabels.measure}</span></div>
                <JourneyConnectors stateFor={(step) => pipelineState[step]} />
                {pipelineSteps.map((step) => <JourneyNode href={stageHref[step.key]} key={step.key} labels={journeyLabels} onReveal={setRevealedStep} reason={lockedReason(step.key)} state={pipelineState[step.key]} step={step} />)}
              </div>
            </div>
            <div className="min-[1440px]:hidden">
              <JourneyCompact labels={journeyLabels} reasonFor={lockedReason} stateFor={(step) => pipelineState[step]} />
            </div>
          </div>
          {/* Visible reason for the hovered/focused/tapped locked desktop node (Q9). */}
          <p aria-live="polite" className="mt-1 hidden min-h-5 text-xs text-muted-foreground min-[1440px]:block" data-testid="overview-journey-reason" id="overview-journey-reason">
            {revealedReason ? <><AppIcon aria-hidden="true" name="lock" className="mr-1.5 inline size-3.5 align-[-2px]" />{journeyLabels[revealedStep!]}: {revealedReason}</> : null}
          </p>
        </section>
      </div>
    </div>
  );
}
