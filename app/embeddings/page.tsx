import { EmbeddingsScreen } from "@/components/pipeline-stage-screens";
import { pageMetadata } from "@/lib/page-titles";

export const metadata = pageMetadata("embeddings");

export default function EmbeddingsPage() {
  return <EmbeddingsScreen />;
}
