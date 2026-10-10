import { PipelineContextBar } from "@/components/pipeline-context-bar";
import { RetrievalScreen } from "@/components/retrieval-screen";
import { pageMetadata } from "@/lib/page-titles";

export const metadata = pageMetadata("playground");

export default function PlaygroundPage() {
  return <><div className="min-w-0 max-w-full overflow-x-clip" data-testid="playground-workspace-context"><PipelineContextBar /></div><RetrievalScreen /></>;
}
