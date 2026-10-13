"use client";

import Link from "next/link";
import { type ReactNode, useEffect } from "react";

import { usePreferences } from "@/components/preferences-provider";
import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { Button, buttonStyles } from "@/components/ui/button";
import { TechnicalDetails } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { useCopy } from "@/lib/copy";
import { TITLE_TEMPLATE } from "@/lib/page-titles";

/** Shared frame for the not-found and error pages inside the signed-in shell. */
function RouteFallback({ icon, title, description, actions, children, testId }: { icon: SemanticIconName; title: string; description: string; actions: ReactNode; children?: ReactNode; testId: string }) {
  const { isHydrated } = usePreferences();
  // Route metadata is English; the tab follows the interface locale once preferences are known.
  useEffect(() => {
    if (isHydrated) document.title = TITLE_TEMPLATE.replace("%s", title);
  }, [isHydrated, title]);

  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="mx-auto w-full max-w-container p-10 max-md:p-4">
        <EmptyState action={actions} className={children ? "pt-24 pb-6" : "py-24"} description={description} icon={icon} title={title} titleAs="h1" />
        {children ? <div className="mx-auto flex max-w-sm justify-center">{children}</div> : null}
      </div>
    </div>
  );
}

function OverviewLink({ variant }: { variant: "primary" | "secondary" }) {
  const copy = useCopy();
  return (
    <Link className={buttonStyles({ variant, size: "lg" })} data-testid="route-fallback-overview-link" href="/">
      <AppIcon className="size-4" name="arrowLeft" />
      {copy.common.goToOverview}
    </Link>
  );
}

/** Unknown route: say so in the interface language and offer the way back. */
export function NotFoundScreen() {
  const labels = useCopy().notFound;
  return <RouteFallback actions={<OverviewLink variant="primary" />} description={labels.description} icon="fileSearch" testId="not-found-screen" title={labels.title} />;
}

/** Unexpected render error in a page: retry first, Overview as the way out, the digest for diagnostics. */
export function RouteErrorScreen({ digest, onRetry }: { digest?: string; onRetry: () => void }) {
  const copy = useCopy();
  const labels = copy.errorPage;
  return (
    <RouteFallback
      actions={<><Button onClick={onRetry} size="lg" variant="primary"><AppIcon className="size-4" name="refresh" />{labels.retry}</Button><OverviewLink variant="secondary" /></>}
      description={labels.description}
      icon="warningTriangle"
      testId="route-error-screen"
      title={labels.title}
    >
      {digest ? <TechnicalDetails><p className="font-mono text-xs text-tertiary wrap-anywhere">{digest}</p></TechnicalDetails> : null}
    </RouteFallback>
  );
}
