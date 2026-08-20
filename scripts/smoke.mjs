import { readFile } from "node:fs/promises";
import process from "node:process";

const frontendUrl = (process.env.SMOKE_FRONTEND_URL ?? "http://localhost:3000").replace(/\/$/, "");
const apiUrl = (process.env.SMOKE_API_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 30_000);
const parseTimeoutMs = Number(process.env.SMOKE_PARSE_TIMEOUT_MS ?? 900_000);
const pdfPath = process.env.SMOKE_PDF_PATH ?? "";
const requireParse = process.env.SMOKE_REQUIRE_PARSE === "1";
const requireRag = process.env.SMOKE_REQUIRE_RAG === "1";
const requireJudge = process.env.SMOKE_REQUIRE_JUDGE === "1";
const requireSemantic = process.env.SMOKE_REQUIRE_SEMANTIC === "1";
const smokeQuery = process.env.SMOKE_QUERY ?? "What is the main topic of this document?";

const failures = [];

function fail(message) {
  failures.push(message);
}

function assertCondition(condition, message) {
  if (!condition) fail(message);
  return condition;
}

function withTimeout(signal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

async function request(url, init = {}) {
  const timeout = withTimeout(init.signal);
  try {
    return await fetch(url, { ...init, signal: timeout.signal });
  } finally {
    timeout.clear();
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function apiRequest(path, init = {}) {
  try {
    const response = await request(`${apiUrl}${path}`, {
      ...init,
      headers: init.body instanceof FormData
        ? init.headers
        : { "Content-Type": "application/json", ...init.headers },
    });
    return { response, payload: await readJson(response) };
  } catch (error) {
    fail(`${path} could not be reached (${error instanceof Error ? error.name : "unknown error"})`);
    return { response: null, payload: null };
  }
}

function encoded(value) {
  return encodeURIComponent(value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stage(payload, name) {
  return isObject(payload?.stageResults) && isObject(payload.stageResults[name])
    ? payload.stageResults[name]
    : null;
}

function stageCandidates(value) {
  if (!isObject(value)) return [];
  if (Array.isArray(value.candidates)) return value.candidates;
  if (Array.isArray(value.results)) return value.results;
  return [];
}

function parseRunStatus(payload) {
  if (payload?.status === "interrupted") return "failed";
  return payload?.status;
}

function parseRunId(payload) {
  return payload?.parseRunId ?? payload?.parse_run_id ?? payload?.id ?? null;
}

function parseResult(payload) {
  if (isObject(payload?.result)) return payload.result;
  if (isObject(payload?.parse)) return payload.parse;
  if (isObject(payload?.output)) return payload.output;
  return payload;
}

function isRetryablePollError(error) {
  return error?.retryable === true || error?.name === "AbortError" || error?.code === "ECONNREFUSED";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readParseRun(runId, documentId) {
  let response;
  try {
    response = await request(`${apiUrl}/parse-runs/${encoded(runId)}`);
  } catch (error) {
    error.retryable = true;
    throw error;
  }
  let payload = await readJson(response);
  if (response.status === 404 && documentId) {
    response = await request(`${apiUrl}/documents/${encoded(documentId)}/parse-runs/${encoded(runId)}`);
    payload = await readJson(response);
  }
  if (!response.ok) {
    const error = new Error(`parse run returned HTTP ${response.status}`);
    error.retryable = response.status >= 500 || response.status === 408 || response.status === 429;
    error.code = payload?.error?.code;
    throw error;
  }
  return payload;
}

async function waitForParseRun(initialPayload) {
  const runId = parseRunId(initialPayload);
  const documentId = initialPayload?.documentId ?? initialPayload?.document_id ?? null;
  if (!assertCondition(typeof runId === "string" && runId.length > 0, "parse accepted response did not return parseRunId")) return null;
  if (!assertCondition(parseRunStatus(initialPayload) === "queued" || parseRunStatus(initialPayload) === "running", "parse accepted response did not return queued/running status")) return null;
  console.log(`[smoke] parse: accepted (${parseRunStatus(initialPayload)})`);
  const deadline = Date.now() + parseTimeoutMs;
  let lastStatus = parseRunStatus(initialPayload);
  while (Date.now() < deadline) {
    await sleep(250);
    try {
      const payload = await readParseRun(runId, documentId);
      const status = parseRunStatus(payload);
      if (status !== lastStatus) {
        console.log(`[smoke] parse poll: ${status}`);
        lastStatus = status;
      }
      if (status === "completed") return parseResult(payload);
      if (status === "failed") {
        const code = payload?.error?.code ?? (payload?.status === "interrupted" ? "parse_interrupted" : "parse_failed");
        fail(`parse run failed (${code})`);
        return null;
      }
      if (status !== "queued" && status !== "running") {
        fail(`parse run returned invalid lifecycle status (${String(payload?.status)})`);
        return null;
      }
    } catch (error) {
      if (isRetryablePollError(error)) continue;
      fail(`parse polling failed (${error instanceof Error ? error.message : "unknown error"})`);
      return null;
    }
  }
  fail(`parse polling timed out after ${parseTimeoutMs}ms`);
  return null;
}

function assertSemanticRegression(payload) {
  if (!requireSemantic) return;
  const summary = payload?.summary;
  const elements = payload?.structured?.elements;
  const pages = payload?.structured?.pages;
  assertCondition(summary?.pageCount === 8, `semantic regression expected 8 pages, got ${summary?.pageCount ?? "unknown"}`);
  assertCondition(summary?.tableCount >= 9 && summary?.tableCount <= 11, `semantic regression expected 9-11 tables, got ${summary?.tableCount ?? "unknown"}`);
  assertCondition(summary?.headingCount >= 24 && summary?.headingCount <= 28, `semantic regression expected 24-28 headings, got ${summary?.headingCount ?? "unknown"}`);
  const validPageNumbers = Array.isArray(pages) && pages.length > 0 && pages.every((page) => Number.isInteger(page?.pageNumber) && page.pageNumber >= 1 && page.pageNumber <= summary.pageCount);
  assertCondition(validPageNumbers, "semantic regression returned invalid page provenance");
  const pageElementIds = new Set((pages ?? []).flatMap((page) => Array.isArray(page?.elements) ? page.elements.map((element) => element?.id) : []));
  const orphanElements = (elements ?? []).filter((element) => !pageElementIds.has(element?.id) || !Array.isArray(element?.pageNumbers) || element.pageNumbers.length === 0);
  assertCondition(orphanElements.length === 0, `semantic regression returned ${orphanElements.length} orphan elements`);
  const text = JSON.stringify(payload);
  for (const marker of ["BAT-S12", "INV-T17", "12,84 GWh", "%17,6", "%25"]) {
    assertCondition(text.includes(marker), `semantic regression is missing ${marker}`);
  }
  console.log("[smoke] semantic regression: ok (pages/tables/headings/provenance/content)");
}

async function checkHealth(name, url) {
  try {
    const response = await request(url);
    if (!response.ok) fail(`${name} returned HTTP ${response.status}`);
    else console.log(`[smoke] ${name}: ok`);
  } catch (error) {
    fail(`${name} could not be reached (${error instanceof Error ? error.name : "unknown error"})`);
  }
}

async function parsePdf() {
  if (!pdfPath) return null;

  try {
    const bytes = await readFile(pdfPath);
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "application/pdf" }), "smoke.pdf");
    const { response, payload } = await apiRequest("/documents/parse", { method: "POST", body: form });
    if (!response?.ok) {
      fail(`parse returned HTTP ${response?.status ?? "unknown"}`);
      return null;
    }

    const status = parseRunStatus(payload);
    let completedPayload = payload;
    if (status === "queued" || status === "running") {
      const documentId = payload?.documentId ?? payload?.document_id ?? payload?.document?.id;
      const duplicate = await apiRequest(`/documents/${encoded(documentId)}/parse`, { method: "POST" });
      const duplicateAccepted = duplicate.response?.ok && (duplicate.payload?.parseRunId ?? duplicate.payload?.parse_run_id) === parseRunId(payload);
      const duplicateRejected = duplicate.response?.status === 409;
      if (assertCondition(duplicateAccepted || duplicateRejected, `duplicate parse request was not guarded (HTTP ${duplicate.response?.status ?? "unknown"})`)) {
        console.log(`[smoke] duplicate parse guard: ok (${duplicateRejected ? "rejected" : "same run"})`);
      }
      completedPayload = await waitForParseRun(payload);
      if (!completedPayload) return null;
    } else if (status === "interrupted" || status === "failed") {
      fail(`parse returned failed lifecycle (${payload?.error?.code ?? (status === "interrupted" ? "parse_interrupted" : "parse_failed")})`);
      return null;
    }

    const valid = isObject(completedPayload?.document)
      && isObject(completedPayload?.structured)
      && Array.isArray(completedPayload.structured.elements)
      && completedPayload?.status === "completed";
    if (!assertCondition(valid, "parse returned an invalid normalized response")) return null;

    assertSemanticRegression(completedPayload);
    const elementCount = completedPayload.structured.elements.length;
    console.log(`[smoke] parse: ok (${elementCount} normalized elements)`);
    return completedPayload;
  } catch (error) {
    fail(`parse failed (${error instanceof Error ? error.name : "unknown error"})`);
    return null;
  }
}

async function checkParseFailureCases() {
  const invalidExtension = new FormData();
  invalidExtension.append("file", new Blob(["not a PDF"], { type: "text/plain" }), "smoke.txt");
  const invalidExtensionResult = await apiRequest("/documents/parse", {
    method: "POST",
    body: invalidExtension,
  });
  assertCondition(
    invalidExtensionResult.response?.status === 400,
    `invalid file failure case returned HTTP ${invalidExtensionResult.response?.status ?? "unknown"}`,
  );

  const invalidPdf = new FormData();
  invalidPdf.append("file", new Blob(["not a PDF"], { type: "application/pdf" }), "smoke.pdf");
  const invalidPdfResult = await apiRequest("/documents/parse", {
    method: "POST",
    body: invalidPdf,
  });
  assertCondition(
    invalidPdfResult.response?.status === 400,
    `invalid PDF failure case returned HTTP ${invalidPdfResult.response?.status ?? "unknown"}`,
  );
  if (invalidExtensionResult.response?.status === 400 && invalidPdfResult.response?.status === 400) {
    console.log("[smoke] parse failure cases: ok");
  }
}

function requireCompletedRun(payload, label) {
  const valid = isObject(payload) && typeof payload.id === "string" && payload.status === "completed";
  if (!assertCondition(valid, `${label} did not return a completed run`)) return false;
  return true;
}

async function runRagContract(parsePayload) {
  const documentId = parsePayload?.documentId ?? parsePayload?.document?.id;
  const parseRunId = parsePayload?.parseRunId;
  const firstElementId = parsePayload?.structured?.elements?.[0]?.id;
  if (!assertCondition(typeof documentId === "string" && documentId.length > 0, "parse did not return documentId")) return;
  if (!assertCondition(typeof parseRunId === "string" && parseRunId.length > 0, "parse did not return parseRunId")) return;
  if (!assertCondition(typeof firstElementId === "string" && firstElementId.length > 0, "parse did not return a source element id")) return;

  const documentPath = `/documents/${encoded(documentId)}`;
  const chunkRuns = {};
  for (const strategy of ["fixed_token", "recursive_token", "structure_aware"]) {
    const result = await apiRequest(`${documentPath}/chunks`, {
      method: "POST",
      body: JSON.stringify({
        parseRunId,
        strategy,
        config: { chunkSizeTokens: 256, overlapTokens: 32 },
      }),
    });
    if (!result.response?.ok) {
      fail(`chunk/${strategy} returned HTTP ${result.response?.status ?? "unknown"}`);
      continue;
    }
    if (!requireCompletedRun(result.payload, `chunk/${strategy}`)) continue;
    const chunks = Array.isArray(result.payload.chunks) ? result.payload.chunks : [];
    if (!assertCondition(chunks.length > 0, `chunk/${strategy} returned no chunks`)) continue;
    chunkRuns[strategy] = result.payload;
    console.log(`[smoke] chunk/${strategy}: ok (${chunks.length} chunks)`);
  }

  const selectedChunkRun = chunkRuns.structure_aware;
  if (!assertCondition(selectedChunkRun, "structure_aware chunk run is unavailable")) return;

  const embeddingResult = await apiRequest(`${documentPath}/embeddings`, {
    method: "POST",
    body: JSON.stringify({ chunkRunId: selectedChunkRun.id }),
  });
  if (!embeddingResult.response?.ok) {
    fail(`embedding returned HTTP ${embeddingResult.response?.status ?? "unknown"}`);
    return;
  }
  if (!requireCompletedRun(embeddingResult.payload, "embedding")) return;
  const embeddingCount = embeddingResult.payload.embeddingCount ?? embeddingResult.payload.embedding_count;
  assertCondition(embeddingCount > 0, "embedding returned no vectors");
  assertCondition(Number.isInteger(embeddingResult.payload.dimensions) && embeddingResult.payload.dimensions > 0, "embedding returned invalid dimensions");
  console.log(`[smoke] embedding: ok (${embeddingCount} vectors)`);

  const embeddingRunId = embeddingResult.payload.id;
  const commonExperiment = {
    documentId,
    chunkRunId: selectedChunkRun.id,
    embeddingRunId,
    query: smokeQuery,
    retrieval: { topK: 3 },
    reranking: { enabled: false, candidateCount: 6 },
    context: { tokenBudget: 512 },
    generation: { temperature: 0, maxOutputTokens: 256 },
  };

  for (const mode of ["dense", "keyword"]) {
    const result = await apiRequest("/experiments", {
      method: "POST",
      body: JSON.stringify({ ...commonExperiment, targetStage: "retrieval", retrieval: { mode, topK: 3 } }),
    });
    if (!result.response?.ok) {
      fail(`experiment/${mode} returned HTTP ${result.response?.status ?? "unknown"}`);
      continue;
    }
    if (!requireCompletedRun(result.payload, `experiment/${mode}`)) continue;
    const retrieval = stage(result.payload, "retrieval");
    assertCondition(stageCandidates(retrieval).length > 0, `experiment/${mode} returned no retrieval candidates`);
    console.log(`[smoke] experiment/${mode}: ok`);
  }

  const rerankResult = await apiRequest("/experiments", {
    method: "POST",
    body: JSON.stringify({
      ...commonExperiment,
      targetStage: "reranking",
      retrieval: { mode: "hybrid", topK: 3 },
      reranking: { enabled: true, candidateCount: 6 },
    }),
  });
  if (!rerankResult.response?.ok) {
    fail(`experiment/hybrid-rerank returned HTTP ${rerankResult.response?.status ?? "unknown"}`);
    return;
  }
  if (!requireCompletedRun(rerankResult.payload, "experiment/hybrid-rerank")) return;
  const hybridRetrieval = stage(rerankResult.payload, "retrieval");
  const reranking = stage(rerankResult.payload, "reranking");
  assertCondition(stageCandidates(hybridRetrieval).length > 0, "hybrid retrieval returned no candidates");
  assertCondition(stageCandidates(reranking).length > 0, "reranking returned no candidates");
  console.log("[smoke] experiment/hybrid-rerank: ok");

  const generationResult = await apiRequest("/experiments", {
    method: "POST",
    body: JSON.stringify({
      ...commonExperiment,
      targetStage: "generation",
      retrieval: { mode: "hybrid", topK: 3 },
      reranking: { enabled: true, candidateCount: 6 },
    }),
  });
  if (!generationResult.response?.ok) {
    const code = generationResult.payload?.error?.code;
    fail(`experiment/context-generation returned HTTP ${generationResult.response?.status ?? "unknown"}${code ? ` (${code})` : ""}`);
    return;
  }
  if (!requireCompletedRun(generationResult.payload, "experiment/context-generation")) return;
  const context = stage(generationResult.payload, "context");
  const generation = stage(generationResult.payload, "generation");
  const finalContext = context?.finalContext ?? context?.formattedContext;
  assertCondition(typeof finalContext === "string" && finalContext.length > 0, "context construction returned no context");
  assertCondition(typeof generation?.answer === "string" && generation.answer.length > 0, "generation returned no answer");
  assertCondition(Array.isArray(generation?.citations), "generation returned no citations array");
  console.log("[smoke] experiment/context-generation: ok");

  const datasetResult = await apiRequest("/evaluation/datasets", {
    method: "POST",
    body: JSON.stringify({
      documentId,
      parseRunId,
      name: `smoke-${Date.now()}`,
      cases: [{ question: smokeQuery, relevantElementIds: [firstElementId], referenceAnswer: null }],
    }),
  });
  if (!datasetResult.response?.ok) {
    fail(`evaluation dataset returned HTTP ${datasetResult.response?.status ?? "unknown"}`);
    return;
  }
  const datasetId = datasetResult.payload?.id;
  if (!assertCondition(typeof datasetId === "string" && datasetId.length > 0, "evaluation dataset returned no id")) return;
  console.log("[smoke] evaluation dataset: ok");

  const evaluationResult = await apiRequest("/evaluation/runs", {
    method: "POST",
    body: JSON.stringify({
      datasetId,
      chunkRunId: selectedChunkRun.id,
      embeddingRunId,
      retrieval: { mode: "hybrid", topK: 3 },
      reranking: { enabled: false, candidateCount: 6 },
      context: { tokenBudget: 512 },
      generation: { temperature: 0, maxOutputTokens: 256 },
      judge: requireJudge,
    }),
  });
  if (!evaluationResult.response?.ok) {
    fail(`evaluation run returned HTTP ${evaluationResult.response?.status ?? "unknown"}`);
    return;
  }
  if (!requireCompletedRun(evaluationResult.payload, "evaluation run")) return;
  const evaluationMetrics = evaluationResult.payload?.results?.aggregate ?? evaluationResult.payload?.results;
  assertCondition(isObject(evaluationMetrics), "evaluation run returned no metrics");
  if (requireJudge) assertCondition(typeof evaluationMetrics?.judgeModel === "string", "judge was required but no judge model was reported");
  console.log(`[smoke] evaluation run: ok${requireJudge ? " (judge enabled)" : ""}`);

  const detailResult = await apiRequest(documentPath);
  if (detailResult.response?.ok) {
    assertCondition(Array.isArray(detailResult.payload?.parseRuns), "document history has no parseRuns");
    assertCondition(Array.isArray(detailResult.payload?.chunkRuns), "document history has no chunkRuns");
    assertCondition(Array.isArray(detailResult.payload?.embeddingRuns), "document history has no embeddingRuns");
    assertCondition(Array.isArray(detailResult.payload?.experiments), "document history has no experiments");
    console.log("[smoke] document history: ok");
  } else {
    fail(`document history returned HTTP ${detailResult.response.status}`);
  }

  for (const [label, path] of [
    ["documents list", "/documents"],
    ["experiment history", `/experiments?documentId=${encoded(documentId)}`],
    ["evaluation datasets", `/evaluation/datasets?documentId=${encoded(documentId)}`],
    ["evaluation history", `/evaluation/runs?datasetId=${encoded(datasetId)}`],
  ]) {
    const result = await apiRequest(path);
    if (result.response?.ok && Array.isArray(result.payload?.items)) console.log(`[smoke] ${label}: ok`);
    else if (result.response?.ok) fail(`${label} returned no items array`);
    else fail(`${label} returned HTTP ${result.response?.status ?? "unknown"}`);
  }

  const rechunkResult = await apiRequest(`${documentPath}/chunks`, {
    method: "POST",
    body: JSON.stringify({
      parseRunId,
      strategy: "fixed_token",
      config: { chunkSizeTokens: 128, overlapTokens: 16 },
    }),
  });
  if (!rechunkResult.response?.ok || !requireCompletedRun(rechunkResult.payload, "rechunk")) {
    fail(`rechunk returned HTTP ${rechunkResult.response?.status ?? "unknown"}`);
    return;
  }
  const afterRechunk = await apiRequest(documentPath);
  const staleChunkAfterRechunk = afterRechunk.payload?.chunkRuns?.find((run) => run.id === selectedChunkRun.id);
  const staleEmbeddingAfterRechunk = afterRechunk.payload?.embeddingRuns?.find((run) => run.id === embeddingRunId);
  const staleExperimentAfterRechunk = afterRechunk.payload?.experiments?.find((run) => run.id === generationResult.payload.id);
  assertCondition(afterRechunk.payload?.activeChunkRunId === rechunkResult.payload.id, "rechunk did not replace the active chunk run");
  assertCondition(afterRechunk.payload?.activeEmbeddingRunId === null, "rechunk did not invalidate the active embedding run");
  assertCondition(staleChunkAfterRechunk?.isStale === true, "rechunk did not mark the previous chunk run stale");
  assertCondition(staleEmbeddingAfterRechunk?.isStale === true, "rechunk did not mark the previous embedding run stale");
  assertCondition(staleExperimentAfterRechunk?.isStale === true, "rechunk did not mark the previous experiment stale");
  console.log("[smoke] rechunk stale lineage: ok");

  const reparseResult = await apiRequest(`${documentPath}/parse`, { method: "POST" });
  if (!reparseResult.response?.ok) fail(`reparse returned HTTP ${reparseResult.response?.status ?? "unknown"}`);
  const reparsed = reparseResult.payload?.status === "queued" || reparseResult.payload?.status === "running"
    ? await waitForParseRun(reparseResult.payload)
    : reparseResult.payload;
  const reparsedDocumentId = reparsed?.documentId ?? reparsed?.document?.id ?? documentId;
  const reparsedParseRunId = reparsed?.parseRunId ?? reparsed?.parse_run_id;
  assertCondition(reparsedDocumentId === documentId, "reparse did not preserve document identity");
  assertCondition(typeof reparsedParseRunId === "string" && reparsedParseRunId !== parseRunId, "reparse did not create a new parse run");
  assertCondition(reparsed?.status === "completed", "reparse did not complete after polling");
  assertSemanticRegression(reparsed);
  const afterReparse = await apiRequest(documentPath);
  const oldChunkRun = afterReparse.payload?.chunkRuns?.find((run) => run.id === selectedChunkRun.id);
  const rechunkRun = afterReparse.payload?.chunkRuns?.find((run) => run.id === rechunkResult.payload.id);
  const oldEmbeddingRun = afterReparse.payload?.embeddingRuns?.find((run) => run.id === embeddingRunId);
  const oldExperiment = afterReparse.payload?.experiments?.find((run) => run.id === generationResult.payload.id);
  assertCondition(oldChunkRun?.isStale === true, "reparse did not mark the previous chunk run stale");
  assertCondition(rechunkRun?.isStale === true, "reparse did not mark the active rechunk run stale");
  assertCondition(oldEmbeddingRun?.isStale === true, "reparse did not mark the previous embedding run stale");
  assertCondition(oldExperiment?.isStale === true, "reparse did not mark the previous experiment stale");
  console.log("[smoke] reparse stale lineage: ok");
}

await checkHealth("frontend", `${frontendUrl}/`);
await checkHealth("backend health", `${apiUrl}/health`);

if (!pdfPath) {
  if (requireParse || requireRag) fail("a PDF path is required when parse or RAG smoke is required");
  else console.log("[smoke] parse: skipped (set SMOKE_PDF_PATH to run the real PDF check)");
}

let parsePayload = null;
if (pdfPath) {
  parsePayload = await parsePdf();
  await checkParseFailureCases();
}

if (requireRag) {
  if (parsePayload) await runRagContract(parsePayload);
  else fail("RAG smoke was requested but the parse prerequisite failed");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[smoke] ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`[smoke] all requested checks passed${requireRag ? " (full RAG contract)" : ""}`);
}
