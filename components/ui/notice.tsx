import type { ComponentProps, ReactNode } from "react";

import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { cn } from "@/lib/utils";

/*
 * Notice — inline callout for state the user should know about on this screen
 * (reuse notice, blocker, stale upstream). Neutral by default: colour only when the tone
 * means something (warning = needs attention, error = blocked/failed, success = verified).
 * Not for empty inputs (use a disabled button + hint) and not for transient feedback (toast).
 */

export type NoticeTone = "neutral" | "info" | "warning" | "error" | "success";

const tones: Record<NoticeTone, { root: string; icon: string; name: SemanticIconName }> = {
  neutral: { root: "bg-secondary text-secondary ring-secondary", icon: "text-fg-quaternary", name: "info" },
  info: { root: "bg-brand-primary text-secondary ring-utility-brand-200", icon: "text-fg-brand-primary", name: "info" },
  warning: { root: "bg-warning-primary text-secondary ring-utility-warning-200", icon: "text-fg-warning-primary", name: "warningTriangle" },
  error: { root: "bg-error-primary text-secondary ring-utility-error-200", icon: "text-fg-error-primary", name: "warning" },
  success: { root: "bg-success-primary text-secondary ring-utility-success-200", icon: "text-fg-success-primary", name: "completed" },
};

export type NoticeProps = Omit<ComponentProps<"div">, "title"> & {
  tone?: NoticeTone;
  title?: ReactNode;
  icon?: SemanticIconName | false;
  /** Trailing action (link-style Button). */
  action?: ReactNode;
};

export function Notice({ tone = "neutral", title, icon, action, className, children, role, ...props }: NoticeProps) {
  const t = tones[tone];
  return (
    <div
      {...props}
      className={cn("flex items-start gap-3 rounded-lg px-3.5 py-3 text-sm ring-1 ring-inset", t.root, className)}
      data-slot="notice"
      data-tone={tone}
      role={role ?? (tone === "error" ? "alert" : "status")}
    >
      {icon === false ? null : <AppIcon className={cn("mt-0.5 size-4 shrink-0", t.icon)} name={icon ?? t.name} />}
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold text-primary">{title}</p> : null}
        {children ? <div className={cn("text-tertiary", title && "mt-0.5")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}
