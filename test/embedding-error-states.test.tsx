import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentApiError } from "@/lib/document-api";

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const pipeline = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("@/components/ui/toast", () => ({ toast: toastMock }));
vi.mock("@/components/document-pipeline-provider", () => ({
  useDocumentPipeline: () => pipeline.value,
}));

import { toastApiError } from "@/components/api-error-message";
import { ChunksPipeline } from "@/components/chunks-pipeline";
import { PreferencesProvider } from "@/components/preferences-provider";
import { UI_COPY } from "@/lib/copy";

const en = UI_COPY.en;

function embeddingsPipeline({ chunkCount = 166, inputsPerMinute = 100 as number | null, ...overrides }: Record<string, unknown> & { chunkCount?: number; inputsPerMinute?: number | null } = {}) {
  return {
    activeDocument: {
      id: "document-1",
      parseRuns: [{ id: "parse-1", status: "completed", isCompatible: true }],
      chunkRuns: [{ id: "chunk-1", status: "completed", isCompatible: true, chunkCount, upstream: { parseRunId: "parse-1" } }],
      embeddingRuns: [],
    },
    selectedParseRunId: "parse-1",
    selectedChunkRunId: "chunk-1",
    selectedEmbeddingRunId: null,
    parseResult: null,
    capabilities: { embeddingModel: "gemini-embedding-2", limits: inputsPerMinute === null ? {} : { embeddingInputsPerMinute: inputsPerMinute } },
    persistenceStatus: "available",
    chunkStatus: "completed",
    chunkRun: null,
    chunkError: null,
    embeddingStatus: "ready",
    embeddingRun: null,
    embeddingError: null,
    runChunking: vi.fn(),
    runEmbedding: vi.fn().mockResolvedValue(null),
    resumeEmbeddingTracking: vi.fn(),
    selectChunkRun: vi.fn(),
    selectEmbeddingRun: vi.fn(),
    ...overrides,
  };
}

function renderEmbeddings() {
  return render(<PreferencesProvider><ChunksPipeline stage="embeddings" /></PreferencesProvider>);
}

describe("embedding quota and error states", () => {
  beforeEach(() => {
    pipeline.value = embeddingsPipeline();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("warns before a large document how long the provider's per-minute quota makes it take", () => {
    renderEmbeddings();

    const notice = screen.getByTestId("embedding-quota-notice");
    expect(notice).toHaveTextContent("Embedding takes about 2 minutes");
    expect(notice).toHaveTextContent("166 chunks to embed, and the AI provider accepts up to 100 chunks a minute.");
    expect(notice).toHaveTextContent("you can leave this page");
    // Information, not a failure: it must not be announced as an alert.
    expect(notice).toHaveAttribute("role", "status");
  });

  it.each([
    ["fits in one quota window", { chunkCount: 100 }],
    ["the quota is unknown", { inputsPerMinute: null }],
    ["the quota is disabled", { inputsPerMinute: 0 }],
  ])("shows no duration warning when %s", (_label, overrides) => {
    pipeline.value = embeddingsPipeline(overrides);
    renderEmbeddings();

    expect(screen.queryByTestId("embedding-quota-notice")).not.toBeInTheDocument();
  });

  it("puts the estimate in the progress label while a large run is working", () => {
    pipeline.value = embeddingsPipeline({ chunkCount: 950, embeddingStatus: "processing" });
    renderEmbeddings();

    expect(screen.queryByTestId("embedding-quota-notice")).not.toBeInTheDocument();
    expect(screen.getAllByText("Embedding 950 chunks; about 10 minutes at the provider's rate limit.").length).toBeGreaterThan(0);
  });

  it("offers a retry next to a failed run and repeats the action", async () => {
    const runEmbedding = vi.fn().mockResolvedValue(null);
    pipeline.value = embeddingsPipeline({
      embeddingStatus: "error",
      embeddingError: new DocumentApiError("gemini_embedding_failed", "Gemini embedding failed (provider 503 UNAVAILABLE)."),
      runEmbedding,
    });
    const user = userEvent.setup();
    renderEmbeddings();

    const notice = screen.getByTestId("embedding-error");
    expect(notice).toHaveAttribute("role", "alert");
    expect(notice).toHaveTextContent(en.apiErrors.providerBusy);
    // The cause notice replaces the duration warning; one message at a time.
    expect(screen.queryByTestId("embedding-quota-notice")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: en.common.retry }));
    expect(runEmbedding).toHaveBeenCalledTimes(1);
  });

  it("does not offer a futile retry when the provider quota is exhausted", () => {
    pipeline.value = embeddingsPipeline({
      embeddingStatus: "error",
      embeddingError: new DocumentApiError("gemini_quota_exhausted", "Gemini embedding quota exhausted (provider 429 RESOURCE_EXHAUSTED)."),
    });
    renderEmbeddings();

    expect(screen.getByTestId("embedding-error")).toHaveTextContent(en.apiErrors.providerQuotaExhausted);
    expect(screen.queryByRole("button", { name: en.common.retry })).not.toBeInTheDocument();
  });

  it("shows paused tracking as a warning with a resume action and no spinning work", async () => {
    const resumeEmbeddingTracking = vi.fn();
    pipeline.value = embeddingsPipeline({
      embeddingStatus: "processing",
      embeddingError: new DocumentApiError("run_poll_timeout", "Browser tracking paused after 15 minutes."),
      resumeEmbeddingTracking,
    });
    const user = userEvent.setup();
    renderEmbeddings();

    const notice = screen.getByTestId("embedding-error");
    expect(notice).toHaveAttribute("data-tone", "warning");
    expect(notice).toHaveTextContent(en.apiErrors.trackingPaused);
    expect(screen.queryByRole("button", { name: en.common.retry })).not.toBeInTheDocument();
    expect(screen.getByTestId("embedding-run-action")).toHaveTextContent(en.embeddings.create);
    expect(screen.getByTestId("embedding-run-action")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: en.common.resumeTracking }));
    expect(resumeEmbeddingTracking).toHaveBeenCalledTimes(1);
  });
});

describe("toastApiError", () => {
  afterEach(() => vi.clearAllMocks());

  it("announces a background failure with its localized cause", () => {
    toastApiError(en, en.embeddings.failedToast, new DocumentApiError("gemini_quota_exhausted", "raw"), en.errors.embeddingFailed);
    expect(toastMock.error).toHaveBeenCalledWith(en.embeddings.failedToast, { description: en.apiErrors.providerQuotaExhausted });
  });

  it("drops a cause that only repeats the title and stays silent for paused tracking", () => {
    toastApiError(en, "The pipeline could not be saved", new DocumentApiError("unknown", "The pipeline could not be saved."));
    expect(toastMock.error).toHaveBeenLastCalledWith("The pipeline could not be saved", { description: undefined });

    toastMock.error.mockClear();
    toastApiError(en, en.embeddings.failedToast, new DocumentApiError("run_poll_timeout", "paused"));
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});
