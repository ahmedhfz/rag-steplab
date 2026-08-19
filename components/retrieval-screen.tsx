"use client";

import { useState } from "react";
import { Copy, Play, RotateCcw, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UI_COPY } from "@/lib/copy";

const DEFAULT_TOP_K = "5";
const DEFAULT_MODE = "dense";
type RetrievalMode = "dense" | "hybrid" | "keyword";

export function RetrievalScreen() {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(DEFAULT_TOP_K);
  const [mode, setMode] = useState<RetrievalMode>(DEFAULT_MODE);
  const hasChanges = question.length > 0 || topK !== DEFAULT_TOP_K || mode !== DEFAULT_MODE;

  function reset() {
    setQuestion("");
    setTopK(DEFAULT_TOP_K);
    setMode(DEFAULT_MODE);
  }

  return (
    <div>
      <section className="px-4 py-6 sm:px-7">
        <h1 className="text-[22px] font-semibold tracking-[-0.025em]">{copy.retrieval.title}</h1>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <label className="sr-only" htmlFor="retrieval-question">{copy.retrieval.question}</label>
            <Input
              aria-label={copy.retrieval.question}
              className="h-12 pr-11 text-sm"
              id="retrieval-question"
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={copy.retrieval.questionPlaceholder}
              value={question}
            />
            <AnimatePresence initial={false}>
              {question && (
                <motion.div
                  animate={{ opacity: 1, scale: 1 }}
                  className="absolute right-1.5 top-1.5"
                  exit={{ opacity: 0, scale: 0.8 }}
                  initial={{ opacity: 0, scale: 0.8 }}
                  key="clear-question"
                  transition={{ duration: 0.14, ease: "easeOut" }}
                >
                  <Button aria-label={copy.retrieval.clearQuestion} onClick={() => setQuestion("")} size="icon" variant="ghost"><X aria-hidden="true" className="size-4" /></Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <Button aria-describedby="ask-disabled-reason" className="h-12 gap-2 px-8" disabled>
            <Play aria-hidden="true" className="size-4 fill-current" />{copy.retrieval.ask}
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500" id="ask-disabled-reason">{copy.retrieval.askUnavailable}</p>

        <div className="mt-4 flex flex-wrap items-center gap-x-7 gap-y-3 text-sm">
          <div className="flex items-center gap-2.5">
            <label className="font-medium" htmlFor="retrieval-top-k">{copy.retrieval.topK}</label>
            <Select onValueChange={setTopK} value={topK}>
              <SelectTrigger aria-label={copy.retrieval.topK} className="w-24" id="retrieval-top-k"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3</SelectItem>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="10">10</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2.5">
            <label className="font-medium" htmlFor="retrieval-mode">{copy.retrieval.mode}</label>
            <Select onValueChange={(value) => setMode(value as RetrievalMode)} value={mode}>
              <SelectTrigger aria-label={copy.retrieval.mode} className="w-32" id="retrieval-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="dense">{copy.retrieval.modes.dense}</SelectItem>
                <SelectItem value="hybrid">{copy.retrieval.modes.hybrid}</SelectItem>
                <SelectItem value="keyword">{copy.retrieval.modes.keyword}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2.5">
            <label className="font-medium" htmlFor="retrieval-reranker">{copy.retrieval.reranker}</label>
            <Select disabled value="not-configured">
              <SelectTrigger aria-describedby="reranker-disabled-reason" aria-label={copy.retrieval.reranker} className="w-44" id="retrieval-reranker"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="not-configured">{copy.retrieval.notConfigured}</SelectItem></SelectContent>
            </Select>
          </div>
          <Button aria-describedby={!hasChanges ? "retrieval-reset-disabled-reason" : undefined} className="ml-auto gap-2" disabled={!hasChanges} onClick={reset} size="sm" variant="ghost"><RotateCcw aria-hidden="true" className="size-4" />{copy.retrieval.reset}</Button>
        </div>
        <p className="mt-2 text-xs text-slate-500" id="reranker-disabled-reason">{copy.retrieval.rerankerUnavailable}</p>
        {!hasChanges && <p className="mt-2 text-xs text-slate-500" id="retrieval-reset-disabled-reason">{copy.retrieval.nothingToReset}</p>}
        {preferences.showLearningHints && <p className="mt-3 text-xs leading-5 text-slate-500"><span className="font-medium text-slate-700">{copy.common.learningHint}:</span> {copy.retrieval.hint[preferences.detailLevel]}</p>}
      </section>

      <section className="grid border-y lg:grid-cols-2">
        <div className="min-w-0 p-4 sm:p-7 lg:border-r">
          <h2 className="text-base font-semibold">{copy.retrieval.retrievedChunks}</h2>
          <div className="mt-4 overflow-x-auto border-t">
            <Table>
              <caption className="sr-only">{copy.retrieval.retrievedChunks}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.retrieval.rank}</TableHead>
                  <TableHead>{copy.retrieval.score}</TableHead>
                  <TableHead>{copy.retrieval.sourceDocument}</TableHead>
                  <TableHead>{copy.retrieval.page}</TableHead>
                  <TableHead className="min-w-52">{copy.retrieval.preview}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody><TableRow><TableCell className="h-24 text-center text-slate-500" colSpan={5}><motion.span animate={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 4 }} role="status" transition={{ duration: 0.18, ease: "easeOut" }}>{copy.retrieval.noResults}</motion.span></TableCell></TableRow></TableBody>
            </Table>
          </div>
          <p className="mt-4 text-xs text-slate-500">{copy.retrieval.resultsUnavailable}</p>
        </div>

        <div className="p-4 sm:p-7">
          <h2 className="text-base font-semibold">{copy.retrieval.generatedAnswer}</h2>
          <motion.p animate={{ opacity: 1, y: 0 }} className="mt-5 text-sm text-slate-500" initial={{ opacity: 0, y: 4 }} transition={{ duration: 0.18, delay: 0.04, ease: "easeOut" }}>{copy.retrieval.noAnswer}</motion.p>
        </div>
      </section>

      <section className="p-4 sm:p-7">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold">{copy.retrieval.trace}</h2>
          <Button aria-describedby="trace-disabled-reason" className="gap-2" disabled size="sm" variant="outline"><Copy aria-hidden="true" className="size-4" />{copy.retrieval.copyTrace}</Button>
        </div>
        <p className="mt-2 text-xs text-slate-500" id="trace-disabled-reason">{copy.retrieval.traceUnavailable}</p>
        <div className="mt-4 overflow-x-auto border-t">
          <Table>
            <caption className="sr-only">{copy.retrieval.trace}</caption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-7" />
                <TableHead>{copy.retrieval.time}</TableHead>
                <TableHead>{copy.retrieval.step}</TableHead>
                <TableHead>{copy.retrieval.component}</TableHead>
                <TableHead className="min-w-72">{copy.retrieval.details}</TableHead>
                <TableHead>{copy.retrieval.inputOutput}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody><TableRow><TableCell className="h-24 text-center text-slate-500" colSpan={6}><motion.span animate={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 4 }} role="status" transition={{ duration: 0.18, delay: 0.08, ease: "easeOut" }}>{copy.retrieval.noTrace}</motion.span></TableCell></TableRow></TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
