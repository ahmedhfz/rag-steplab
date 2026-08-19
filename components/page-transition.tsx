"use client";

import { AnimatePresence, motion } from "motion/react";

export function PageTransition({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="min-w-0"
        exit={{ opacity: 0, y: -3 }}
        initial={{ opacity: 0, y: 3 }}
        key={pathname}
        transition={{ duration: 0.16, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
