from collections import Counter
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

from docling.document_converter import DocumentConverter

from .errors import ApiProblem
from .schemas import (
    DocumentMetadata,
    ParseResponse,
    ParseSummary,
    ParsedElement,
    ParsedPage,
    ParsedTable,
    StructuredContent,
)


@lru_cache(maxsize=1)
def get_converter() -> DocumentConverter:
    """Reuse the converter so each local request does not rebuild the pipeline."""

    return DocumentConverter()


def parse_pdf_file(path: Path, file_name: str, size_bytes: int) -> ParseResponse:
    try:
        conversion_result = get_converter().convert(source=path)
    except Exception as exc:  # Docling exposes several version-specific exception types.
        raise ApiProblem(422, "docling_error", "Docling could not parse this PDF.") from exc

    status = getattr(getattr(conversion_result, "status", None), "value", getattr(conversion_result, "status", ""))
    if str(status).lower() in {"failure", "failed"}:
        raise ApiProblem(422, "docling_error", "Docling could not parse this PDF.")

    document = getattr(conversion_result, "document", None)
    if document is None:
        raise ApiProblem(422, "docling_error", "Docling returned no parsed document.")

    try:
        structured = build_structured_content(document)
        markdown = str(document.export_to_markdown())
    except Exception as exc:
        raise ApiProblem(422, "docling_error", "Docling returned an unreadable parse result.") from exc

    counts = Counter(element.type for element in structured.elements)
    page_count = len(structured.pages)
    summary = ParseSummary(
        page_count=page_count,
        heading_count=counts["heading"],
        paragraph_count=counts["paragraph"],
        list_count=counts["list"],
        table_count=counts["table"],
    )

    return ParseResponse(
        document=DocumentMetadata(
            file_name=file_name,
            media_type="application/pdf",
            size_bytes=size_bytes,
            page_count=page_count,
        ),
        structured=structured,
        markdown=markdown,
        summary=summary,
    )


def build_structured_content(document: Any) -> StructuredContent:
    elements: list[ParsedElement] = []

    for item in _iter_document_items(document):
        element_type = _element_type(item)
        if element_type is None:
            continue

        page_numbers = _page_numbers(item)
        if element_type == "table":
            table = _table_output(item, document)
            text = table.markdown or "Table"
        else:
            table = None
            text = _item_text(item)

        if not text and element_type != "table":
            continue

        level = getattr(item, "level", None)
        elements.append(
            ParsedElement(
                id=f"element-{len(elements) + 1}",
                type=element_type,
                page_numbers=page_numbers,
                text=text,
                level=level if isinstance(level, int) and level > 0 else None,
                table=table,
            )
        )

    page_count = _page_count(document, elements)
    page_elements: dict[int, list[ParsedElement]] = {page_number: [] for page_number in range(1, page_count + 1)}
    for element in elements:
        for page_number in element.page_numbers:
            page_elements.setdefault(page_number, []).append(element)

    pages = [
        ParsedPage(page_number=page_number, elements=page_elements[page_number])
        for page_number in sorted(page_elements)
    ]
    return StructuredContent(pages=pages, elements=elements)


def _iter_document_items(document: Any) -> Iterable[Any]:
    iterator = getattr(document, "iterate_items", None)
    if callable(iterator):
        for entry in iterator():
            yield entry[0] if isinstance(entry, tuple) else entry
        return

    for collection_name in ("texts", "tables"):
        for item in getattr(document, collection_name, []) or []:
            yield item


def _element_type(item: Any) -> str | None:
    label = getattr(item, "label", "")
    label_value = str(getattr(label, "value", label)).lower().replace("docitemlabel.", "")

    if label_value in {"title", "section_header", "heading"}:
        return "heading"
    if label_value in {"text", "paragraph"}:
        return "paragraph"
    if label_value in {"list_item", "list"}:
        return "list"
    if label_value == "table":
        return "table"
    if label_value in {"caption", "code", "formula", "footnote", "reference"}:
        return "other"
    return None


def _item_text(item: Any) -> str:
    value = getattr(item, "text", "")
    return str(value or "").strip()


def _page_numbers(item: Any) -> list[int]:
    result: list[int] = []
    for provenance in getattr(item, "prov", []) or []:
        page_number = getattr(provenance, "page_no", None)
        if isinstance(page_number, int) and page_number > 0 and page_number not in result:
            result.append(page_number)
    return sorted(result)


def _table_output(item: Any, document: Any) -> ParsedTable:
    grid = getattr(getattr(item, "data", None), "grid", []) or []
    rows = [
        [_cell_text(cell) for cell in row]
        for row in grid
        if isinstance(row, (list, tuple))
    ]

    markdown = ""
    export_to_markdown = getattr(item, "export_to_markdown", None)
    if callable(export_to_markdown):
        try:
            markdown = str(export_to_markdown(document) or "").strip()
        except TypeError:
            markdown = str(export_to_markdown() or "").strip()

    return ParsedTable(rows=rows, markdown=markdown)


def _cell_text(cell: Any) -> str:
    for attribute in ("text", "value", "content"):
        value = getattr(cell, attribute, None)
        if value is not None:
            return str(value).strip()
    return ""


def _page_count(document: Any, elements: list[ParsedElement]) -> int:
    pages = getattr(document, "pages", None)
    try:
        page_count = len(pages) if pages is not None else 0
    except TypeError:
        page_count = 0

    page_count = max(page_count, max((max(element.page_numbers, default=0) for element in elements), default=0))
    return page_count
