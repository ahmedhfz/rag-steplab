import type { Metadata } from "next";

import { NotFoundScreen } from "@/components/route-fallback";
import { UI_COPY } from "@/lib/copy";

// Server metadata is English like every route's; the screen localizes the tab title after hydration.
export const metadata: Metadata = { title: UI_COPY.en.notFound.title };

export default function NotFound() {
  return <NotFoundScreen />;
}
