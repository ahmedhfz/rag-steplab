import { afterEach, describe, expect, it, vi } from "vitest";

import { continueExperiment, createDocumentPipeline, createEmbeddingRun, createExperimentAsync, deleteDocument, deleteDocumentPipeline, getChunkRun, getDocumentSummary, getEmbeddingRun, getEvaluationRun, getExperiment, getParseRun, listDocumentPipelines, listDocuments, parsePersistedDocument, rerunGeneration, updateDocumentPipeline, uploadDocument, waitForParseRun } from "@/lib/rag-api";

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

  it("hydrates a persisted parse result with OCR source provenance", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
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
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(getParseRun("parse-1", undefined, "document-1")).resolves.toMatchObject({
      id: "parse-1",
      status: "completed",
      result: { documentId: "document-1", parseRunId: "parse-1", markdown: "# RAG Basics",
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

    await expect(parsePersistedDocument("document-1")).resolves.toMatchObject({
      documentId: "document-1",
      parseRunId: "parse-1",
      reusedDocument: true,
    });
  });

  it("normalizes camelCase chunk runs and surfaces snake_case contract drift", async () => {
    const chunkPayload = {
      id: "chunk-run-1",
      status: "completed",
      config: { chunkSizeTokens: 128, overlapTokens: 16 },
      documentId: "document-1",
      parseRunId: "parse-run-1",
      strategy: "fixed_token",
      chunkCount: 1,
      chunks: [{
        id: "chunk-1",
        ordinal: 0,
        text: "Grounded source text",
        pageNumbers: [2],
        sourceElementIds: ["element-2"],
        headingPath: ["Introduction"],
        tokenCount: 4,
        characterCount: 20,
      }],
    };
    const json = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(chunkPayload)));

    const run = await getChunkRun("chunk-run-1");

    expect(run.documentId).toBe("document-1");
    expect(run.chunks[0]).toMatchObject({ pageNumbers: [2], sourceElementIds: ["element-2"] });
    expect(run.reusedArtifact).toBe(false);

    const { documentId, parseRunId, chunkCount, ...rest } = chunkPayload;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ ...rest, document_id: documentId, parse_run_id: parseRunId, chunk_count: chunkCount })));
    await expect(getChunkRun("chunk-run-1")).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("carries additive embedding reuse and effective-model provenance fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "embedding-run-1",
      status: "completed",
      config: {},
      documentId: "document-1",
      chunkRunId: "chunk-run-1",
      model: "gemini-embedding-2",
      dimensions: 768,
      embeddingFormatVersion: "gemini-embedding-2-qa-prefix-v1",
      embeddingCount: 1,
      effectiveModel: "gemini-embedding-2-001",
      startedAt: "2026-08-23T20:09:38.883931Z",
      completedAt: "2026-08-23T20:09:50.744289Z",
      durationMs: 11861,
      reusedArtifact: true,
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
    vi.useFakeTimers();
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
    const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
    const responses = [
      json(queued, 202),
      json({ id: "experiment-async", status: "running", stageStatuses: {} }),
      json({ ...queued, status: "running" }),
      json({ id: "experiment-async", status: "completed", stageStatuses: { retrieval: "completed" } }),
      json(completed),
    ];
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(responses.shift()));
    vi.stubGlobal("fetch", fetchMock);

    const result = createExperimentAsync({
      documentId: "document-1",
      chunkRunId: "chunk-1",
      embeddingRunId: null,
      query: "retrieval",
      targetStage: "retrieval",
      retrieval: { mode: "keyword", topK: 1 },
      reranking: { enabled: false, candidateCount: 10 },
      context: { tokenBudget: 3000 },
      generation: { temperature: 0.1, maxOutputTokens: 256 },
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toMatchObject({ id: "experiment-async", status: "completed" });
    vi.useRealTimers();
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["http://127.0.0.1:8000/experiments?async=true", "POST"],
      ["http://127.0.0.1:8000/experiments/experiment-async/status", undefined],
      ["http://127.0.0.1:8000/experiments/experiment-async", undefined],
      ["http://127.0.0.1:8000/experiments/experiment-async/status", undefined],
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

  it("fails a hung request with request_timeout instead of leaving it pending", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })));
    const pending = expect(listDocuments()).rejects.toMatchObject({ code: "request_timeout" });
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    vi.useRealTimers();
  });

  it("keeps a caller abort as AbortError rather than a timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) reject(new DOMException("aborted", "AbortError"));
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })));
    const controller = new AbortController();
    const pending = expect(listDocuments(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await pending;
  });

  describe("embedding run creation", () => {
    const embedding = (status: string, extra: Record<string, unknown> = {}) => ({
      id: "embedding-1",
      status,
      documentId: "document-1",
      chunkRunId: "chunk-1",
      model: "gemini-embedding",
      dimensions: 768,
      embeddingFormatVersion: "v1",
      ...extra,
    });

    it("returns a synchronous 200 completed run without polling", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(embedding("completed", { embeddingCount: 12 })), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(createEmbeddingRun("document-1", "chunk-1")).resolves.toMatchObject({ id: "embedding-1", status: "completed", embeddingCount: 12 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("polls an accepted 202 run until it completes", async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(embedding("queued", { embeddingCount: 0 })), { status: 202 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(embedding("running")), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(embedding("completed", { embeddingCount: 12 })), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const progress: string[] = [];
      const pending = createEmbeddingRun("document-1", "chunk-1", undefined, (run) => progress.push(run.status));
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(pending).resolves.toMatchObject({ id: "embedding-1", status: "completed", embeddingCount: 12 });
      expect(fetchMock.mock.calls.slice(1).map(([url]) => String(url))).toEqual([
        "http://127.0.0.1:8000/embedding-runs/embedding-1",
        "http://127.0.0.1:8000/embedding-runs/embedding-1",
      ]);
      expect(progress).toEqual(["running", "completed"]);
      vi.useRealTimers();
    });

    it("rejects with the run error when an accepted run fails", async () => {
      vi.useFakeTimers();
      vi.stubGlobal("fetch", vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(embedding("running")), { status: 202 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(embedding("failed", { errorCode: "worker_terminated", errorMessage: "The worker stopped." })), { status: 200 })));
      const failed = expect(createEmbeddingRun("document-1", "chunk-1")).rejects.toMatchObject({ code: "worker_terminated" });
      await vi.advanceTimersByTimeAsync(5_000);
      await failed;
      vi.useRealTimers();
    });
  });

  it("detaches its abort listener from a long-lived caller signal after each request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }))));
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await listDocuments(controller.signal);
    await listDocuments(controller.signal);
    const listeners = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === "abort").map(([, listener]) => listener);
    expect(listeners(add)).toHaveLength(2);
    expect(listeners(remove)).toEqual(listeners(add));
  });

  it("gives continue and rerun-generation the long request deadline", async () => {
    vi.useFakeTimers();
    const run = { id: "experiment-2", status: "completed", documentId: "doc-1", chunkRunId: "chunk-1", query: "q", targetStage: "retrieval", stageResults: { retrieval: { candidates: [], durationMs: 1 } } };
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      // Development backends run these inline, so the response can take well over 30 s.
      const timer = setTimeout(() => resolve(new Response(JSON.stringify(run), { status: 200 })), 60_000);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    })));
    for (const action of [continueExperiment, rerunGeneration]) {
      const pending = action("experiment-1");
      await vi.advanceTimersByTimeAsync(60_000);
      await expect(pending).resolves.toMatchObject({ id: "experiment-2", status: "completed" });
    }
    vi.useRealTimers();
  });

  it("keeps missing evaluation case metrics as null instead of a measured zero", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "evaluation-1",
      status: "completed",
      datasetId: "dataset-1",
      results: { aggregate: {}, caseResults: [{ question: "q", expectedElementIds: [], retrievedElementIds: [], citations: [] }] },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const run = await getEvaluationRun("evaluation-1");
    expect(run.caseResults?.[0]).toMatchObject({ citationValidity: null, groundedness: null });
  });

  it("normalizes retrieval score semantics, top-K results, answer segments and the grounding outcome", async () => {
    const candidate = (chunkId: string, rank: number) => ({ chunkId, rank, score: 0.4, text: `Source ${chunkId}`, documentId: "document-1", pageNumbers: [rank], sourceElementIds: [], headingPath: [] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "experiment-1",
      status: "completed",
      documentId: "document-1",
      chunkRunId: "chunk-1",
      embeddingRunId: "embedding-1",
      query: "query",
      targetStage: "generation",
      timing: { durationMs: 12_000, queueDurationMs: 9_500 },
      stageResults: {
        retrieval: {
          candidates: [candidate("chunk-1", 1), candidate("chunk-2", 2), candidate("chunk-3", 3)],
          results: [candidate("chunk-1", 1)],
          scoreSemantics: "relative_min_max_fusion_within_candidate_pool",
          timings: { queryEmbeddingMs: 820.4, candidateQueryMs: 1200, assemblyMs: 2.1 },
        },
        reranking: { status: "completed", results: [{ ...candidate("chunk-2", 1), originalRank: 2, rerankRank: 1, rankedBy: "retrieval_fallback", rerankInputTruncated: true }] },
        context: { selected: [], excluded: [], formattedContext: "", tokenBudget: 100, localTokenCount: 0 },
        generation: {
          answer: "",
          outcome: "grounding_rejected",
          insufficientContext: false,
          segments: [],
          citations: [],
          groundingFailureDetail: { code: "unsupported_factual_token", token: "2027", attempts: 2 },
        },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const run = await getExperiment("experiment-1");
    expect(run.queueDurationMs).toBe(9_500);
    expect(run.stageResults.retrieval).toMatchObject({
      scoreSemantics: "relative_min_max_fusion_within_candidate_pool",
      timings: { queryEmbeddingMs: 820.4, candidateQueryMs: 1200, assemblyMs: 2.1 },
    });
    // The pool stays available; the top-K list is what reached the context.
    expect(run.stageResults.retrieval?.candidates).toHaveLength(3);
    expect(run.stageResults.retrieval?.results?.map((item) => item.chunkId)).toEqual(["chunk-1"]);
    expect(run.stageResults.reranking?.candidates[0]).toMatchObject({ rankedBy: "retrieval_fallback", rerankInputTruncated: true });
    expect(run.stageResults.generation).toMatchObject({
      outcome: "grounding_rejected",
      insufficientContext: false,
      segments: [],
      groundingFailureDetail: { code: "unsupported_factual_token", token: "2027", attempts: 2 },
    });
  });

  it("keeps segments with their citation IDs and stays backward compatible without the new fields", async () => {
    const base = { id: "experiment-2", status: "completed", documentId: "document-1", chunkRunId: "chunk-1", embeddingRunId: null, query: "q", targetStage: "generation" };
    const citation = { citationId: "C1", documentId: "document-1", chunkId: "chunk-1", pageNumbers: [3], valid: true, sourceElementIds: [] };
    const stages = (generation: Record<string, unknown>) => ({
      retrieval: { candidates: [{ chunkId: "chunk-1", rank: 1, text: "t", documentId: "document-1" }] },
      reranking: { status: "skipped", candidates: [{ chunkId: "chunk-1", rank: 1, text: "t", documentId: "document-1" }] },
      context: { candidates: [], finalContext: "", tokenBudget: 10, tokenCount: 0 },
      generation: { citations: [citation], ...generation },
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...base, stageResults: stages({ answer: "A.\n\nB.", outcome: "answered", segments: [{ text: "A.", citationIds: ["C1"] }, { text: " ", citationIds: [] }, { text: "B.", citationIds: ["C1"] }] }) }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...base, stageResults: stages({ answer: "Legacy answer" }) }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const current = await getExperiment("experiment-2");
    expect(current.stageResults.generation?.segments).toEqual([{ text: "A.", citationIds: ["C1"] }, { text: "B.", citationIds: ["C1"] }]);
    const legacy = await getExperiment("experiment-2");
    expect(legacy.queueDurationMs).toBeNull();
    expect(legacy.stageResults.retrieval).toMatchObject({ results: null, scoreSemantics: null, timings: null });
    expect(legacy.stageResults.reranking?.candidates[0]).toMatchObject({ rankedBy: null, rerankInputTruncated: null });
    expect(legacy.stageResults.generation).toMatchObject({ outcome: null, segments: null, groundingFailureDetail: null });
  });

  it("normalizes evaluation methodology fields without turning missing metrics into zero", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "evaluation-2",
      status: "completed",
      datasetId: "dataset-1",
      results: {
        aggregate: {
          caseCount: 3,
          completedCaseCount: 2,
          failedCaseCount: 1,
          failedCaseCodes: [{ code: "citation_invalid", count: 1 }, { code: "", count: 4 }],
          hitAtK: 1,
          retrievalMetricsStage: "retrieval",
          stageRetrievalMetrics: { retrieval: { hitAtK: 1, precisionAtK: 0.5, recallAtK: 1, mrr: 1, eligibleCaseCount: 2 }, reranking: null, context: {} },
          citationValidity: null,
          citationValidityEligibleCaseCount: 0,
          answerableCaseCount: 2,
          falseAbstentionRate: 0.5,
          groundingRejectedCaseCount: 1,
          generationMetrics: { faithfulness: null, answerRelevance: null, answerCorrectness: null, lexicalOverlap: 0.62, method: "citation_token_overlap_v1", metricVersion: "v2", lexicalScoredCaseCount: 1, skippedCaseCount: 1 },
        },
        caseResults: [
          { question: "q1", expectedElementIds: [], retrievedElementIds: [], citations: [], status: "completed", generationOutcome: "grounding_rejected", generationMetrics: { faithfulness: null, lexicalOverlap: null, method: "citation_token_overlap_v1", skippedReason: "no_answer_segments" } },
          { question: "q2", expectedElementIds: [], retrievedElementIds: [], citations: [], status: "failed", errorCode: "citation_invalid", errorMessage: "Unknown citation.", answer: null, generationMetrics: null, experimentId: null },
          { question: "q3", expectedElementIds: [], retrievedElementIds: [], citations: [] },
        ],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const run = await getEvaluationRun("evaluation-2");
    expect(run.results).toMatchObject({
      completedCaseCount: 2,
      failedCaseCount: 1,
      failedCaseCodes: [{ code: "citation_invalid", count: 1 }],
      retrievalMetricsStage: "retrieval",
      stageRetrievalMetrics: { retrieval: { hitAtK: 1, precisionAtK: 0.5, eligibleCaseCount: 2 }, reranking: null, context: null },
      citationValidity: null,
      answerableCaseCount: 2,
      falseAbstentionRate: 0.5,
      groundingRejectedCaseCount: 1,
      generationMetrics: { faithfulness: null, lexicalOverlap: 0.62, method: "citation_token_overlap_v1", metricVersion: "v2", lexicalScoredCaseCount: 1 },
    });
    expect(run.caseResults?.[0]).toMatchObject({ status: "completed", generationOutcome: "grounding_rejected", generationMetrics: { lexicalOverlap: null, skippedReason: "no_answer_segments" } });
    expect(run.caseResults?.[1]).toMatchObject({ status: "failed", errorCode: "citation_invalid", errorMessage: "Unknown citation.", answer: null, generationMetrics: null, experimentId: "" });
    // Legacy cases without a status are completed; unknown fields stay null.
    expect(run.caseResults?.[2]).toMatchObject({ status: "completed", errorCode: null, generationOutcome: null });
  });

  it("does not fall back to the legacy document endpoint when the summary is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "document_not_found", message: "Missing" } }), { status: 404, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getDocumentSummary("document-1")).rejects.toMatchObject({ code: "document_not_found", status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
