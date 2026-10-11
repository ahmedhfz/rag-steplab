import { EvaluationScreen } from "@/components/evaluation-screen";
import { PipelineContextBar } from "@/components/pipeline-context-bar";
import { pageMetadata } from "@/lib/page-titles";

export const metadata = pageMetadata("evaluation");

export default function EvaluationPage() {
  return <><PipelineContextBar /><EvaluationScreen /></>;
}
