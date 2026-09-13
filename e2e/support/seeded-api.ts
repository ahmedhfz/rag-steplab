import { readFile } from "node:fs/promises";

import type { Page, Route } from "@playwright/test";

import { generatedFixturePath } from "./fixture-path";

const documentId = "e2e-seeded-document";
const parseRunId = "e2e-seeded-parse";
const chunkRunId = "e2e-seeded-chunk";
const embeddingRunId = "e2e-seeded-embedding";
const experimentId = "e2e-seeded-experiment";
const datasetId = "e2e-seeded-dataset";
const evaluationRunId = "e2e-seeded-evaluation";
const evaluationRunIdB = "e2e-seeded-evaluation-b";
const pipelineId = "e2e-seeded-pipeline";

export type SeededScenario =
  | "complete"
  | "documents-populated"
  | "parsing-result"
  | "chunking-config"
  | "chunking-result"
  | "embeddings-ready"
  | "embeddings-result"
  | "playground-empty"
  | "playground-retrieval"
  | "playground-reranking"
  | "playground-context"
  | "playground-answer"
  | "evaluation-dataset"
  | "evaluation-results"
  | "evaluation-compare"
  | "settings";

export type SeededApiOptions = {
  scenario?: SeededScenario;
  longNames?: boolean;
  theme?: "system" | "light" | "dark";
  ocrDiagnostics?: boolean;
};

export const seededStressNames = {
  document: "Karaman_RAG_StepLab_long_filename_for_single_line_select_geometry_validation.pdf",
  pipeline: "Karaman production indexing pipeline with structure-aware chunking and Gemini embeddings",
} as const;

type ScenarioDefinition = {
  chunk: boolean;
  embedding: boolean;
  experiment: "retrieval" | "reranking" | "context" | "generation" | null;
  dataset: boolean;
  evaluationCount: 0 | 1 | 2;
};

const scenarioDefinitions: Record<SeededScenario, ScenarioDefinition> = {
  complete: { chunk: true, embedding: true, experiment: "generation", dataset: true, evaluationCount: 1 },
  "documents-populated": { chunk: true, embedding: true, experiment: "generation", dataset: true, evaluationCount: 1 },
  "parsing-result": { chunk: false, embedding: false, experiment: null, dataset: false, evaluationCount: 0 },
  "chunking-config": { chunk: false, embedding: false, experiment: null, dataset: false, evaluationCount: 0 },
  "chunking-result": { chunk: true, embedding: false, experiment: null, dataset: false, evaluationCount: 0 },
  "embeddings-ready": { chunk: true, embedding: false, experiment: null, dataset: false, evaluationCount: 0 },
  "embeddings-result": { chunk: true, embedding: true, experiment: null, dataset: false, evaluationCount: 0 },
  "playground-empty": { chunk: true, embedding: true, experiment: null, dataset: false, evaluationCount: 0 },
  "playground-retrieval": { chunk: true, embedding: true, experiment: "retrieval", dataset: false, evaluationCount: 0 },
  "playground-reranking": { chunk: true, embedding: true, experiment: "reranking", dataset: false, evaluationCount: 0 },
  "playground-context": { chunk: true, embedding: true, experiment: "context", dataset: false, evaluationCount: 0 },
  "playground-answer": { chunk: true, embedding: true, experiment: "generation", dataset: false, evaluationCount: 0 },
  "evaluation-dataset": { chunk: true, embedding: true, experiment: "generation", dataset: true, evaluationCount: 0 },
  "evaluation-results": { chunk: true, embedding: true, experiment: "generation", dataset: true, evaluationCount: 1 },
  "evaluation-compare": { chunk: true, embedding: true, experiment: "generation", dataset: true, evaluationCount: 2 },
  settings: { chunk: true, embedding: true, experiment: "generation", dataset: true, evaluationCount: 1 },
};

