"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { DocumentUploadPanel } from "@/components/document-upload-panel";
import { DocumentLibrary } from "@/components/document-library";
import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type AppCopy, type DocumentViewKey, UI_COPY } from "@/lib/copy";
import { formatDocumentFileSize } from "@/lib/document-file";
import type { DocumentParseResponse, ParsedElement } from "@/lib/document-parse-types";
import type { PersistedDocument } from "@/lib/rag-api-types";
import { cn } from "@/lib/utils";

export type DocumentView = DocumentViewKey;

type ParsedView = "structured" | "markdown" | "json";

const documentTabs: Array<{ view: DocumentView; href: string }> = [
  { view: "overview", href: "/documents" },
  { view: "parsed", href: "/parse" },
  { view: "chunks", href: "/chunking" },
];

export function ParseRunSelector({ locale }: { locale: "en" | "tr" }) {
  const { activeDocument, selectedParseRunId, selectParseRun } = useDocumentPipeline();
  const runs = activeDocument?.parseRuns.filter((run) => run.status === "completed" && run.isCompatible) ?? [];
  if (!selectedParseRunId || runs.length < 2) return null;
  return (
    <div className="mt-4 max-w-sm">
      <label className="text-xs font-medium" htmlFor="selected-parse-run">{locale === "tr" ? "Seçili parse run" : "Selected parse run"}</label>
      <Select onValueChange={(value) => void selectParseRun(value)} value={selectedParseRunId}>
        <SelectTrigger className="mt-2" id="selected-parse-run"><SelectValue /></SelectTrigger>
        <SelectContent>
          {runs.map((run, index) => <SelectItem key={run.id} value={run.id}>{locale === "tr" ? "Ayrıştırma" : "Parse"} {run.runNumber ?? index + 1}{run.historicalLineage ? (locale === "tr" ? " · geçmiş" : " · historical") : (locale === "tr" ? " · aktif" : " · active")}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      aria-live="polite"
      className="flex min-h-32 items-center justify-center border-y border-[#e7e2e4] px-6 py-8 text-center text-sm text-[#6e676a]"
      initial={{ opacity: 0, y: 5 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

export function SummaryGrid({ copy, result }: { copy: AppCopy["documents"]; result: DocumentParseResponse }) {
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
          className="rounded-[10px] border border-[#e7e2e4] bg-white px-3 py-2"
          initial={{ opacity: 0, y: 5 }}
          key={label}
          transition={{ duration: 0.16, delay: index * 0.035, ease: "easeOut" }}
        >
          <dt className="text-[11px] text-[#969093]">{label}</dt>
          <dd className="mt-1 text-lg font-semibold">{value}</dd>
        </motion.div>
      ))}
    </motion.dl>
  );
}

export function DocumentOverviewTab({ copy, selectedFile, persistedDocument, result, locale }: { copy: AppCopy["documents"]; selectedFile: File | null; persistedDocument: PersistedDocument | null; result: DocumentParseResponse | null; locale: "en" | "tr" }) {
  const fileName = selectedFile?.name ?? persistedDocument?.fileName;
  const sizeBytes = selectedFile?.size ?? persistedDocument?.sizeBytes;
  const pageCount = result?.document.pageCount ?? (persistedDocument?.activeParseRunId ? persistedDocument.pageCount : undefined);
  return (
    <div className="grid border-t lg:grid-cols-2">
      <section className="p-4 sm:p-7 lg:border-r">
        <h2 className="text-sm font-semibold">{copy.document}</h2>
        <div className="mt-5">
          {fileName ? (
            <dl className="grid gap-3 border-y px-4 py-5 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-[#6e676a]">{copy.fileName}</dt>
                <dd className="max-w-[65%] truncate font-medium" title={fileName}>{fileName}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-[#6e676a]">{copy.size}</dt>
                <dd>{formatDocumentFileSize(sizeBytes ?? 0, locale)}</dd>
              </div>
              {pageCount !== undefined && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-[#6e676a]">{copy.pages}</dt>
                  <dd>{pageCount}</dd>
                </div>
              )}
            </dl>
          ) : (
            <EmptyState>
              <div>
                <p>{copy.noDocumentSelected}</p>
                <Button asChild className="mt-4" size="sm" variant="outline">
                  <Link className="text-[#501329] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#711f3a]/25" href="/">{copy.chooseFromOverview} <ArrowUpRight aria-hidden="true" className="size-4" /></Link>
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
  if (rows.length === 0) return <p className="whitespace-pre-wrap text-sm leading-6 text-[#171416]">{element.text}</p>;

  const [header, ...body] = rows;
  return (
    <div className="overflow-x-auto rounded-[10px] border border-[#e7e2e4]">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[#fbfafb]">
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
      className="border-b border-[#e7e2e4] px-4 py-5 last:border-b-0 sm:px-6"
      exit={{ opacity: 0, x: -5 }}
      initial={{ opacity: 0, x: 5 }}
      layout
      transition={{ duration: 0.18, delay: index * 0.035, ease: "easeOut" }}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[#6e676a]">
        <span className="rounded-md border border-[#e7e2e4] bg-[#fbfafb] px-2 py-1">{copy.elementTypes[element.type]}</span>
        {element.pageNumbers.length > 0 && <span>{copy.page} {element.pageNumbers.join(", ")}</span>}
      </div>
      {element.type === "table" ? <TableElement element={element} /> : element.type === "list" ? (
        <ul className="list-disc pl-5 text-sm leading-6 text-[#171416]"><li>{element.text}</li></ul>
      ) : element.type === "heading" ? (
        <h3 className="text-base font-semibold leading-6">{element.text}</h3>
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-6 text-[#171416]">{element.text}</p>
      )}
    </motion.article>
  );
}

type OutlineEntry = {
  id: string;
  label: string;
  pageNumber: number | null;
  level: number | null;
  kind: "heading" | "page";
};

function parsedElements(result: DocumentParseResponse) {
  return result.structured.elements.length > 0
    ? result.structured.elements
    : result.structured.pages.flatMap((page) => page.elements);
}

function buildOutline(result: DocumentParseResponse | null, copy: AppCopy["documents"]): OutlineEntry[] {
  if (!result) return [];
  const elements = parsedElements(result);
  const headings = elements.filter((element) => element.type === "heading" && element.text.trim());
  if (headings.length > 0) {
    return headings.map((element) => ({
      id: element.id,
      label: element.text,
      pageNumber: element.pageNumbers[0] ?? null,
      level: Math.max(1, element.level ?? 1),
      kind: "heading" as const,
    }));
  }

  return result.structured.pages.map((page) => ({
    id: `page-${page.pageNumber}`,
    label: `${copy.page} ${page.pageNumber}`,
    pageNumber: page.pageNumber,
    level: null,
    kind: "page" as const,
  }));
}

function outlineSection(result: DocumentParseResponse, entry: OutlineEntry | undefined) {
  if (!entry) return [];
  if (entry.kind === "page") return result.structured.pages.find((page) => page.pageNumber === entry.pageNumber)?.elements ?? [];

  const elements = parsedElements(result);
  const start = elements.findIndex((element) => element.id === entry.id);
  if (start < 0) return [];
  const level = Math.max(1, entry.level ?? 1);
  const end = elements.findIndex((element, index) => index > start && element.type === "heading" && Math.max(1, element.level ?? 1) <= level);
  return elements.slice(start, end < 0 ? elements.length : end);
}

function ContentOutline({ copy, entries, selectedId, onSelect }: { copy: AppCopy["documents"]; entries: OutlineEntry[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const hasHeadings = entries.some((entry) => entry.kind === "heading");
  return (
    <aside className="border-b bg-[#fbfafb] lg:border-b-0 lg:border-r" data-testid="parsed-content-outline">
      <div className="border-b px-4 py-4 sm:px-6">
        <h2 className="text-sm font-semibold">{copy.outline}</h2>
        <p className="mt-1 text-xs leading-5 text-[#969093]">{hasHeadings ? copy.parsedElements : copy.noOutline}</p>
      </div>
      {entries.length > 0 ? (
        <div className="relative space-y-1 p-2" role="list" aria-label={copy.outline}>
          {entries.map((entry) => {
            const selected = entry.id === selectedId;
            return (
              <button
                aria-current={selected ? "true" : undefined}
                className={cn("relative block w-full rounded-[7px] px-3 py-2.5 text-left text-sm text-[#6e676a] transition-colors hover:bg-[#fbf4f6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#711f3a]/25", selected && "bg-[#fbf4f6] font-medium text-[#501329]")}
                key={entry.id}
                onClick={() => onSelect(entry.id)}
                style={{ paddingLeft: entry.level ? `${Math.min(entry.level, 4) * 0.75 + 0.75}rem` : undefined }}
                type="button"
              >
                {selected ? <motion.span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[#711f3a]" layoutId="parsed-outline-active" transition={{ type: "spring", stiffness: 500, damping: 35 }} /> : null}
                <span className="block truncate">{entry.label}</span>
                {entry.pageNumber !== null ? <span className="mt-1 block text-[10px] text-[#969093]">{copy.page} {entry.pageNumber}</span> : null}
              </button>
            );
          })}
        </div>
      ) : <EmptyState>{copy.noPages}</EmptyState>}
    </aside>
  );
}

function StructuredSectionInspector({ copy, elements }: { copy: AppCopy["documents"]; elements: ParsedElement[] }) {
  if (elements.length === 0) return <EmptyState>{copy.noParsedElements}</EmptyState>;

  return (
    <div className="min-w-0" data-testid="parsed-section-inspector">
      <div className="border-b bg-[#fbfafb] px-4 py-4 sm:px-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#969093]">{copy.selectedSection}</p>
        <h3 className="mt-1 text-base font-semibold text-[#171416]">{copy.parsedElements}</h3>
        <p className="mt-1 text-xs text-[#6e676a]">{elements.length} {copy.pageElements}</p>
      </div>
      <AnimatePresence initial={false} mode="popLayout">
        {elements.map((element, index) => <StructuredElement copy={copy} element={element} index={index} key={element.id} />)}
      </AnimatePresence>
    </div>
  );
}

export function ParsedContentTab({ copy, result }: { copy: AppCopy["documents"]; result: DocumentParseResponse | null }) {
  const [activeView, setActiveView] = useState<ParsedView>("structured");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [developerOutputOpen, setDeveloperOutputOpen] = useState(false);
  const outline = buildOutline(result, copy);
  const effectiveSelectedId = selectedId && outline.some((entry) => entry.id === selectedId) ? selectedId : outline[0]?.id ?? null;
  const selectedEntry = outline.find((entry) => entry.id === effectiveSelectedId);
  const selectedElements = result && selectedEntry ? outlineSection(result, selectedEntry) : [];
  const viewOptions: Array<{ key: ParsedView; label: string }> = [
    { key: "structured", label: copy.structured },
    { key: "markdown", label: copy.markdown },
    { key: "json", label: copy.json },
  ];

  function selectView(view: ParsedView) {
    setActiveView(view);
    setDeveloperOutputOpen(view !== "structured");
  }

  return (
    <div className="grid border-t lg:grid-cols-[250px_minmax(0,1fr)]">
      <ContentOutline copy={copy} entries={outline} onSelect={setSelectedId} selectedId={effectiveSelectedId} />
      <section className="min-w-0">
        <div className="border-b px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-sm font-semibold">{copy.parsedElements}</h2><p className="mt-1 text-xs text-[#6e676a]">{copy.structured}</p></div>
            <span className="rounded-full border border-[#d8b5c2] bg-[#fbf4f6] px-2.5 py-1 text-[11px] font-medium text-[#711f3a]">{result ? copy.source : copy.parsedViewsUnavailable}</span>
          </div>
        </div>
        {!result ? <p className="border-b px-4 py-3 text-xs text-[#6e676a] sm:px-6" id="parsed-view-disabled-reason">{copy.parsedViewsUnavailable}</p> : null}
        {activeView === "structured" ? <StructuredSectionInspector copy={copy} elements={selectedElements} /> : null}
        <details className="border-t border-[#e7e2e4]" onToggle={(event) => setDeveloperOutputOpen(event.currentTarget.open)} open={developerOutputOpen}>
          <summary className="cursor-pointer list-none px-4 py-4 text-sm font-semibold text-[#6e676a] outline-none hover:bg-[#fbf4f6] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#711f3a]/25 sm:px-6">{copy.markdown === "Markdown" ? "Developer output" : "Geliştirici çıktısı"}</summary>
          <div className="border-t border-[#e7e2e4]">
            <div aria-describedby={!result ? "parsed-view-disabled-reason" : undefined} aria-label={copy.viewMode} className="flex flex-wrap gap-1 border-b bg-[#fbfafb] px-4 py-2 sm:px-6" role="group">
              {viewOptions.map((view) => <Button aria-pressed={activeView === view.key} disabled={!result} key={view.key} onClick={() => selectView(view.key)} size="sm" variant={activeView === view.key ? "secondary" : "ghost"}>{view.label}</Button>)}
            </div>
            {!result ? <p className="px-4 py-4 text-xs text-[#6e676a] sm:px-6">{copy.noParsedElements}</p> : activeView === "markdown" ? (
              <pre className="max-h-[min(70vh,800px)] overflow-auto whitespace-pre-wrap px-4 py-5 font-mono text-xs leading-6 text-[#6e676a] sm:px-6" data-testid="parsed-markdown">{result.markdown}</pre>
            ) : activeView === "json" ? (
              <pre className="max-h-[min(70vh,800px)] overflow-auto whitespace-pre-wrap px-4 py-5 font-mono text-xs leading-6 text-[#6e676a] sm:px-6" data-testid="parsed-json">{JSON.stringify(result.structured, null, 2)}</pre>
            ) : null}
          </div>
        </details>
      </section>
    </div>
  );
}

export function DocumentsScreen({ view }: { view?: DocumentView } = {}) {
  const { preferences } = usePreferences();
  const { uploadNotice } = useDocumentPipeline();
  const copy = UI_COPY[preferences.locale];
  const effectiveView = view ?? "overview";
  const current = copy.documents.views[effectiveView];
  const isLegacyView = view !== undefined;

  return (
    <div className="min-w-0 overflow-x-clip">
      <header className="px-4 pb-6 pt-6 sm:px-8 sm:pb-7">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#969093]">{copy.documents.root}{isLegacyView ? <>&nbsp;&nbsp;›&nbsp;&nbsp;{current.title}</> : null}</div>
        <h1 className="mt-3 text-[28px] font-semibold tracking-[-0.045em]">{isLegacyView ? current.title : copy.documents.root}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-5 text-[#6e676a]">{isLegacyView ? current.description : preferences.locale === "tr" ? "PDF kitaplığını yönetin." : "Manage the PDF library."}</p>
        {isLegacyView ? <ParseRunSelector locale={preferences.locale} /> : null}
      </header>

      {isLegacyView ? <nav aria-label={copy.documents.root} className="flex min-w-0 gap-6 overflow-x-auto border-t px-4 sm:px-7">
        {documentTabs.map((tab) => (
          <Link
            aria-current={view === tab.view ? "page" : undefined}
            className={cn("-mb-px border-b-2 border-transparent py-3 text-sm text-[#6e676a] outline-none hover:text-[#501329] focus-visible:ring-2 focus-visible:ring-[#711f3a]/25", view === tab.view && "border-[#711f3a] font-medium text-[#501329]")}
            href={tab.href}
            key={tab.view}
          >
            {copy.documents.tabs[tab.view]}
          </Link>
        ))}
      </nav> : null}

      {!isLegacyView ? <section className="border-y px-4 py-4 sm:px-8"><DocumentUploadPanel /></section> : null}
      {!isLegacyView && uploadNotice ? <p aria-live="polite" className={cn("border-b px-4 py-3 text-sm sm:px-8", uploadNotice === "reused" ? "bg-[#fbf4f6] text-[#501329]" : "bg-[#f0f6f1] text-[#3f7a55]")} role="status">{uploadNotice === "reused" ? (preferences.locale === "tr" ? "Mevcut doküman yeniden kullanıldı; duplicate oluşturulmadı. Parse ekranından devam edebilirsiniz." : "Existing document reused; no duplicate was created. Continue from Parse.") : (preferences.locale === "tr" ? "Doküman eklendi; parse etmeye hazır." : "Document added; ready to parse.")} <Link className="ml-1 font-medium underline" href="/parse">{preferences.locale === "tr" ? "Parse'a devam et" : "Continue to Parse"}</Link></p> : null}
      {effectiveView === "overview" ? <DocumentLibrary locale={preferences.locale} /> : null}
    </div>
  );
}
