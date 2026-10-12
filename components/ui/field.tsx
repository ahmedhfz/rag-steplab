"use client";

import { Children, cloneElement, isValidElement, useId, type ComponentProps, type ReactElement, type ReactNode } from "react";

import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

/*
 * Label / HintText / Field — typography and states from Untitled UI React
 * `components/base/input/label.tsx` and `hint-text.tsx` (MIT), on native elements.
 */

export type LabelProps = ComponentProps<"label"> & {
  /** Shows the required marker. */
  required?: boolean;
  /** Help text behind a (?) icon next to the label. The icon sits outside <label> so it never joins the control's name. */
  tooltip?: ReactNode;
  /** Accessible name of the (?) button; pass localized copy. */
  tooltipLabel?: string;
};

export function Label({ required, tooltip, tooltipLabel = "More information", className, children, ...props }: LabelProps) {
  const label = (
    <label {...props} className={cn("flex w-fit cursor-default items-center gap-1 text-sm font-medium text-secondary", className)} data-slot="label">
      {children}
      {required ? <span aria-hidden="true" className="text-quaternary">*</span> : null}
    </label>
  );
  if (!tooltip) return label;
  return (
    <span className="flex w-fit items-center gap-1">
      {label}
      <InfoTip label={tooltipLabel} title={tooltip} />
    </span>
  );
}

export function HintText({ invalid, className, ...props }: ComponentProps<"p"> & { invalid?: boolean }) {
  return <p {...props} className={cn("text-sm", invalid ? "text-error-primary" : "text-tertiary", className)} data-slot="hint" />;
}

type FieldChildProps = { id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean | "true" | "false"; required?: boolean };

export type FieldProps = Omit<ComponentProps<"div">, "children"> & {
  label?: ReactNode;
  /** Supporting text under the control. Replaced by `error` when present. */
  hint?: ReactNode;
  /** Error message; marks the control aria-invalid. */
  error?: ReactNode;
  required?: boolean;
  tooltip?: ReactNode;
  tooltipLabel?: string;
  /**
   * One form control that spreads props onto its focusable element (Input, Textarea) — it receives
   * id/aria wiring — or a render function for composites:
   * `{(control) => <Select …><SelectTrigger {...control}>…</SelectTrigger></Select>}`.
   */
  children: ReactElement<FieldChildProps> | ((control: Required<Pick<FieldChildProps, "id">> & Omit<FieldChildProps, "id">) => ReactNode);
};

/** Label + control + hint/error, wired with ids. Keeps hints *under* the control so rows align. */
export function Field({ label, hint, error, required, tooltip, tooltipLabel, className, children, ...props }: FieldProps) {
  const autoId = useId();
  const messageId = `${autoId}-message`;
  const message = error ?? hint;
  const wiring = (existing?: FieldChildProps) => ({
    "aria-describedby": [existing?.["aria-describedby"], message ? messageId : undefined].filter(Boolean).join(" ") || undefined,
    "aria-invalid": error ? true : existing?.["aria-invalid"],
    required: required ?? existing?.required,
  });
  let controlId = `${autoId}-control`;
  let control: ReactNode;
  if (typeof children === "function") {
    control = children({ id: controlId, ...wiring() });
  } else {
    const child = Children.only(children);
    controlId = (isValidElement(child) && child.props.id) || controlId;
    control = cloneElement(child, { id: controlId, ...wiring(child.props) });
  }
  return (
    <div {...props} className={cn("flex min-w-0 flex-col gap-1.5", className)} data-slot="field">
      {label ? <Label htmlFor={controlId} required={required} tooltip={tooltip} tooltipLabel={tooltipLabel}>{label}</Label> : null}
      {control}
      {message ? <HintText id={messageId} invalid={Boolean(error)}>{message}</HintText> : null}
    </div>
  );
}