const elements = [
  { id: "element-heading", type: "heading", pageNumbers: [1], text: "RAG StepLab Golden Fixture", level: 1, table: null },
  { id: "element-fact", type: "paragraph", pageNumbers: [1], text: "Golden fact: The laboratory beacon code is ORBIT-731.", level: null, table: null },
  { id: "element-list", type: "list", pageNumbers: [1], text: "Preserve page provenance and citations.", level: null, table: null },
  { id: "element-table", type: "table", pageNumbers: [2], text: "Beacon ORBIT-731", level: null, table: { rows: [["Field", "Value"], ["Beacon", "ORBIT-731"]] } },
];

const parseResult = {
  document: { id: documentId, fileName: "e2e-seeded-golden.pdf", mediaType: "application/pdf", sizeBytes: 1536, pageCount: 2 },
  structured: {
    pages: [
      { pageNumber: 1, elements: elements.slice(0, 3) },
      { pageNumber: 2, elements: elements.slice(3) },
    ],
    elements,
  },
  markdown: "# RAG StepLab Golden Fixture\n\nGolden fact: The laboratory beacon code is ORBIT-731.",
  summary: { pageCount: 2, headingCount: 1, paragraphCount: 1, listCount: 1, tableCount: 1 },
  documentId,
  parseRunId,
  status: "completed",
  runMetadata: { parser: "docling", phase: "completed", progress: 100 },
};

const document = {
  id: documentId,
  fileName: "e2e-seeded-golden.pdf",
  mediaType: "application/pdf",
  sizeBytes: 1536,
  pageCount: 2,
  sha256: "e2e-seeded-sha256",
  activeParseRunId: parseRunId,
  activeChunkRunId: chunkRunId,
  activeEmbeddingRunId: embeddingRunId,
  latestParseStatus: "completed",
  latestParseError: null,
  createdAt: "2026-08-24T00:00:00Z",
  updatedAt: "2026-08-24T00:00:10Z",
};

const runBase = {
  status: "completed",
  progress: null,
  isStale: false,
  isCompatible: true,
  compatibilityReason: null,
  historicalLineage: false,
  config: {},
  timing: { startedAt: "2026-08-24T00:00:00Z", completedAt: "2026-08-24T00:00:01Z", durationMs: 1000 },
  error: null,
};

const chunk = {
  ...runBase,
  id: chunkRunId,
  runNumber: 1,
  documentId,
  parseRunId,
  strategy: "structure_aware",
  upstream: { documentId, parseRunId, chunkRunId: null, embeddingRunId: null },
  chunkCount: 1,
  reusedArtifact: true,
  chunks: [{
    id: "e2e-seeded-chunk-item",
    ordinal: 0,
    text: "Golden fact: The laboratory beacon code is ORBIT-731.",
    pageNumbers: [1],
    sourceElementIds: ["element-fact"],
    headingPath: ["RAG StepLab Golden Fixture"],
    tokenCount: 11,
    characterCount: 57,
  }],
};

const embedding = {
  ...runBase,
  id: embeddingRunId,
  runNumber: 1,
  documentId,
  chunkRunId,
  upstream: { documentId, parseRunId, chunkRunId, embeddingRunId: null },
  model: "gemini-embedding-2",
  dimensions: 768,
  embeddingFormatVersion: "gemini-embedding-2:768:v1",
  embeddingCount: 1,
  effectiveModel: "gemini-embedding-2",
  reusedArtifact: true,
};

const candidate = {
  chunkId: "e2e-seeded-chunk-item",
  rank: 1,
  score: 0.95,
  denseScore: 0.92,
  keywordScore: 1,
  keywordRank: 1,
  rrfScore: 0.95,
  text: "Golden fact: The laboratory beacon code is ORBIT-731.",
  documentId,
  pageNumbers: [1],
  sourceElementIds: ["element-fact"],
  headingPath: ["RAG StepLab Golden Fixture"],
};

