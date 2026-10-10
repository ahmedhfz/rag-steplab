import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForEvaluationRun, waitForExperimentRun, waitForPoll } from "@/lib/rag-api";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe.each(["experiment", "evaluation"] as const)("%s tracking", (kind) => {
  const wait = kind === "experiment" ? waitForExperimentRun : waitForEvaluationRun;
  const payload = (status: string) => ({ id: "run-1", status, documentId: "doc-1", chunkRunId: "chunk-1", query: "q", targetStage: "retrieval", stageResults: {}, datasetId: "dataset-1", results: {} });
  const response = (status: string) => new Response(JSON.stringify(status === "completed"
    ? { ...payload(status), stageResults: { retrieval: { candidates: [], durationMs: 1 } } }
    : payload(status)));

  it("retries deterministically, resets backoff, and only reads the same run", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(response("running"))
      .mockResolvedValueOnce(response("running"))
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(response("failed"))
      .mockResolvedValueOnce(response("failed"));
    vi.stubGlobal("fetch", fetch);
    const promise = wait("run-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_000);
    // A changed status is followed by exactly one detail read.
    expect(fetch).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(promise).resolves.toMatchObject({ id: "run-1", status: "failed" });
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toContain("run-1");
      expect(init.method).toBeUndefined();
    }
  });

  it("polls the lightweight status endpoint and reads the detail only when progress changes", async () => {
    vi.useFakeTimers();
    const statusPath = kind === "experiment" ? "/experiments/run-1/status" : "/evaluation/runs/run-1/status";
    let statusReads = 0;
    const fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith(statusPath)) statusReads += 1;
      return Promise.resolve(response(statusReads < 4 ? "running" : "completed"));
    });
    vi.stubGlobal("fetch", fetch);
    const promise = wait("run-1");
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(promise).resolves.toMatchObject({ status: "completed" });
    const detailReads = fetch.mock.calls.filter(([url]) => !String(url).endsWith(statusPath)).length;
    expect(statusReads).toBe(4);
    expect(detailReads).toBe(2);
  });

  it("fails instead of polling forever when a completed payload is invalid", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url.endsWith("/status")
      ? { id: "run-1", status: "completed" }
      : { id: "run-1", status: "completed", documentId: "doc-1", chunkRunId: "chunk-1", query: "q", targetStage: "generation", stageResults: {} }))));
    vi.stubGlobal("fetch", fetch);
    const failed = expect(wait("run-1")).rejects.toMatchObject({ code: "invalid_response" });
    await vi.advanceTimersByTimeAsync(0);
    await failed;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 404, 422])("does not retry HTTP %s", async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status }));
    vi.stubGlobal("fetch", fetch);
    await expect(wait("run-1")).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stops at 15 minutes, then starts a fresh read for the same ID", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response("{}", { status: 503 })));
    vi.stubGlobal("fetch", fetch);
    const failed = expect(wait("run-1")).rejects.toMatchObject({ code: "run_poll_timeout" });
    await vi.advanceTimersByTimeAsync(15 * 60 * 1_000);
    await failed;
    fetch.mockImplementation(() => Promise.resolve(response("failed")));
    await expect(wait("run-1")).resolves.toMatchObject({ status: "failed" });
  });
});

it("cleans up completed waits and cancels pending/already aborted waits", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const completed = waitForPoll(10, controller.signal);
  await vi.advanceTimersByTimeAsync(10);
  await completed;
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  const pending = expect(waitForPoll(10, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await pending;
  await expect(waitForPoll(10, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(vi.getTimerCount()).toBe(0);
});
