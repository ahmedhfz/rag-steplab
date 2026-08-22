import { performance } from "node:perf_hooks";

const baseUrl = (process.env.RAG_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const documentId = process.env.RAG_DOCUMENT_ID;
const token = process.env.RAG_API_TOKEN;
const iterations = Math.max(1, Number(process.env.RAG_PERF_ITERATIONS || 10));

if (!documentId) {
  console.log(JSON.stringify({
    status: "skipped",
    reason: "RAG_DOCUMENT_ID is not set; no authenticated document was measured.",
    usage: "RAG_API_BASE_URL=... RAG_API_TOKEN=... RAG_DOCUMENT_ID=... npm run perf:phase6a",
  }, null, 2));
  process.exit(0);
}

const headers = token ? { Authorization: `Bearer ${token}` } : {};
const parseRunId = process.env.RAG_PARSE_RUN_ID;
const chunkRunId = process.env.RAG_CHUNK_RUN_ID;
const embeddingRunId = process.env.RAG_EMBEDDING_RUN_ID;
const beforePaths = [
  `/documents/${encodeURIComponent(documentId)}`,
  `/experiments?documentId=${encodeURIComponent(documentId)}`,
  `/evaluation/datasets?documentId=${encodeURIComponent(documentId)}`,
  ...(parseRunId ? [`/parse-runs/${encodeURIComponent(parseRunId)}`] : []),
  ...(chunkRunId ? [`/chunk-runs/${encodeURIComponent(chunkRunId)}`] : []),
  ...(embeddingRunId ? [`/embedding-runs/${encodeURIComponent(embeddingRunId)}`] : []),
];
const afterPaths = [`/documents/${encodeURIComponent(documentId)}/summary`];

async function sample(path) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const body = await response.arrayBuffer();
  const serverTiming = response.headers.get("server-timing");
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return {
    path,
    durationMs: Number((performance.now() - started).toFixed(1)),
    serverTiming,
    bytes: body.byteLength,
  };
}

async function composite(paths) {
  const samples = [];
  for (const path of paths) samples.push(await sample(path));
  return {
    requestCount: samples.length,
    payloadBytes: samples.reduce((total, item) => total + item.bytes, 0),
    browserMs: Number(samples.reduce((total, item) => total + item.durationMs, 0).toFixed(1)),
    backendServerTimingMs: samples.reduce((total, item) => {
      const match = item.serverTiming?.match(/app;dur=([0-9.]+)/);
      return total + (match ? Number(match[1]) : 0);
    }, 0),
  };
}

const coldCandidate = {
  before: await composite(beforePaths),
  after: await composite(afterPaths),
};
const warmBefore = [];
const warmAfter = [];
for (let index = 0; index < iterations; index += 1) {
  warmBefore.push(await composite(beforePaths));
  warmAfter.push(await composite(afterPaths));
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)];
}

function aggregate(values) {
  return {
    requestCount: values[0].requestCount,
    payloadBytes: { median: percentile(values.map((item) => item.payloadBytes), 0.5), p95: percentile(values.map((item) => item.payloadBytes), 0.95) },
    browserMs: { median: percentile(values.map((item) => item.browserMs), 0.5), p95: percentile(values.map((item) => item.browserMs), 0.95) },
    backendServerTimingMs: { median: percentile(values.map((item) => item.backendServerTimingMs), 0.5), p95: percentile(values.map((item) => item.backendServerTimingMs), 0.95) },
  };
}

console.log(JSON.stringify({
  status: "ok",
  baseUrl,
  documentId,
  iterations,
  before: { paths: beforePaths.length, coldCandidate: coldCandidate.before, warm: aggregate(warmBefore) },
  after: { paths: afterPaths.length, coldCandidate: coldCandidate.after, warm: aggregate(warmAfter) },
  note: "coldCandidate is first-request evidence only; force a Modal scale-to-zero window separately when measuring true cold start.",
}, null, 2));