const fullStageResults = {
  retrieval: { candidates: [candidate], durationMs: 12, reuse: { reused: true, executed: false, sourceExperimentId: experimentId, sourceDurationMs: 12 } },
  reranking: { status: "skipped", candidates: [{ ...candidate, originalRank: 1, rerankRank: null, rerankScore: null }], durationMs: 0, method: null, reuse: { reused: false, executed: false, sourceExperimentId: null, sourceDurationMs: null } },
  context: {
    candidates: [{ chunkId: candidate.chunkId, selected: true, reason: "highest hybrid score", tokenCount: 11, text: candidate.text, pageNumbers: [1], sourceElementIds: ["element-fact"] }],
    finalContext: "[Source 1, page 1] Golden fact: The laboratory beacon code is ORBIT-731.",
    tokenBudget: 512,
    tokenCount: 18,
    durationMs: 4,
    reuse: { reused: true, executed: false, sourceExperimentId: experimentId, sourceDurationMs: 4 },
  },
  generation: {
    answer: "The laboratory beacon code is ORBIT-731 [S1].",
    citations: [{ citationId: "S1", documentId, chunkId: candidate.chunkId, pageNumbers: [1], quote: "laboratory beacon code is ORBIT-731", valid: true, sourceElementIds: ["element-fact"] }],
    model: "gemini-flash-lite-latest",
    inputTokens: 42,
    outputTokens: 14,
    durationMs: 30,
    insufficientContext: false,
    reuse: { reused: false, executed: true, sourceExperimentId: null, sourceDurationMs: null },
  },
};

const rerankingStageResults = {
  retrieval: fullStageResults.retrieval,
  reranking: { status: "completed", candidates: [{ ...candidate, originalRank: 1, rank: 1, rerankRank: 1, rerankScore: 1 }], durationMs: 18, method: "gemini-flash-lite-latest", rerankScoreSemantics: "deprecated_ordinal_not_confidence", reuse: { reused: false, executed: true, sourceExperimentId: null, sourceDurationMs: null } },
  context: null,
  generation: null,
};

const retrievalStageResults = {
  retrieval: fullStageResults.retrieval,
  reranking: null,
  context: null,
  generation: null,
};

const contextStageResults = {
  retrieval: fullStageResults.retrieval,
  reranking: fullStageResults.reranking,
  context: fullStageResults.context,
  generation: null,
};

const experiment = {
  ...runBase,
  id: experimentId,
  runNumber: 1,
  documentId,
  chunkRunId,
  embeddingRunId,
  query: "What is the laboratory beacon code?",
  targetStage: "generation",
  upstream: { documentId, parseRunId, chunkRunId, embeddingRunId },
  config: { retrieval: { mode: "hybrid", topK: 3 }, reranking: { enabled: false, candidateCount: 10 }, context: { tokenBudget: 512 }, generation: { temperature: 0, maxOutputTokens: 96 } },
  stageResults: fullStageResults,
  experimentFingerprint: "e2e-seeded-fingerprint",
  reusedExperiment: true,
  continuedFromExperimentId: null,
  generationRerun: false,
};

const dataset = {
  id: datasetId,
  documentId,
  parseRunId,
  name: "e2e-seeded-golden-dataset",
  version: 1,
  seriesId: "e2e-seeded-series",
  caseCount: 2,
  cases: [
    { question: "What is the laboratory beacon code?", relevantElementIds: ["element-fact"], referenceAnswer: "ORBIT-731", expectedOutcome: "answer" },
    { question: "What is the launch code?", relevantElementIds: [], referenceAnswer: null, expectedOutcome: "insufficient_context" },
  ],
  createdAt: "2026-08-24T00:00:00Z",
};

