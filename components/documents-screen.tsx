"use client";

import { SlidingTabs, TransitionPanel } from "@/components/ui/transitions";

import Link from "next/link";
import { useState } from "react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { DocumentUploadPanel } from "@/components/document-upload-panel";
import { DocumentLibrary } from "@/components/document-library";
import { usePreferences } from "@/components/preferences-provider";
import { OcrSourceDetails } from "@/components/ocr-source-details";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { PageHeader } from "@/components/ui/page-header";
import { type AppCopy, UI_COPY } from "@/lib/copy";
import type { DocumentParseResponse, ParsedElement } from "@/lib/document-parse-types";
import { cn } from "@/lib/utils";

type ParsedView = "structured" | "markdown" | "json";

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <TransitionPanel aria-live="polite"
      className="flex min-h-32 items-center justify-center border-y border-border px-6 py-8 text-center text-sm text-muted-foreground"
    >
      {children}
    </TransitionPanel>
  );
}

function TableElement({ element }: { element: ParsedElement }) {
  const rows = element.table?.rows ?? [];
  if (rows.length === 0) return <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{element.text}</p>;

  const [header, ...body] = rows;
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-technical">
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

function StructuredElement({ copy, element }: { copy: AppCopy["documents"]; element: ParsedElement }) {
  const { preferences } = usePreferences();
  return (
    <TransitionPanel as="article" transitionKey={element.id}
      className="border-b border-border px-4 py-5 last:border-b-0 sm:px-6"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-sm bg-secondary px-1.5 py-0.5 font-medium text-foreground">{copy.elementTypes[element.type]}</span>
        {element.pageNumbers.length > 0 && <span className="tabular-nums">{copy.page} {element.pageNumbers.join(", ")}</span>}
      </div>
      {element.type === "table" ? <TableElement element={element} /> : element.type === "list" ? (
        <ul className="list-disc pl-5 text-sm leading-6 text-foreground"><li>{element.text}</li></ul>
      ) : element.type === "heading" ? (
        <h3 className="text-base font-semibold leading-6">{element.text}</h3>
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{element.text}</p>
      )}
      <OcrSourceDetails element={element} locale={preferences.locale} />
    </TransitionPanel>
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
    <aside className="min-h-0 overflow-hidden rounded-lg bg-technical" data-testid="parsed-content-outline">
      <div className="border-b border-border-subtle px-4 py-4">
        <h2 className="text-xs font-semibold text-muted-foreground">{copy.outline}</h2>
        <p className="mt-1 text-xs leading-5 text-subtle-foreground">{hasHeadings ? copy.parsedElements : copy.noOutline}</p>
      </div>
      {entries.length > 0 ? (
        <div className="relative max-h-[365px] space-y-1 overflow-y-auto p-2" role="list" aria-label={copy.outline}>
          {entries.map((entry) => {
            const selected = entry.id === selectedId;
            return (
              <button
                aria-current={selected ? "true" : undefined}
                className={cn("relative block w-full rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary", selected && "bg-secondary font-medium text-foreground")}
                key={entry.id}
                onClick={() => onSelect(entry.id)}
                style={{ paddingLeft: entry.level ? `${Math.min(entry.level, 4) * 0.75 + 0.75}rem` : undefined }}
                type="button"
              >
                {selected ? <TransitionPanel as="span" aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand" transitionKey={selectedId} /> : null}
                <span className="block truncate">{entry.label}</span>
                {entry.pageNumber !== null ? <span className="mt-1 block text-xs text-subtle-foreground tabular-nums">{copy.page} {entry.pageNumber}</span> : null}
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
    <div className="min-h-0 min-w-0 overflow-y-auto" data-testid="parsed-section-inspector">
      <div className="border-b border-border-subtle px-5 py-3">
        <p className="text-xs text-subtle-foreground">{copy.selectedSection}</p>
        <h3 className="mt-1 text-base font-semibold text-foreground">{copy.parsedElements}</h3>
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">{elements.length} {copy.pageElements}</p>
      </div>
      <div>
        {elements.map((element) => <StructuredElement copy={copy} element={element} key={element.id} />)}
      </div>
    </div>
  );
}

export function DeveloperOutput({ copy, result }: { copy: AppCopy["documents"]; result: DocumentParseResponse | null }) {
  const [activeView, setActiveView] = useState<ParsedView>("structured");
  const viewOptions: Array<{ key: Exclude<ParsedView, "structured">; label: string }> = [
    { key: "markdown", label: copy.markdown },
    { key: "json", label: copy.json },
  ];

  return (
    <Disclosure contentClassName="p-0" title={copy.markdown === "Markdown" ? "Developer output — Markdown & JSON" : "Geliştirici çıktısı — Markdown ve JSON"}>
      <div>
        {!result ? <p className="px-4 py-4 text-xs text-muted-foreground">{copy.parsedViewsUnavailable}</p> : (
          <>
            <SlidingTabs value={activeView} aria-label={copy.viewMode} className="flex gap-1 border-b bg-technical px-4 py-2" role="group">
              {viewOptions.map((view) => <Button aria-pressed={activeView === view.key} key={view.key} onClick={() => setActiveView(view.key)} size="sm" variant={activeView === view.key ? "secondary" : "ghost"}>{view.label}</Button>)}
            </SlidingTabs>
            {activeView === "markdown" ? <pre className="max-h-[min(70vh,800px)] overflow-auto whitespace-pre-wrap px-4 py-5 font-mono text-xs leading-6 text-muted-foreground" data-testid="parsed-markdown">{result.markdown}</pre> : null}
            {activeView === "json" ? <pre className="max-h-[min(70vh,800px)] overflow-auto whitespace-pre-wrap px-4 py-5 font-mono text-xs leading-6 text-muted-foreground" data-testid="parsed-json">{JSON.stringify(result.structured, null, 2)}</pre> : null}
          </>
        )}
      </div>
    </Disclosure>
  );
}

export function ParsedContentTab({ copy, result, showDeveloperOutput = true }: { copy: AppCopy["documents"]; result: DocumentParseResponse | null; showDeveloperOutput?: boolean }) {
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
    <div className="grid min-h-0 h-full gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <ContentOutline copy={copy} entries={outline} onSelect={setSelectedId} selectedId={effectiveSelectedId} />
      <section className="min-h-0 min-w-0 overflow-hidden rounded-md border border-border-subtle">
        <div className="border-b border-border-subtle px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-sm font-semibold">{copy.parsedElements}</h2><p className="mt-1 text-xs text-muted-foreground">{copy.structured}</p></div>
            <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground">{result ? copy.source : copy.parsedViewsUnavailable}</span>
          </div>
        </div>
        {!result ? <p className="border-b border-border-subtle px-5 py-3 text-xs text-muted-foreground" id="parsed-view-disabled-reason">{copy.parsedViewsUnavailable}</p> : null}
        {activeView === "structured" ? <StructuredSectionInspector copy={copy} elements={selectedElements} /> : null}
        {showDeveloperOutput ? <Disclosure className="rounded-none border-0 border-t bg-transparent" contentClassName="p-0" onToggle={(event) => setDeveloperOutputOpen(event.currentTarget.open)} open={developerOutputOpen} title={copy.markdown === "Markdown" ? "Developer output" : "Geliştirici çıktısı"}>
          <div>
            <SlidingTabs value={activeView} aria-describedby={!result ? "parsed-view-disabled-reason" : undefined} aria-label={copy.viewMode} className="flex flex-wrap gap-1 border-b bg-technical px-4 py-2 sm:px-6" role="group">
              {viewOptions.map((view) => <Button aria-pressed={activeView === view.key} disabled={!result} key={view.key} onClick={() => selectView(view.key)} size="sm" variant={activeView === view.key ? "secondary" : "ghost"}>{view.label}</Button>)}
            </SlidingTabs>
            {!result ? <p className="px-4 py-4 text-xs text-muted-foreground sm:px-6">{copy.noParsedElements}</p> : activeView === "markdown" ? (
              <pre className="max-h-[min(70vh,800px)] overflow-auto whitespace-pre-wrap px-4 py-5 font-mono text-xs leading-6 text-muted-foreground sm:px-6" data-testid="parsed-markdown">{result.markdown}</pre>
            ) : activeView === "json" ? (
              <pre className="max-h-[min(70vh,800px)] overflow-auto whitespace-pre-wrap px-4 py-5 font-mono text-xs leading-6 text-muted-foreground sm:px-6" data-testid="parsed-json">{JSON.stringify(result.structured, null, 2)}</pre>
            ) : null}
          </div>
        </Disclosure> : <SlidingTabs value={activeView} aria-label={copy.viewMode} className="sr-only" role="group">
          {viewOptions.map((view) => <Button aria-pressed={activeView === view.key} disabled={!result} key={view.key} onClick={() => selectView(view.key)} size="sm" variant="ghost">{view.label}</Button>)}
        </SlidingTabs>}
      </section>
    </div>
  );
}

export function DocumentsScreen() {
  const { preferences } = usePreferences();
  const { uploadNotice } = useDocumentPipeline();
  const copy = UI_COPY[preferences.locale];

  return (
    <div className="min-w-0 overflow-x-clip bg-background" data-testid="documents-screen">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <PageHeader data-testid="documents-page-header" description={preferences.locale === "tr" ? "RAG'ınızda kullanılan kaynak dokümanları ekleyin ve yönetin." : "Add and manage the source documents used by your RAG."} title={copy.documents.root} />

        <DocumentUploadPanel />
        {uploadNotice ? <p aria-live="polite" className={cn("mt-4 rounded-md border px-4 py-3 text-sm", uploadNotice === "reused" ? "border-border bg-secondary text-foreground" : "border-success-border bg-success-subtle text-success")} role="status">{uploadNotice === "reused" ? (preferences.locale === "tr" ? "Mevcut doküman yeniden kullanıldı; duplicate oluşturulmadı. Parse ekranından devam edebilirsiniz." : "Existing document reused; no duplicate was created. Continue from Parse.") : (preferences.locale === "tr" ? "Doküman eklendi; parse etmeye hazır." : "Document added; ready to parse.")} <Link className="ml-1 font-medium underline" href="/parse">{preferences.locale === "tr" ? "Parse'a devam et" : "Continue to Parse"}</Link></p> : null}
        <DocumentLibrary locale={preferences.locale} />
      </div>
    </div>
  );
}
