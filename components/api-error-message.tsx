"use client";

import type { ReactNode } from "react";

import { TechnicalDetails } from "@/components/ui/disclosure";
import { Notice, type NoticeProps } from "@/components/ui/notice";
import { type DescribedApiError, describeApiError } from "@/lib/api-errors";
import { useCopy } from "@/lib/copy";

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

/** A failed request as an error Notice (announced once via role="alert"). */
export function ApiErrorNotice({ error, fallback, ...props }: Omit<NoticeProps, "tone" | "children"> & { error: unknown; fallback?: string | null }) {
  const described = describeApiError(useCopy(), error, fallback);
  if (!described) return null;
  return <Notice {...props} tone="error"><DescribedError described={described} /></Notice>;
}
