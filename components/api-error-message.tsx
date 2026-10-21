"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { TechnicalDetails } from "@/components/ui/disclosure";
import { Notice, type NoticeProps } from "@/components/ui/notice";
import { toast } from "@/components/ui/toast";
import { type DescribedApiError, describeApiError, isTrackingPaused } from "@/lib/api-errors";
import { type AppCopy, useCopy } from "@/lib/copy";

/** Raw code and message of a failed request; diagnostics stay one click away, never hidden. */
export function ApiErrorDetails({ technical, className }: { technical: NonNullable<DescribedApiError["technical"]>; className?: string }) {
  const copy = useCopy();
  return (
    <TechnicalDetails className={className} data-testid="api-error-details" summaryClassName="text-xs">
      <dl className="grid gap-1.5 text-xs text-tertiary">
        <div><dt className="inline font-medium">{copy.common.errorCode}: </dt><dd className="inline font-mono wrap-anywhere">{technical.code}</dd></div>
        {technical.message ? <div><dt className="inline font-medium">{copy.common.errorMessage}: </dt><dd className="inline break-words">{technical.message}</dd></div> : null}
      </dl>
    </TechnicalDetails>
  );
}

function DescribedError({ described, after }: { described: DescribedApiError; after?: ReactNode }) {
  return (
    <>
      <span className="block">{described.message}</span>
      {after}
      {described.technical ? <ApiErrorDetails className="mt-1.5" technical={described.technical} /> : null}
    </>
  );
}

/** Friendly localized sentence plus its Technical details, for inline error slots. */
export function ApiErrorText({ error, fallback, after }: { error: unknown; fallback?: string | null; after?: ReactNode }) {
  const described = describeApiError(useCopy(), error, fallback);
  return described ? <DescribedError after={after} described={described} /> : null;
}

type ApiErrorNoticeProps = Omit<NoticeProps, "tone" | "children" | "action"> & {
  error: unknown;
  fallback?: string | null;
  /** Repeats the failed action; shown as "Try again" next to the error. */
  onRetry?: () => void;
  /** Resumes browser tracking after a poll timeout; shown as "Resume tracking". */
  onResume?: () => void;
};

/**
 * A failed request as an error Notice (announced once via role="alert"), with its recovery action.
 * A poll timeout is not a failure: tracking paused while the run may still be working, so it is a
 * warning whose action resumes tracking.
 */
export function ApiErrorNotice({ error, fallback, onRetry, onResume, ...props }: ApiErrorNoticeProps) {
  const copy = useCopy();
  const described = describeApiError(copy, error, fallback);
  if (!described) return null;
  if (isTrackingPaused(error)) {
    return (
      <Notice
        {...props}
        action={onResume ? <Button iconLeading="refresh" onClick={onResume} size="sm" variant="secondary">{copy.common.resumeTracking}</Button> : undefined}
        data-error-kind="tracking-paused"
        icon="clock"
        tone="warning"
      >
        {described.message}
      </Notice>
    );
  }
  return (
    <Notice
      {...props}
      action={onRetry ? <Button iconLeading="refresh" onClick={onRetry} size="sm" variant="secondary">{copy.common.retry}</Button> : undefined}
      tone="error"
    >
      <DescribedError described={described} />
    </Notice>
  );
}

/**
 * Announces a background run that failed while the user may be elsewhere. The stage keeps the
 * inline ApiErrorNotice with the cause and recovery; the toast only carries the event.
 */
export function toastApiError(copy: AppCopy, title: string, error: unknown, fallback?: string | null) {
  if (isTrackingPaused(error)) return;
  const cause = describeApiError(copy, error, fallback)?.message;
  // A cause that only repeats the title ("… couldn't be created.") adds nothing.
  const sameAsTitle = cause?.replace(/[.!]+$/, "") === title.replace(/[.!]+$/, "");
  toast.error(title, { description: cause && !sameAsTitle ? cause : undefined });
}