const evaluation = {
  ...runBase,
  id: evaluationRunId,
  datasetId,
  parseRunId,
  chunkRunId,
  embeddingRunId,
  upstream: { documentId, parseRunId, chunkRunId, embeddingRunId },
  config: {
    pipelineId,
    chunkRunId,
    embeddingRunId,
    retrieval: { mode: "hybrid", topK: 5 },
    reranking: { enabled: false, candidateCount: 10 },
    context: { tokenBudget: 3000 },
    generation: { temperature: 0.1, maxOutputTokens: 1024 },
    judge: false,
  },
  results: {
    aggregate: { hitAtK: 1, recallAtK: 1, precisionAtK: 1, mrr: 1, citationValidity: 1, groundedness: 1, judgeModel: "gemini-flash-lite-latest", caseCount: 2, retrievalEligibleCaseCount: 1, abstentionEligibleCaseCount: 1, abstentionAccuracy: 1, generationMetrics: { faithfulness: 1, answerRelevance: null, answerCorrectness: null, eligibleCaseCount: 0, scoredCaseCount: 2 } },
    caseResults: [{
      question: "What is the laboratory beacon code?",
      expectedElementIds: ["element-fact"],
      retrievedElementIds: ["element-fact"],
      referenceAnswer: "ORBIT-731",
      answer: "The laboratory beacon code is ORBIT-731 [S1].",
      citations: fullStageResults.generation.citations,
      hitAtK: 1,
      precisionAtK: 1,
      recallAtK: 1,
      mrr: 1,
      citationValidity: 1,
      groundedness: 1,
      groundednessDetail: {},
      generationMetrics: { faithfulness: 1, answerRelevance: null, answerCorrectness: null, eligibleCaseCount: 0, scoredCaseCount: 1 },
      experimentId,
      expectedOutcome: "answer",
      insufficientContext: false,
      retrievalEligible: true,
      abstentionCorrect: null,
    }, {
      question: "What is the launch code?",
      expectedElementIds: [],
      retrievedElementIds: [],
      referenceAnswer: null,
      answer: "",
      citations: [],
      hitAtK: null,
      precisionAtK: null,
      recallAtK: null,
      mrr: null,
      citationValidity: 1,
      groundedness: 1,
      groundednessDetail: {},
      generationMetrics: { faithfulness: 1, answerRelevance: null, answerCorrectness: null, eligibleCaseCount: 0, scoredCaseCount: 1 },
      experimentId: "e2e-seeded-no-answer-experiment",
      expectedOutcome: "insufficient_context",
      insufficientContext: true,
      retrievalEligible: false,
      abstentionCorrect: true,
    }],
  },
};

const evaluationB = {
  ...evaluation,
  id: evaluationRunIdB,
  timing: { startedAt: "2026-08-24T00:01:00Z", completedAt: "2026-08-24T00:01:02Z", durationMs: 1200 },
  config: {
    ...evaluation.config,
    retrieval: { mode: "dense", topK: 10 },
    reranking: { enabled: true, candidateCount: 20 },
    context: { tokenBudget: 2048 },
    generation: { temperature: 0.2, maxOutputTokens: 1024 },
    judge: true,
  },
  results: {
    aggregate: { hitAtK: 0.9, recallAtK: 0.8, precisionAtK: 0.9, mrr: 0.8, citationValidity: 0.95, groundedness: 0.9, judgeModel: "gemini-2.5-flash", caseCount: 2, retrievalEligibleCaseCount: 1, abstentionEligibleCaseCount: 1, abstentionAccuracy: 1, generationMetrics: { faithfulness: 0.9, answerRelevance: 0.85, answerCorrectness: 0.8, eligibleCaseCount: 1, scoredCaseCount: 1 } },
    caseResults: [{
      ...evaluation.results.caseResults[0],
      hitAtK: 0.9,
      precisionAtK: 0.9,
      recallAtK: 0.8,
      mrr: 0.8,
      citationValidity: 0.95,
      groundedness: 0.9,
      generationMetrics: { faithfulness: 0.9, answerRelevance: 0.85, answerCorrectness: 0.8, eligibleCaseCount: 1, scoredCaseCount: 1 },
    }, evaluation.results.caseResults[1]],
  },
};

function definitionFor(scenario: SeededScenario) {
  return scenarioDefinitions[scenario] ?? scenarioDefinitions.complete;
}

function experimentFor(scenario: SeededScenario) {
  const targetStage = definitionFor(scenario).experiment;
  if (!targetStage) return null;
  const stageResults = targetStage === "retrieval"
    ? retrievalStageResults
    : targetStage === "reranking"
      ? rerankingStageResults
      : targetStage === "context"
        ? contextStageResults
        : fullStageResults;
  const rerankerEnabled = targetStage === "reranking";
  return {
    ...experiment,
    targetStage,
    config: { ...experiment.config, reranking: { ...experiment.config.reranking, enabled: rerankerEnabled } },
    stageResults,
  };
}

