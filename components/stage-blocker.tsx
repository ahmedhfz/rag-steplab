"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { AppIcon } from "@/components/ui/app-icon";
import type { BlockerCode, PipelineAvailability } from "@/lib/blockers";
import { cn } from "@/lib/utils";

export type StageBlockerInput = Pick<PipelineAvailability, "allowed" | "code" | "message" | "href" | "requiredAction">;

function blockerTone(code: BlockerCode) {
  if (code === "backend_unavailable") return "text-destructive";
  if (code === "incompatible_lineage") return "text-warning";
  return "text-muted-foreground";
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
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm", blockerTone(blocker.code), className)} data-code={blocker.code} data-testid={testId} id={id} role="status">
      <p className="min-w-0">{blocker.message}</p>
      {showAction ? (
        <Link className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline" href={blocker.href!}>
          {blocker.requiredAction}
          <AppIcon name="arrowRight" className="size-3.5" />
        </Link>
      ) : null}
    </div>
  );
}
