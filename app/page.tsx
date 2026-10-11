import { OverviewScreen } from "@/components/overview-screen";
import { pageMetadata } from "@/lib/page-titles";

export const metadata = pageMetadata("overview");

export default function OverviewPage() {
  return <OverviewScreen />;
}
