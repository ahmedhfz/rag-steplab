"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, FileText } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { ChunksPipeline } from "@/components/chunks-pipeline";
import { DocumentLibrary } from "@/components/document-library";
import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { type AppCopy, type DocumentViewKey, UI_COPY } from "@/lib/copy";
import { formatDocumentFileSize } from "@/lib/document-file";
import type { DocumentParseResponse, ParsedElement, ParsedPage } from "@/lib/document-parse-types";
import type { PersistedDocument } from "@/lib/rag-api-types";
import { cn } from "@/lib/utils";

export type DocumentView = DocumentViewKey;

type ParsedView = "structured" | "markdown" | "json";

const documentTabs: Array<{ view: DocumentView; href: string }> = [
  { view: "overview", href: "/documents" },
  { view: "parsed", href: "/documents/parsed" },
  { view: "chunks", href: "/documents/chunks" },
];

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      aria-live="polite"
      className="flex min-h-32 items-center justify-center border-y px-6 py-8 text-center text-sm text-slate-500"
      initial={{ opacity: 0, y: 5 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

function SummaryGrid({ copy, result }: { copy: AppCopy["documents"]; result: DocumentParseResponse }) {
  const fields = [
    [copy.summaryFields.pageCount, result.summary.pageCount],
    [copy.summaryFields.headingCount, result.summary.headingCount],
    [copy.summaryFields.paragraphCount, result.summary.paragraphCount],
    [copy.summaryFields.listCount, result.summary.listCount],
    [copy.summaryFields.tableCount, result.summary.tableCount],
  ] as const;

  return (
    <motion.dl
      animate={{ opacity: 1, y: 0 }}
      className="grid grid-cols-2 gap-3 sm:grid-cols-5"
      initial={{ opacity: 0, y: 5 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {fields.map(([label, value], index) => (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="border px-3 py-2"
          initial={{ opacity: 0, y: 5 }}
          key={label}
          transition={{ duration: 0.16, delay: index * 0.035, ease: "easeOut" }}
        >
          <dt className="text-[11px] text-slate-500">{label}</dt>
          <dd className="mt-1 text-lg font-semibold">{value}</dd>
        </motion.div>
      ))}
    </motion.dl>
  );
}

function DocumentOverviewTab({ copy, selectedFile, persistedDocument, result, locale }: { copy: AppCopy["documents"]; selectedFile: File | null; persistedDocument: PersistedDocument | null; result: DocumentParseResponse | null; locale: "en" | "tr" }) {
  const fileName = selectedFile?.name ?? persistedDocument?.fileName;
  const sizeBytes = selectedFile?.size ?? persistedDocument?.sizeBytes;
  const pageCount = result?.document.pageCount ?? persistedDocument?.pageCount;
  return (
    <div className="grid border-t lg:grid-cols-2">
      <section className="p-4 sm:p-7 lg:border-r">
        <h2 className="text-sm font-semibold">{copy.document}</h2>
        <div className="mt-5">
          {fileName ? (
            <dl className="grid gap-3 border-y px-4 py-5 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">{copy.fileName}</dt>
                <dd className="max-w-[65%] truncate font-medium" title={fileName}>{fileName}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">{copy.size}</dt>
                <dd>{formatDocumentFileSize(sizeBytes ?? 0, locale)}</dd>
              </div>
              {pageCount !== undefined && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-500">{copy.pages}</dt>
                  <dd>{pageCount}</dd>
                </div>
              )}
            </dl>
          ) : (
            <EmptyState>
              <div>
                <p>{copy.noDocumentSelected}</p>
                <Button asChild className="mt-4" size="sm" variant="outline">
                  <Link className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400" href="/">{copy.chooseFromOverview} <ArrowUpRight aria-hidden="true" className="size-4" /></Link>
                </Button>
              </div>
            </EmptyState>
          )}
        </div>
      </section>

      <section className="border-t p-4 sm:p-7 lg:border-t-0">
        <h2 className="text-sm font-semibold">{copy.parseSummary}</h2>
        <div className="mt-5">
          {result ? <SummaryGrid copy={copy} result={result} /> : <EmptyState>{copy.noParseSummary}</EmptyState>}
        </div>
      </section>
    </div>
  );
}

function TableElement({ element }: { element: ParsedElement }) {
  const rows = element.table?.rows ?? [];
  if (rows.length === 0) return <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{element.text}</p>;

  const [header, ...body] = rows;
  return (
    <div className="overflow-x-auto border">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50">
          <tr>{header.map((cell, index) => <th className="border-b px-3 py-2 font-medium" key={`${cell}-${index}`}>{cell}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr className="border-b last:border-b-0" key={rowIndex}>
              {row.map((cell, cellIndex) => <td className="px-3 py-2 align-top" key={`${cell}-${cellIndex}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StructuredElement({ copy, element, index }: { copy: AppCopy["documents"]; element: ParsedElement; index: number }) {
  return (
    <motion.article
      animate={{ opacity: 1, x: 0 }}
      className="border-b px-4 py-5 last:border-b-0 sm:px-6"
      exit={{ opacity: 0, x: -5 }}
      initial={{ opacity: 0, x: 5 }}
      layout
      transition={{ duration: 0.18, delay: index * 0.035, ease: "easeOut" }}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">
        <span className="rounded border px-2 py-1">{copy.elementTypes[element.type]}</span>
        {element.pageNumbers.length > 0 && <span>{copy.page} {element.pageNumbers.join(", ")}</span>}
      </div>
      {element.type === "table" ? <TableElement element={element} /> : element.type === "list" ? (
        <ul className="list-disc pl-5 text-sm leading-6 text-slate-700"><li>{element.text}</li></ul>
      ) : element.type === "heading" ? (
        <h3 className="text-base font-semibold leading-6">{element.text}</h3>
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{element.text}</p>
      )}
    </motion.article>
  );
}

function PageList({ copy, pages, selectedPageNumber, onSelect }: { copy: AppCopy["documents"]; pages: ParsedPage[]; selectedPageNumber: number | null; onSelect: (pageNumber: number) => void }) {
  return (
    <div className="relative divide-y">
      {pages.map((page) => (
        <button
          aria-pressed={page.pageNumber === selectedPageNumber}
          className={cn("relative flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400", page.pageNumber === selectedPageNumber && "bg-slate-100 font-medium")}
          key={page.pageNumber}
          onClick={() => onSelect(page.pageNumber)}
          type="button"
        >
          {page.pageNumber === selectedPageNumber && <motion.span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 bg-slate-950" layoutId="parsed-page-active" transition={{ type: "spring", stiffness: 500, damping: 35 }} />}
          <span>{copy.page} {page.pageNumber}</span>
          <span className="text-xs text-slate-500">{page.elements.length} {copy.pageElements}</span>
        </button>
      ))}
    </div>
  );
}

function StructuredView({ copy, page }: { copy: AppCopy["documents"]; page: ParsedPage | undefined }) {
  if (!page) return <EmptyState>{copy.noParsedElements}</EmptyState>;
  if (page.elements.length === 0) return <EmptyState>{copy.noParsedElements}</EmptyState>;

  return (
    <div className="border-t">
      <AnimatePresence initial={false} mode="popLayout">
        {page.elements.map((element, index) => <StructuredElement copy={copy} element={element} index={index} key={element.id} />)}
      </AnimatePresence>
    </div>
  );
}

function ParsedContentTab({ copy, result }: { copy: AppCopy["documents"]; result: DocumentParseResponse | null }) {
  const [activeView, setActiveView] = useState<ParsedView>("structured");
  const [selectedPageNumber, setSelectedPageNumber] = useState<number | null>(null);
  const pages = result?.structured.pages ?? [];

  const effectiveSelectedPageNumber = selectedPageNumber ?? pages[0]?.pageNumber ?? null;
  const selectedPage = pages.find((page) => page.pageNumber === effectiveSelectedPageNumber);
  const viewOptions: Array<{ key: ParsedView; label: string }> = [
    { key: "structured", label: copy.structured },
    { key: "markdown", label: copy.markdown },
    { key: "json", label: copy.json },
  ];

  return (
    <div className="grid border-t lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="border-b lg:border-b-0 lg:border-r">
        <div className="border-b px-4 py-4 sm:px-6"><h2 className="text-sm font-semibold">{copy.pages}</h2></div>
        {result ? (pages.length > 0 ? <PageList copy={copy} onSelect={setSelectedPageNumber} pages={pages} selectedPageNumber={effectiveSelectedPageNumber} /> : <EmptyState>{copy.noPages}</EmptyState>) : <EmptyState>{copy.noPages}</EmptyState>}
      </aside>

      <section className="min-w-0">
        <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <h2 className="text-sm font-semibold">{copy.parsedElements}</h2>
          <div aria-describedby={!result ? "parsed-view-disabled-reason" : undefined} aria-label={copy.viewMode} className="inline-flex w-fit rounded-md border p-0.5" role="group">
            {viewOptions.map((view) => (
              <Button aria-pressed={activeView === view.key} disabled={!result} key={view.key} onClick={() => setActiveView(view.key)} size="sm" variant={activeView === view.key ? "secondary" : "ghost"}>{view.label}</Button>
            ))}
          </div>
        </div>
        {!result && <p className="border-b px-4 py-3 text-xs text-slate-500 sm:px-6" id="parsed-view-disabled-reason">{copy.parsedViewsUnavailable}</p>}
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="min-w-0"
            exit={{ opacity: 0, y: -4 }}
            initial={{ opacity: 0, y: 4 }}
            key={`${activeView}-${result ? "ready" : "empty"}`}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            {!result ? <EmptyState>{copy.noParsedElements}</EmptyState> : activeView === "structured" ? <StructuredView copy={copy} page={selectedPage} /> : activeView === "markdown" ? (
              <pre className="max-h-[min(70vh,800px)] overflow-auto whitespace-pre-wrap px-4 py-5 font-mono text-xs leading-6 text-slate-700 sm:px-6" data-testid="parsed-markdown">{result.markdown}</pre>
            ) : (
              <pre className="max-h-[min(70vh,800px)] overflow-auto whitespace-pre-wrap px-4 py-5 font-mono text-xs leading-6 text-slate-700 sm:px-6" data-testid="parsed-json">{JSON.stringify(result.structured, null, 2)}</pre>
            )}
          </motion.div>
        </AnimatePresence>
      </section>
    </div>
  );
}

export function DocumentsScreen({ view }: { view: DocumentView }) {
  const { preferences } = usePreferences();
  const { selectedFile, parseResult, activeDocument } = useDocumentPipeline();
  const copy = UI_COPY[preferences.locale];
  const current = copy.documents.views[view];
  const documentTitle = selectedFile?.name ?? activeDocument?.fileName ?? copy.documents.noDocumentTitle;
  const documentMetadata = parseResult
    ? `${parseResult.document.pageCount} ${copy.documents.pages.toLowerCase()} • ${formatDocumentFileSize(selectedFile?.size ?? parseResult.document.sizeBytes, preferences.locale)}`
    : activeDocument
      ? `${activeDocument.pageCount} ${copy.documents.pages.toLowerCase()} • ${formatDocumentFileSize(activeDocument.sizeBytes, preferences.locale)}`
    : copy.documents.metadataPending;

  return (
    <div>
      <header className="px-4 py-6 sm:px-7">
        <div className="text-xs text-slate-500">{copy.documents.root}&nbsp;&nbsp;›&nbsp;&nbsp;{current.title}</div>
        <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.025em]">{current.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{current.description}</p>
        <div className="mt-6 flex items-center gap-4">
          <FileText aria-hidden="true" className="size-10 stroke-[1.25] text-slate-500" />
          <div className="min-w-0">
            <div className="truncate font-semibold" title={documentTitle}>{documentTitle}</div>
            <div className="mt-1 text-xs text-slate-500">{documentMetadata}</div>
          </div>
        </div>
      </header>

      <nav aria-label={copy.documents.root} className="flex min-w-0 gap-6 overflow-x-auto border-t px-4 sm:px-7">
        {documentTabs.map((tab) => (
          <Link
            aria-current={view === tab.view ? "page" : undefined}
            className={cn("-mb-px border-b-2 border-transparent py-3 text-sm text-slate-500 outline-none hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-slate-400", view === tab.view && "border-slate-950 font-medium text-slate-950")}
            href={tab.href}
            key={tab.view}
          >
            {copy.documents.tabs[tab.view]}
          </Link>
        ))}
      </nav>

      {view === "overview" && <><DocumentOverviewTab copy={copy.documents} locale={preferences.locale} persistedDocument={activeDocument} result={parseResult} selectedFile={selectedFile} /><DocumentLibrary locale={preferences.locale} /></>}
      {view === "parsed" && <ParsedContentTab copy={copy.documents} result={parseResult} />}
      {view === "chunks" && <ChunksPipeline locale={preferences.locale} />}
    </div>
  );
}