function stageStatuses(targetStage: ScenarioDefinition["experiment"]) {
  if (!targetStage) return {};
  const statuses: Record<string, string> = { retrieval: "completed" };
  if (targetStage === "reranking") statuses.reranking = "completed";
  if (targetStage === "context") {
    statuses.reranking = "skipped";
    statuses.context = "completed";
  }
  if (targetStage === "generation") {
    statuses.reranking = "skipped";
    statuses.context = "completed";
    statuses.generation = "completed";
  }
  return statuses;
}

function scenarioState(scenario: SeededScenario, includeEmbedding = true) {
  const definition = definitionFor(scenario);
  const hasEmbedding = definition.embedding && includeEmbedding;
  const stateDocument = {
    ...document,
    activeChunkRunId: definition.chunk ? chunkRunId : null,
    activeEmbeddingRunId: hasEmbedding ? embeddingRunId : null,
  };
  const selectedExperiment = experimentFor(scenario);
  const evaluationRuns = definition.evaluationCount === 2
    ? [evaluationB, evaluation]
    : definition.evaluationCount === 1
      ? [evaluation]
      : [];
  return {
    document: stateDocument,
    pipeline: {
      id: pipelineId,
      documentId,
      name: "Seeded indexing pipeline",
      parseRunId,
      chunkRunId: definition.chunk ? chunkRunId : null,
      embeddingRunId: hasEmbedding ? embeddingRunId : null,
      revision: 1,
      isDefault: true,
      createdAt: null,
      updatedAt: null,
    },
    summary: {
      ...stateDocument,
      parseRuns: [{ ...runBase, id: parseRunId, runNumber: 1, phase: "completed", progress: 100, upstream: { documentId, parseRunId: null, chunkRunId: null, embeddingRunId: null } }],
      chunkRuns: definition.chunk ? [{ ...runBase, id: chunkRunId, runNumber: 1, strategy: "structure_aware", chunkCount: 1, upstream: { documentId, parseRunId, chunkRunId: null, embeddingRunId: null } }] : [],
      embeddingRuns: hasEmbedding ? [{ ...runBase, id: embeddingRunId, runNumber: 1, model: embedding.model, dimensions: 768, embeddingCount: 1, embeddingFormatVersion: embedding.embeddingFormatVersion, upstream: { documentId, parseRunId, chunkRunId, embeddingRunId: null } }] : [],
      experiments: selectedExperiment ? [{ ...runBase, id: experimentId, runNumber: 1, documentId, chunkRunId, embeddingRunId, query: experiment.query, targetStage: selectedExperiment.targetStage, candidateCount: 1, experimentFingerprint: experiment.experimentFingerprint, stageStatuses: stageStatuses(selectedExperiment.targetStage), upstream: { documentId, parseRunId, chunkRunId, embeddingRunId } }] : [],
      evaluationDatasets: definition.dataset ? [{ ...dataset, cases: undefined }] : [],
      evaluationRuns: evaluationRuns.map((run) => ({ id: run.id, datasetId, parseRunId, chunkRunId, embeddingRunId, status: "completed", timing: run.timing, error: null })),
    },
    experiment: selectedExperiment,
    evaluations: evaluationRuns,
  };
}

async function json(route: Route, value: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
}

