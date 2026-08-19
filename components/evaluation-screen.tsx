"use client";

import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { motion } from "motion/react";

import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { UI_COPY } from "@/lib/copy";

export function EvaluationScreen() {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  return (
    <div>
      <section className="border-b px-4 py-7 sm:px-8 sm:py-9">
        <h1 className="text-[22px] font-semibold tracking-[-0.025em]">{copy.evaluation.title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{copy.evaluation.description}</p>
      </section>

      <section aria-labelledby="evaluation-empty-title" aria-live="polite" className="px-4 py-16 sm:px-8 sm:py-24">
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto flex max-w-xl flex-col items-center text-center"
          initial={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <motion.div
            animate={{ opacity: 1, scale: 1 }}
            initial={{ opacity: 0, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 360, damping: 26 }}
          >
            <BarChart3 aria-hidden="true" className="size-10 stroke-[1.4] text-slate-500" />
          </motion.div>
          <h2 className="mt-5 text-base font-semibold" id="evaluation-empty-title">{copy.evaluation.emptyTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{copy.evaluation.emptyDescription}</p>
          <p className="mt-3 text-xs leading-5 text-slate-500">{copy.evaluation.emptyNote}</p>
          <Button asChild className="mt-6" variant="outline">
            <Link href="/">{copy.common.backToOverview}</Link>
          </Button>
        </motion.div>
      </section>
    </div>
  );
}
