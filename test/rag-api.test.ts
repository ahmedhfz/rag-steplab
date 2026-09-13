import { afterEach, describe, expect, it, vi } from "vitest";

import { continueExperiment, createDocumentPipeline, createExperimentAsync, deleteDocument, deleteDocumentPipeline, getChunkRun, getDocument, getDocumentSummary, getEmbeddingRun, getEvaluationRun, getExperiment, getParseRun, listDocumentPipelines, listDocuments, parseAndPersistDocument, rerunGeneration, updateDocumentPipeline, uploadDocument, waitForParseRun } from "@/lib/rag-api";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("RAG API contract normalization", () => {
  it("normalizes upload-only documents and keeps the parse endpoint out of the request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      document: {
        id: "document-1",
        fileName: "lesson.pdf",
        mediaType: "application/pdf",
        sizeBytes: 100,
        pageCount: 0,
        activeParseRunId: null,
        activeChunkRunId: null,
        activeEmbeddingRunId: null,
      },
      reusedDocument: true,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadDocument(new File(["%PDF-1.4"], "lesson.pdf", { type: "application/pdf" }))).resolves.toMatchObject({ document: { id: "document-1" }, reusedDocument: true });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8000/documents", expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/documents/parse"))).toBe(false);
  });

  it("accepts the canonical items list envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "document-1",
        fileName: "lesson.pdf",
        mediaType: "application/pdf",
        sizeBytes: 100,
        pageCount: 1,
        activeParseRunId: "parse-1",
        activeChunkRunId: null,
        activeEmbeddingRunId: null,
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(listDocuments()).resolves.toMatchObject([{ id: "document-1", fileName: "lesson.pdf" }]);
  });

  it("hydrates the active parse result from persisted document detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "document-1",
      fileName: "lesson.pdf",
      mediaType: "application/pdf",
      sizeBytes: 100,
      pageCount: 1,
      activeParseRunId: "parse-1",
      activeChunkRunId: null,
      activeEmbeddingRunId: null,
      parseRuns: [],
      chunkRuns: [],
      embeddingRuns: [],
      experiments: [],
      activeParseRun: {
        document: { fileName: "lesson.pdf", mediaType: "application/pdf", sizeBytes: 100, pageCount: 1 },
        structured: {
          pages: [{ pageNumber: 1, elements: [] }],
          elements: [{ id: "element-1", type: "heading", pageNumbers: [1], text: "RAG Basics", level: 1, table: null,
            sourceOrigin: "mixed", sourceRegions: [{ pageNumber: 1, bbox: [1, 2, 3, 4], coordinateOrigin: "TOPLEFT", origin: "ocr", confidence: .95, text: "RAG" }] }],
        },
        markdown: "# RAG Basics",
        summary: { pageCount: 1, headingCount: 1, paragraphCount: 0, listCount: 0, tableCount: 0 },
        documentId: "document-1",
        parseRunId: "parse-1",
        status: "completed",
        runMetadata: { parser: "docling" },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(getDocument("document-1")).resolves.toMatchObject({
      activeParseRun: { documentId: "document-1", parseRunId: "parse-1", markdown: "# RAG Basics",
        structured: { elements: [{ sourceOrigin: "mixed", sourceRegions: [{ origin: "ocr", confidence: .95, bbox: [1, 2, 3, 4] }] }] } },
    });
  });

  it("normalizes the lightweight document summary without artifact bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "document-1",
      fileName: "lesson.pdf",
      mediaType: "application/pdf",
      sizeBytes: 100,
      pageCount: 1,
      activeParseRunId: "parse-1",
      activeChunkRunId: "chunk-1",
      activeEmbeddingRunId: null,
      parseRuns: [{ id: "parse-1", status: "completed", isCompatible: true, upstream: {}, config: {}, timing: {} }],
      chunkRuns: [{ id: "chunk-1", status: "completed", isCompatible: true, strategy: "fixed_token", chunkCount: 2, upstream: { parseRunId: "parse-1" }, config: {}, timing: {} }],
      embeddingRuns: [],
      experiments: [{ id: "experiment-1", status: "completed", isCompatible: true, documentId: "document-1", chunkRunId: "chunk-1", embeddingRunId: null, query: "hello", targetStage: "retrieval", candidateCount: 2, stageStatuses: { retrieval: "completed", reranking: "skipped" }, config: {}, timing: {} }],
      evaluationDatasets: [{ id: "dataset-1", documentId: "document-1", parseRunId: "parse-1", name: "Smoke", version: 1, caseCount: 3, createdAt: null }],
      evaluationRuns: [{ id: "evaluation-1", datasetId: "dataset-1", parseRunId: "parse-1", chunkRunId: "chunk-1", embeddingRunId: null, status: "completed", timing: {}, error: null }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getDocumentSummary("document-1")).resolves.toMatchObject({
      id: "document-1",
      experiments: [{ id: "experiment-1", candidateCount: 2, stageStatuses: { retrieval: "completed", reranking: "skipped" } }],
      evaluationDatasets: [{ id: "dataset-1", caseCount: 3 }],
      evaluationRuns: [{ id: "evaluation-1", chunkRunId: "chunk-1" }],
    });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8000/documents/document-1/summary", expect.anything());
  });

  it("keeps nested answer-quality metrics available to the evaluation UI", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "evaluation-1",
      datasetId: "dataset-1",
      status: "completed",
      timing: {},
      upstream: {},
      results: {
        aggregate: {
          hitAtK: 1,
          recallAtK: 1,
          precisionAtK: 1,
          mrr: 1,
          citationValidity: 1,
          groundedness: 0.9,
          judgeModel: "judge",
          caseCount: 1,
          retrievalEligibleCaseCount: 1,
          abstentionEligibleCaseCount: 0,
          abstentionAccuracy: null,
          generationMetrics: { faithfulness: 0.9, answerRelevance: 0.8, answerCorrectness: 0.7, eligibleCaseCount: 1, scoredCaseCount: 1 },
        },
        caseResults: [],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(getEvaluationRun("evaluation-1")).resolves.toMatchObject({
      results: { generationMetrics: { faithfulness: 0.9, answerRelevance: 0.8, answerCorrectness: 0.7, eligibleCaseCount: 1, scoredCaseCount: 1 } },
    });
  });

  it("normalizes named pipeline CRUD and sends expectedRevision on PATCH", async () => {
    const pipeline = { id: "pipeline-1", documentId: "document-1", name: "Baseline", parseRunId: "parse-1", chunkRunId: null, embeddingRunId: null, revision: 1, isDefault: false, createdAt: null, updatedAt: null };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([pipeline]), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(pipeline), { status: 201, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...pipeline, revision: 2, name: "Renamed" }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listDocumentPipelines("document-1")).resolves.toEqual([pipeline]);
    await expect(createDocumentPipeline("document-1", { name: "Baseline", parseRunId: "parse-1" })).resolves.toMatchObject({ id: "pipeline-1" });
    await expect(updateDocumentPipeline("pipeline-1", { expectedRevision: 1, name: "Renamed" })).resolves.toMatchObject({ revision: 2 });
    await expect(deleteDocumentPipeline("pipeline-1")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[2][1]).toEqual(expect.objectContaining({ method: "PATCH", body: JSON.stringify({ expectedRevision: 1, name: "Renamed" }) }));
  });

  it("deletes a document through the owner-scoped endpoint and accepts 204", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteDocument("document/1")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8000/documents/document%2F1", expect.objectContaining({ method: "DELETE" }));
  });

  it("carries the existing reusedDocument flag through the persisted parse contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      document: { fileName: "lesson.pdf", mediaType: "application/pdf", sizeBytes: 100, pageCount: 1 },
      structured: { pages: [{ pageNumber: 1, elements: [] }], elements: [] },
      markdown: "# RAG Basics",
      summary: { pageCount: 1, headingCount: 0, paragraphCount: 0, listCount: 0, tableCount: 0 },
      documentId: "document-1",
      parseRunId: "parse-1",
      status: "completed",
      reusedDocument: true,
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(parseAndPersistDocument(new File(["%PDF-1.4"], "lesson.pdf", { type: "application/pdf" }))).resolves.toMatchObject({
      documentId: "document-1",
      parseRunId: "parse-1",
      reusedDocument: true,
    });
  });

  it("normalizes persisted snake_case chunk run responses without inventing values", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "chunk-run-1",
      status: "completed",
      config: { chunk_size_tokens: 128, overlap_tokens: 16 },
      document_id: "document-1",
      parse_run_id: "parse-run-1",
      strategy: "fixed_token",
      chunk_count: 1,
      chunks: [{
        id: "chunk-1",
        ordinal: 0,
        text: "Grounded source text",
        page_numbers: [2],
        source_element_ids: ["element-2"],
        heading_path: ["Introduction"],
        token_count: 4,
        character_count: 20,
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const run = await getChunkRun("chunk-run-1");

    expect(run.documentId).toBe("document-1");
    expect(run.chunks[0]).toMatchObject({ pageNumbers: [2], sourceElementIds: ["element-2"] });
    expect(run.reusedArtifact).toBe(false);
  });

  it("carries additive embedding reuse and effective-model provenance fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "embedding-run-1",
      status: "completed",
      config: {},
      document_id: "document-1",
      chunk_run_id: "chunk-run-1",
      model: "gemini-embedding-2",
      dimensions: 768,
      embedding_format_version: "gemini-embedding-2-qa-prefix-v1",
      embedding_count: 1,
      effective_model: "gemini-embedding-2-001",
      startedAt: "2026-08-23T20:09:38.883931Z",
      completedAt: "2026-08-23T20:09:50.744289Z",
      durationMs: 11861,
      reused_artifact: true,
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(getEmbeddingRun("embedding-run-1")).resolves.toMatchObject({
      effectiveModel: "gemini-embedding-2-001",
      reusedArtifact: true,
      timing: {
        startedAt: "2026-08-23T20:09:38.883931Z",
        completedAt: "2026-08-23T20:09:50.744289Z",
        durationMs: 11861,
      },
    });
  });

  it("normalizes stage reuse metadata and keeps history/continue/rerun endpoints explicit", async () => {
    const payload = {
      id: "experiment-1",
      status: "completed",
      documentId: "document-1",
      chunkRunId: "chunk-run-1",
      embeddingRunId: null,
      query: "retrieval",
      targetStage: "retrieval",
      experimentFingerprint: "experiment-fingerprint",
      reusedExperiment: true,
      stageResults: {
        retrieval: {
          status: "completed",
          fingerprint: "retrieval-fingerprint",
          resultHash: "result-hash",
          reuse: { reused: true, executed: false, sourceExperimentId: "source-run", sourceDurationMs: 12 },
          provenance: { cacheable: true, algorithmVersion: "retrieval-sql-rrf-v1" },
          results: [{
            chunkId: "chunk-1",
            rank: 1,
            text: "Grounded source text",
            documentId: "document-1",
            pageNumbers: [1],
            sourceElementIds: ["element-1"],
            headingPath: [],
          }],
        },
      },
    };
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getExperiment("experiment-1")).resolves.toMatchObject({
      id: "experiment-1",
      experimentFingerprint: "experiment-fingerprint",
      reusedExperiment: true,
      stageResults: { retrieval: { reuse: { reused: true, executed: false, sourceExperimentId: "source-run" } } },
    });
    await continueExperiment("experiment-1");
    await rerunGeneration("experiment-1");
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["http://127.0.0.1:8000/experiments/experiment-1", undefined],
      ["http://127.0.0.1:8000/experiments/experiment-1/continue", "POST"],
      ["http://127.0.0.1:8000/experiments/experiment-1/rerun-generation", "POST"],
    ]);
  });

  it("uses ordered reranking results while retaining provider input candidates", async () => {
    const candidate = (chunkId: string, rank: number) => ({
      chunkId,
      rank,
      score: 0.5,
      denseScore: 0.5,
      denseRank: rank,
      keywordScore: null,
      keywordRank: null,
      rrfScore: null,
      fusionScore: null,
      text: `Source ${chunkId}`,
      documentId: "document-1",
      pageNumbers: [1],
      sourceElementIds: [`element-${chunkId}`],
      headingPath: [],
      originalRank: rank,
      rerankRank: rank,
      rerankScore: null,
    });
    const payload = {
      id: "experiment-reranking",
      status: "completed",
      documentId: "document-1",
      chunkRunId: "chunk-1",
      embeddingRunId: "embedding-1",
      query: "query",
      targetStage: "reranking",
      stageResults: {
        retrieval: { status: "completed", candidates: [candidate("chunk-1", 1), candidate("chunk-2", 2)], results: [candidate("chunk-1", 1)] },
        reranking: {
          status: "completed",
          candidates: [candidate("chunk-1", 1), candidate("chunk-2", 2)],
          inputCandidates: [candidate("chunk-1", 1), candidate("chunk-2", 2)],
          results: [candidate("chunk-2", 1), candidate("chunk-1", 2)],
        },
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })));

    const result = await getExperiment("experiment-reranking");

    expect(result.stageResults.reranking?.candidates.map((item) => item.chunkId)).toEqual(["chunk-2", "chunk-1"]);
    expect(result.stageResults.reranking?.inputCandidates?.map((item) => item.chunkId)).toEqual(["chunk-1", "chunk-2"]);
  });

  it("uses one experiment state machine for a production 202 response", async () => {
    const queued = {
      id: "experiment-async",
      status: "queued",
      documentId: "document-1",
      chunkRunId: "chunk-1",
      embeddingRunId: null,
      query: "retrieval",
      targetStage: "retrieval",
      stageResults: {},
    };
    const completed = {
      ...queued,
      status: "completed",
      stageResults: {
        retrieval: {
          status: "completed",
          candidates: [],
          results: [],
          durationMs: 1,
        },
      },
    };
    const responses = [
      new Response(JSON.stringify(queued), { status: 202, headers: { "Content-Type": "application/json" } }),
      new Response(JSON.stringify(queued), { status: 200, headers: { "Content-Type": "application/json" } }),
      new Response(JSON.stringify(completed), { status: 200, headers: { "Content-Type": "application/json" } }),
    ];
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(responses.shift()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createExperimentAsync({
      documentId: "document-1",
      chunkRunId: "chunk-1",
      embeddingRunId: null,
      query: "retrieval",
      targetStage: "retrieval",
      retrieval: { mode: "keyword", topK: 1 },
      reranking: { enabled: false, candidateCount: 10 },
      context: { tokenBudget: 3000 },
      generation: { temperature: 0.1, maxOutputTokens: 256 },
    })).resolves.toMatchObject({ id: "experiment-async", status: "completed" });
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["http://127.0.0.1:8000/experiments?async=true", "POST"],
      ["http://127.0.0.1:8000/experiments/experiment-async", undefined],
      ["http://127.0.0.1:8000/experiments/experiment-async", undefined],
    ]);
  });

  it("fails closed when a completed run omits required result fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "chunk-run-1",
      status: "completed",
      config: {},
      document_id: "document-1",
      parse_run_id: "parse-run-1",
      strategy: "fixed_token",
      chunk_count: 1,
      chunks: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(getChunkRun("chunk-run-1")).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("preserves backend error codes and requires an explicit production API URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "document_not_found", message: "Missing" } }), { status: 404, headers: { "Content-Type": "application/json" } })));
    await expect(listDocuments()).rejects.toMatchObject({ code: "document_not_found" });

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "");
    await expect(listDocuments()).rejects.toMatchObject({ code: "configuration_error" });
  });

  it("maps the internal interrupted state to public failed without exposing a new status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "parse-run-1",
      documentId: "document-1",
      status: "interrupted",
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(getParseRun("parse-run-1")).resolves.toMatchObject({
      id: "parse-run-1",
      documentId: "document-1",
      status: "failed",
      error: { code: "parse_interrupted" },
    });
  });

  it("stops browser polling without changing a durable running job to failed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      parseRunId: "parse-run-1",
      documentId: "document-1",
      status: "running",
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const polling = waitForParseRun("parse-run-1", undefined, "document-1", undefined, 1);
    await expect(polling).rejects.toMatchObject({ code: "parse_poll_timeout" });
  });
});
