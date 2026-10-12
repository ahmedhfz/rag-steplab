"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import type { BlockerCode, PipelineAvailability } from "@/lib/blockers";
import { cn } from "@/lib/utils";

export type StageBlockerInput = Pick<PipelineAvailability, "allowed" | "code" | "message" | "href" | "requiredAction">;

type BlockerTone = "neutral" | "warning" | "error";

const tones: Record<BlockerTone, { text: string; icon: SemanticIconName; iconClass: string }> = {
  // A missing prerequisite is not a problem, only a locked step.
  neutral: { text: "text-tertiary", icon: "lock", iconClass: "text-fg-quaternary" },
  // A stale or incompatible lineage needs attention before results are usable.
  warning: { text: "text-warning-primary", icon: "history", iconClass: "text-fg-warning-primary" },
  error: { text: "text-error-primary", icon: "warning", iconClass: "text-fg-error-primary" },
};

function blockerTone(code: BlockerCode): BlockerTone {
  if (code === "backend_unavailable") return "error";
  if (code === "incompatible_lineage") return "warning";
  return "neutral";
}

/**
 * Explains why a stage action is unavailable and links to the step that
 * unblocks it. Missing prerequisites are neutral; only an unavailable service
 * or a stale/incompatible lineage is coloured. Nothing renders while loading.
 */
export function StageBlocker({ blocker, id, className, "data-testid": testId }: { blocker: StageBlockerInput | null | undefined; id?: string; className?: string; "data-testid"?: string }) {
  const pathname = usePathname();
  if (!blocker || blocker.allowed || !blocker.code || blocker.code === "loading") return null;
  const showAction = Boolean(blocker.href && blocker.requiredAction && blocker.href !== pathname);
  const tone = blockerTone(blocker.code);
  const t = tones[tone];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm", t.text, className)} data-code={blocker.code} data-testid={testId} data-tone={tone} id={id} role="status">
      <p className="flex min-w-0 items-start gap-2">
        <AppIcon className={cn("mt-0.5 size-4 shrink-0", t.iconClass)} name={t.icon} />
        <span className="min-w-0">{blocker.message}</span>
      </p>
      {showAction ? (
        <Link className="group/blocker inline-flex shrink-0 items-center gap-1 rounded-sm font-semibold text-primary underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current" href={blocker.href!}>
          {blocker.requiredAction}
          <AppIcon name="arrowRight" className="size-3.5 transition-transform duration-150 ease-out group-hover/blocker:translate-x-0.5 motion-reduce:transition-none" />
        </Link>
      ) : null}
    </div>
  );
}