export async function installSeededApi(page: Page, options: SeededApiOptions = {}) {
  const diagnosticElements = elements.map((element) => ({ ...element,
    sourceOrigin: element.id === "element-fact" ? "mixed" : "native_pdf",
    sourceRegions: element.id === "element-fact" ? [
      { pageNumber: 1, bbox: [30, 100, 300, 120], pageHeight: 842, coordinateOrigin: "TOPLEFT", origin: "ocr", confidence: .99062, text: element.text },
    ] : [],
  }));
  // Mock provenance exercises the UI contract; it is not a real OCR result.
  const selectedParseResult = options.ocrDiagnostics ? { ...parseResult, structured: {
    elements: diagnosticElements,
    pages: parseResult.structured.pages.map((page) => ({ ...page, elements: diagnosticElements.filter((element) => element.pageNumbers.includes(page.pageNumber)) })),
  } } : parseResult;
  const scenario = options.scenario ?? "complete";
  const pdf = await readFile(generatedFixturePath);
  let parsePoll = 0;
  let experimentPoll = 0;
  let evaluationPoll = 0;
  let pipelineRevision = 1;
  let embeddingAvailable = true;
  let documentDeleted = false;

  await page.addInitScript(({ theme }) => {
    // İlk navigation'da temizle; sonraki route navigation'larında seçili lineage korunmalıdır.
    if (!window.sessionStorage.getItem("rag-steplab-e2e-seeded-reset-v1")) {
      window.localStorage.setItem("rag-steplab.preferences.v3", JSON.stringify({ locale: "en", showLearningHints: true, theme }));
      window.localStorage.removeItem("rag-steplab.preferences.v2");
      window.localStorage.removeItem("rag-steplab.preferences.v1");
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("rag-steplab-active-document-id") || key.startsWith("rag-steplab-active-pipeline-id") || key.startsWith("rag-steplab-lineage-selections-v1")) {
          window.localStorage.removeItem(key);
        }
      }
      window.sessionStorage.setItem("rag-steplab-e2e-seeded-reset-v1", "1");
    }
  }, { theme: options.theme ?? "light" });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname.startsWith("/api/rag/")
      ? url.pathname.slice("/api/rag".length)
      : url.pathname;
    const method = request.method();
    const seededState = scenarioState(scenario, embeddingAvailable);
    const current = options.longNames
      ? {
          ...seededState,
          document: { ...seededState.document, fileName: seededStressNames.document },
          pipeline: { ...seededState.pipeline, name: seededStressNames.pipeline },
          summary: { ...seededState.summary, fileName: seededStressNames.document },
        }
      : seededState;
    const seededExperiment = current.experiment ?? experimentFor("complete") ?? experiment;

    // UI rotaları ile aynı path'i kullanan API proxy çağrılarını yalnız request türüyle ayırıyoruz.
    // Böylece /documents sayfa navigasyonu JSON fixture tarafından ele geçirilmez.
    if (request.isNavigationRequest()) {
      await route.continue();
      return;
    }

    if (pathname === "/capabilities") return json(route, { embeddingModel: embedding.model, embeddingDimensions: 768, generationModel: experiment.stageResults.generation.model, rerankModel: "gemini-flash-lite-latest", judgeModel: "gemini-flash-lite-latest", embeddingFormatVersion: embedding.embeddingFormatVersion, limits: { maxTopK: 20 } });
    if (pathname === "/documents" && method === "GET") return json(route, { items: documentDeleted ? [] : [current.document] });
    if (pathname === "/documents" && method === "POST") return json(route, { document: current.document, reusedDocument: true }, 200);
    if (pathname === `/documents/${documentId}` && method === "DELETE") {
      documentDeleted = true;
      return route.fulfill({ status: 204, body: "" });
    }
    if (pathname === `/documents/${documentId}/summary`) return json(route, current.summary);
    if (pathname === `/documents/${documentId}/pipelines` && method === "POST") {
      const input = request.postDataJSON() as { name: string; parseRunId?: string | null; chunkRunId?: string | null; embeddingRunId?: string | null };
      if (input.parseRunId !== null || input.chunkRunId !== null || input.embeddingRunId !== null) {
        return json(route, { error: { code: "lineage_not_reset", message: "A new pipeline must start with empty lineage." } }, 422);
      }
      return json(route, {
        ...current.pipeline,
        id: "e2e-seeded-new-pipeline",
        name: input.name,
        parseRunId: null,
        chunkRunId: null,
        embeddingRunId: null,
        revision: 1,
        isDefault: false,
      }, 201);
    }
    if (pathname === `/documents/${documentId}/pipelines` && method === "GET") return json(route, [current.pipeline]);
    if (pathname === `/document-pipelines/${pipelineId}` && method === "PATCH") {
      const input = request.postDataJSON() as { parseRunId?: string | null; chunkRunId?: string | null; embeddingRunId?: string | null };
      pipelineRevision += 1;
      return json(route, {
        ...current.pipeline,
        parseRunId: input.parseRunId ?? parseRunId,
        chunkRunId: input.chunkRunId ?? null,
        embeddingRunId: input.embeddingRunId ?? null,
        revision: pipelineRevision,
      });
    }
    if (pathname === `/parse-runs/${parseRunId}`) return json(route, { id: parseRunId, documentId, status: "completed", progress: 100, phase: "completed", result: selectedParseResult });
    if (pathname === "/parse-runs/e2e-seeded-reparse") {
      parsePoll += 1;
      if (parsePoll === 1) return json(route, { id: "e2e-seeded-reparse", documentId, status: "running", progress: 34, phase: "docling_starting", runMetadata: { progress: 34, phase: "docling_starting" } });
      return json(route, { id: "e2e-seeded-reparse", documentId, status: "completed", progress: 100, phase: "completed", result: { ...selectedParseResult, parseRunId: "e2e-seeded-reparse" } });
    }
    if (pathname === `/documents/${documentId}/parse` && method === "POST") return json(route, { id: "e2e-seeded-reparse", parseRunId: "e2e-seeded-reparse", documentId, status: "queued", progress: 0, phase: "queued", reusedDocument: true }, 202);
    if (pathname === `/chunk-runs/${chunkRunId}`) return json(route, chunk);
    if (pathname === `/embedding-runs/${embeddingRunId}`) return json(route, embedding);
    if (pathname === `/documents/${documentId}/chunks` && method === "POST") {
      embeddingAvailable = false;
      return json(route, chunk);
    }
    if (pathname === `/documents/${documentId}/embeddings` && method === "POST") {
      await new Promise((resolve) => setTimeout(resolve, 300));
      embeddingAvailable = true;
      return json(route, embedding);
    }
    if (pathname === `/experiments/${experimentId}`) return json(route, seededExperiment);
    if (pathname === "/experiments" && method === "POST") {
      experimentPoll = 0;
      return json(route, { ...experimentFor("complete"), id: "e2e-seeded-new-experiment", status: "queued", stageResults: {}, reusedExperiment: false });
    }
    if (pathname === "/experiments/e2e-seeded-new-experiment") {
      experimentPoll += 1;
      return json(route, experimentPoll === 1
        ? { ...experimentFor("complete"), id: "e2e-seeded-new-experiment", status: "running", stageResults: { retrieval: fullStageResults.retrieval }, reusedExperiment: false }
        : { ...experimentFor("complete"), id: "e2e-seeded-new-experiment", reusedExperiment: false });
    }
    if (pathname === "/evaluation/datasets" && method === "POST") return json(route, { ...dataset, id: "e2e-seeded-created-dataset" }, 201);
    if (pathname === `/evaluation/datasets/${datasetId}`) return json(route, dataset);
    if (pathname === "/evaluation/runs" && method === "GET") return json(route, { items: current.evaluations });
    if (pathname === `/evaluation/runs/${evaluationRunId}`) return json(route, evaluation);
    if (pathname === `/evaluation/runs/${evaluationRunIdB}`) return json(route, evaluationB);
    if (pathname === "/evaluation/runs" && method === "POST") {
      evaluationPoll = 0;
      return json(route, { ...evaluation, id: "e2e-seeded-evaluation-new", status: "queued", results: { aggregate: { caseCount: 1 }, caseResults: [] } });
    }
    if (pathname === "/evaluation/runs/e2e-seeded-evaluation-new") {
      evaluationPoll += 1;
      return json(route, evaluationPoll === 1
        ? { ...evaluation, id: "e2e-seeded-evaluation-new", status: "running", results: { aggregate: { caseCount: 1 }, caseResults: [] } }
        : { ...evaluation, id: "e2e-seeded-evaluation-new" });
    }
    if (pathname === `/documents/${documentId}/source-url`) return json(route, { sourceUrl: `/documents/${documentId}/source`, mode: "proxy", expiresIn: 60 });
    if (pathname === `/documents/${documentId}/source`) return route.fulfill({ status: 200, contentType: "application/pdf", body: pdf });

    await route.continue();
  });
}

export const seededIds = { documentId, parseRunId, chunkRunId, embeddingRunId, experimentId, datasetId, evaluationRunId, evaluationRunIdB };
