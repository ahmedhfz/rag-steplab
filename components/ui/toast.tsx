"use client";

import { Toaster as SonnerToaster, toast } from "sonner";

import { AppIcon } from "@/components/ui/app-icon";
import { usePreferences } from "@/components/preferences-provider";

/*
 * Toast — Sonner (sonner.emilkowal.ski, MIT), mounted once in app/layout.tsx via <Toaster/>.
 * Unstyled mode + StepLab tokens, so it follows the theme through CSS variables. Text colours carry
 * `!` because Sonner injects unlayered theme colours for title/description. Swipe or wait to dismiss.
 * Use for transient confirmations ("Copied", "Pipeline saved") and background failures;
 * never as the only place an error that blocks the page is shown.
 *
 *   import { toast } from "@/components/ui/toast";
 *   toast.success("Copied chunk id");
 *   toast.error("Embedding failed", { description: "Provider timed out." });
 *   toast.promise(run(), { loading: "Running…", success: "Done", error: "Failed" });
 */

export { toast };

export function Toaster() {
  const { preferences } = usePreferences();
  return (
    <SonnerToaster
      gap={8}
      icons={{
        // Confirmations stay neutral: green is reserved for verified results.
        success: <AppIcon className="size-5 text-fg-tertiary" name="completed" />,
        error: <AppIcon className="size-5 text-fg-error-primary" name="warning" />,
        warning: <AppIcon className="size-5 text-fg-warning-primary" name="warningTriangle" />,
        info: <AppIcon className="size-5 text-fg-tertiary" name="info" />,
        loading: <AppIcon className="size-5 animate-spin text-fg-brand-primary motion-reduce:animate-none" name="loading" />,
      }}
      position="bottom-right"
      theme={preferences.theme}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "group/toast relative flex w-full items-start gap-3 rounded-xl bg-primary_alt p-4 font-sans text-sm shadow-lg ring-1 ring-secondary_alt sm:w-[var(--width)]",
          title: "font-semibold text-primary!",
          description: "mt-0.5 text-tertiary!",
          icon: "mt-px shrink-0",
          content: "min-w-0 flex-1",
          actionButton: "ml-auto shrink-0 rounded-lg bg-brand-solid px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-solid_hover",
          cancelButton: "shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold text-tertiary hover:bg-primary_hover",
        },
      }}
    />
  );
}
