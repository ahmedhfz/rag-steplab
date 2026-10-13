"use client";

import { RouteErrorScreen } from "@/components/route-fallback";

// Page-level error boundary inside the app shell; errors in the root layout itself are out of its reach.
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteErrorScreen digest={error.digest} onRetry={retry} />;
}
