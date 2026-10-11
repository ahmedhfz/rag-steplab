import { ChunkingScreen } from "@/components/pipeline-stage-screens";
import { pageMetadata } from "@/lib/page-titles";

export const metadata = pageMetadata("chunking");

export default function ChunkingPage() {
  return <ChunkingScreen />;
}
