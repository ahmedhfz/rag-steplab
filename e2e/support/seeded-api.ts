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
const pipelineId = "e2e-seeded-pipeline";

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

const stageResults = {
  retrieval: { candidates: [candidate], durationMs: 12, reuse: { reused: true, executed: false, sourceExperimentId: experimentId, sourceDurationMs: 12 } },
  reranking: { status: "skipped", candidates: [{ ...candidate, originalRank: 1, rerankScore: null }], durationMs: 0, method: null, reuse: { reused: false, executed: false, sourceExperimentId: null, sourceDurationMs: null } },
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
  config: { retrieval: { mode: "hybrid", topK: 3 }, reranking: { enabled: false }, context: { tokenBudget: 512 }, generation: { temperature: 0, maxOutputTokens: 96 } },
  stageResults,
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
  caseCount: 1,
  cases: [{ question: "What is the laboratory beacon code?", relevantElementIds: ["element-fact"], referenceAnswer: "ORBIT-731" }],
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
  results: {
    aggregate: { hitAtK: 1, recallAtK: 1, precisionAtK: 1, mrr: 1, citationValidity: 1, groundedness: 1, judgeModel: null, caseCount: 1 },
    caseResults: [{
      question: "What is the laboratory beacon code?",
      expectedElementIds: ["element-fact"],
      retrievedElementIds: ["element-fact"],
      referenceAnswer: "ORBIT-731",
      answer: "The laboratory beacon code is ORBIT-731 [S1].",
      citations: stageResults.generation.citations,
      hitAtK: 1,
      precisionAtK: 1,
      recallAtK: 1,
      mrr: 1,
      citationValidity: 1,
      groundedness: 1,
      groundednessDetail: {},
      experimentId,
    }],
  },
};

function summary(includeEmbedding = true) {
  return {
    ...document,
    activeEmbeddingRunId: includeEmbedding ? document.activeEmbeddingRunId : null,
    parseRuns: [{ ...runBase, id: parseRunId, runNumber: 1, phase: "completed", progress: 100, upstream: { documentId, parseRunId: null, chunkRunId: null, embeddingRunId: null } }],
    chunkRuns: [{ ...runBase, id: chunkRunId, runNumber: 1, strategy: "structure_aware", chunkCount: 1, upstream: { documentId, parseRunId, chunkRunId: null, embeddingRunId: null } }],
    embeddingRuns: includeEmbedding ? [{ ...runBase, id: embeddingRunId, runNumber: 1, model: embedding.model, dimensions: 768, embeddingCount: 1, embeddingFormatVersion: embedding.embeddingFormatVersion, upstream: { documentId, parseRunId, chunkRunId, embeddingRunId: null } }] : [],
    experiments: [{ ...runBase, id: experimentId, runNumber: 1, documentId, chunkRunId, embeddingRunId, query: experiment.query, targetStage: "generation", candidateCount: 1, experimentFingerprint: experiment.experimentFingerprint, stageStatuses: { retrieval: "completed", reranking: "skipped", context: "completed", generation: "completed" }, upstream: { documentId, parseRunId, chunkRunId, embeddingRunId } }],
    evaluationDatasets: [{ ...dataset, cases: undefined }],
    evaluationRuns: [{ id: evaluationRunId, datasetId, parseRunId, chunkRunId, embeddingRunId, status: "completed", timing: runBase.timing, error: null }],
  };
}

async function json(route: Route, value: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
}

export async function installSeededApi(page: Page) {
  const pdf = await readFile(generatedFixturePath);
  let parsePoll = 0;
  let experimentPoll = 0;
  let evaluationPoll = 0;
  let pipelineRevision = 1;
  let embeddingAvailable = true;

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const method = request.method();

    // UI rotaları ile aynı path'i kullanan API proxy çağrılarını yalnız request türüyle ayırıyoruz.
    // Böylece /documents sayfa navigasyonu JSON fixture tarafından ele geçirilmez.
    if (request.isNavigationRequest()) {
      await route.continue();
      return;
    }

    if (pathname === "/capabilities") return json(route, { embeddingModel: embedding.model, embeddingDimensions: 768, generationModel: experiment.stageResults.generation.model, rerankModel: "gemini-flash-lite-latest", judgeModel: "gemini-flash-lite-latest", embeddingFormatVersion: embedding.embeddingFormatVersion, limits: { maxTopK: 20 } });
    if (pathname === "/documents" && method === "GET") return json(route, { items: [document] });
    if (pathname === "/documents" && method === "POST") return json(route, { document, reusedDocument: true }, 200);
    if (pathname === `/documents/${documentId}/summary`) return json(route, summary(embeddingAvailable));
    if (pathname === `/documents/${documentId}/pipelines`) return json(route, [{ id: pipelineId, documentId, name: "Seeded indexing pipeline", parseRunId, chunkRunId, embeddingRunId, revision: 1, isDefault: true, createdAt: null, updatedAt: null }]);
    if (pathname === `/document-pipelines/${pipelineId}` && method === "PATCH") {
      const input = request.postDataJSON() as { parseRunId?: string | null; chunkRunId?: string | null; embeddingRunId?: string | null };
      pipelineRevision += 1;
      return json(route, {
        id: pipelineId,
        documentId,
        name: "Seeded indexing pipeline",
        parseRunId: input.parseRunId ?? parseRunId,
        chunkRunId: input.chunkRunId ?? null,
        embeddingRunId: input.embeddingRunId ?? null,
        revision: pipelineRevision,
        isDefault: true,
        createdAt: null,
        updatedAt: null,
      });
    }
    if (pathname === `/parse-runs/${parseRunId}`) return json(route, { id: parseRunId, documentId, status: "completed", progress: 100, phase: "completed", result: parseResult });
    if (pathname === "/parse-runs/e2e-seeded-reparse") {
      parsePoll += 1;
      if (parsePoll === 1) return json(route, { id: "e2e-seeded-reparse", documentId, status: "running", progress: 34, phase: "docling_starting", runMetadata: { progress: 34, phase: "docling_starting" } });
      return json(route, { id: "e2e-seeded-reparse", documentId, status: "completed", progress: 100, phase: "completed", result: { ...parseResult, parseRunId: "e2e-seeded-reparse" } });
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
    if (pathname === `/experiments/${experimentId}`) return json(route, experiment);
    if (pathname === "/experiments" && method === "POST") {
      experimentPoll = 0;
      return json(route, { ...experiment, id: "e2e-seeded-new-experiment", status: "queued", stageResults: {}, reusedExperiment: false });
    }
    if (pathname === "/experiments/e2e-seeded-new-experiment") {
      experimentPoll += 1;
      return json(route, experimentPoll === 1
        ? { ...experiment, id: "e2e-seeded-new-experiment", status: "running", stageResults: { retrieval: stageResults.retrieval }, reusedExperiment: false }
        : { ...experiment, id: "e2e-seeded-new-experiment", reusedExperiment: false });
    }
    if (pathname === `/evaluation/datasets/${datasetId}`) return json(route, dataset);
    if (pathname === "/evaluation/runs" && method === "GET") return json(route, { items: [evaluation] });
    if (pathname === `/evaluation/runs/${evaluationRunId}`) return json(route, evaluation);
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

export const seededIds = { documentId, parseRunId, chunkRunId, embeddingRunId, experimentId, datasetId, evaluationRunId };
