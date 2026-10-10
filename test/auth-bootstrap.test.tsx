import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowserClient: () => ({ auth }),
  getSupabaseAccessToken: async () => "test-access-token",
}));

vi.unmock("@/components/auth-provider");

import { AuthProvider } from "@/components/auth-provider";
import { DocumentPipelineProvider, useDocumentPipeline } from "@/components/document-pipeline-provider";

function Probe() {
  const { persistenceStatus, persistenceError, workspaceStatus, refreshPersistence } = useDocumentPipeline();
  return (
    <div>
      <output data-testid="status">{persistenceStatus}:{workspaceStatus}:{persistenceError?.code ?? "none"}</output>
      <button onClick={() => void refreshPersistence()} type="button">Retry</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("auth bootstrap failures", () => {
  it("does not stay in checking when the initial user check fails, and can retry", async () => {
    auth.getUser.mockRejectedValueOnce(new Error("network down"));
    auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { name: "AuthSessionMissingError" } });
    render(<AuthProvider><DocumentPipelineProvider><Probe /></DocumentPipelineProvider></AuthProvider>);

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unavailable:unavailable:auth_unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(auth.getUser).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unavailable:unavailable:auth_required"));
  });
});
