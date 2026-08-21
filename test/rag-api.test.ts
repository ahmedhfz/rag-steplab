import { afterEach, describe, expect, it, vi } from "vitest";

import { getChunkRun, getDocument, getEmbeddingRun, getParseRun, listDocuments, parseAndPersistDocument, waitForParseRun } from "@/lib/rag-api";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("RAG API contract normalization", () => {
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
          elements: [{ id: "element-1", type: "heading", pageNumbers: [1], text: "RAG Basics", level: 1, table: null }],
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
      activeParseRun: { documentId: "document-1", parseRunId: "parse-1", markdown: "# RAG Basics" },
    });
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
      reused_artifact: true,
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(getEmbeddingRun("embedding-run-1")).resolves.toMatchObject({
      effectiveModel: "gemini-embedding-2-001",
      reusedArtifact: true,
    });
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
