import os
import re
from collections import Counter
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from statistics import median
from typing import Any, Iterable

try:  # Docling is installed in the worker image, not required for API imports.
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption
except ImportError:  # pragma: no cover - exercised in lightweight local tooling
    InputFormat = None  # type: ignore[assignment,misc]
    PdfPipelineOptions = None  # type: ignore[assignment,misc]
    DocumentConverter = None  # type: ignore[assignment,misc]
    PdfFormatOption = None  # type: ignore[assignment,misc]

from .config import get_settings
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


@dataclass(frozen=True)
class _TextLine:
    text: str
    top: float
    left: float
    height: float
    font_key: str


def _safe_unload(resource: Any | None) -> None:
    if resource is None:
        return
    try:
        resource.unload()
    except Exception:
        # Parse sonucu hazırsa cleanup hatası kullanıcı yanıtını bozmamalı.
        pass


_converter_cache: dict[str, Any] = {}


def _converter_cache_key(artifacts_path: Path | None) -> str:
    return str(artifacts_path.resolve()) if artifacts_path is not None else "<default>"


def _build_document_converter(artifacts_path: Path | None = None) -> Any:
    """Create the full semantic Docling PDF converter.

    The API process imports this module, but converter construction is deferred
    until the Modal worker starts parsing. This prevents model initialization on
    the small HTTP containers and makes the worker's cold/warm behavior explicit.
    """

    if DocumentConverter is None or InputFormat is None or PdfFormatOption is None:
        raise ApiProblem(503, "docling_unavailable", "The full Docling parser is not available.")

    pipeline_options: Any | None = None
    if PdfPipelineOptions is not None:
        kwargs: dict[str, Any] = {}
        if artifacts_path is not None:
            kwargs["artifacts_path"] = str(artifacts_path)
        try:
            pipeline_options = PdfPipelineOptions(**kwargs)
        except TypeError:
            # Keep compatibility with a pinned Docling patch release that may
            # expose artifacts_path on the converter settings instead.
            pipeline_options = PdfPipelineOptions()
            if artifacts_path is not None and hasattr(pipeline_options, "artifacts_path"):
                pipeline_options.artifacts_path = str(artifacts_path)

    if pipeline_options is None:
        return DocumentConverter()
    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
        }
    )


def _get_document_converter(artifacts_path: Path | None = None) -> Any:
    cache_key = _converter_cache_key(artifacts_path)
    converter = _converter_cache.get(cache_key)
    if converter is None:
        converter = _build_document_converter(artifacts_path)
        _converter_cache[cache_key] = converter
    return converter


def clear_document_converter_cache() -> None:
    _converter_cache.clear()


def parse_pdf_file(path: Path, file_name: str, size_bytes: int) -> ParseResponse:
    try:
        settings = get_settings()
        configured_artifacts = settings.docling_artifacts_path or os.getenv("DOCLING_ARTIFACTS_PATH")
        artifacts_path = Path(configured_artifacts).expanduser() if configured_artifacts else None
        converter_warm = _converter_cache_key(artifacts_path) in _converter_cache
        converter = _get_document_converter(artifacts_path)
        conversion_result = converter.convert(path)
        document = getattr(conversion_result, "document", None)
        if document is None:
            raise ApiProblem(
                422,
                "docling_error",
                "Docling could not produce a semantic document.",
            )

        # The existing normalizer is the canonical API/storage boundary. Do not
        # expose Docling's internal document graph to the frontend or database.
        structured = build_structured_content(document)
        counts = Counter(element.type for element in structured.elements)
        page_count = len(structured.pages)
        if not structured.elements:
            raise ApiProblem(422, "docling_content_missing", "Docling produced no readable semantic content.")
        markdown = _to_markdown(structured.pages)
    except ApiProblem:
        raise
    except Exception as exc:  # Docling exposes several version-specific exception types.
        raise ApiProblem(422, "docling_error", "Docling could not parse this PDF.") from exc

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
        run_metadata={
            "parser": "docling",
            "parserVersion": settings.docling_parser_version,
            "doclingVersion": _docling_version(),
            "normalizedSchemaVersion": "normalized-v1",
            "mode": "full_document_converter",
            "workerStartMode": "warm" if converter_warm else "cold",
        },
    )


def _docling_version() -> str:
    try:
        return version("docling")
    except PackageNotFoundError:  # pragma: no cover - guarded by converter availability
        return "unknown"


def _extract_text_lines(cells: Iterable[Any]) -> list[_TextLine]:
    lines: list[_TextLine] = []
    for cell in cells:
        text = str(getattr(cell, "text", "") or "").strip()
        rect = getattr(cell, "rect", None)
        if not text or rect is None:
            continue

        x_values = [float(getattr(rect, name)) for name in ("r_x0", "r_x1", "r_x2", "r_x3")]
        y_values = [float(getattr(rect, name)) for name in ("r_y0", "r_y1", "r_y2", "r_y3")]
        font_key = str(getattr(cell, "font_key", None) or getattr(cell, "font_name", None) or "")
        lines.append(
            _TextLine(
                text=text,
                top=min(y_values),
                left=min(x_values),
                height=max(y_values) - min(y_values),
                font_key=font_key,
            )
        )

    return sorted(lines, key=lambda line: (round(line.top, 2), round(line.left, 2)))


def _build_page_elements(
    lines: list[_TextLine],
    page_number: int,
    first_element_number: int,
) -> list[ParsedElement]:
    if not lines:
        return []

    positive_heights = [line.height for line in lines if line.height > 0]
    body_height = median(positive_heights) if positive_heights else 1.0
    font_counts = Counter(line.font_key for line in lines if line.font_key)
    body_font = font_counts.most_common(1)[0][0] if font_counts else ""
    max_height = max(positive_heights, default=body_height)

    output: list[ParsedElement] = []
    paragraph_lines: list[_TextLine] = []

    def add_element(element_type: str, text: str, level: int | None = None) -> None:
        output.append(
            ParsedElement(
                id=f"element-{first_element_number + len(output)}",
                type=element_type,
                page_numbers=[page_number],
                text=text,
                level=level,
            )
        )

    def flush_paragraph() -> None:
        if paragraph_lines:
            add_element("paragraph", _join_lines(paragraph_lines))
            paragraph_lines.clear()

    previous_line: _TextLine | None = None
    for line in lines:
        font_marks_heading = bool(body_font and line.font_key and line.font_key != body_font)
        is_heading = line.height >= body_height * 1.35 or (
            font_marks_heading and line.height >= body_height * 1.05
        )
        is_list = bool(re.match(r"^(?:[-*•]|\d+[.)])\s+", line.text))
        has_large_gap = bool(
            previous_line is not None and line.top - previous_line.top > body_height * 1.9
        )

        if is_heading:
            flush_paragraph()
            level = 1 if line.height >= max_height * 0.88 else 2
            add_element("heading", line.text, level)
        elif is_list:
            flush_paragraph()
            add_element("list", re.sub(r"^(?:[-*•]|\d+[.)])\s+", "", line.text).strip())
        else:
            if has_large_gap:
                flush_paragraph()
            paragraph_lines.append(line)
        previous_line = line

    flush_paragraph()
    return output


def _join_lines(lines: list[_TextLine]) -> str:
    text = ""
    for line in lines:
        if not text:
            text = line.text
        elif text.endswith("-"):
            text = f"{text[:-1]}{line.text}"
        else:
            text = f"{text} {line.text}"
    return text.strip()


def _to_markdown(pages: list[ParsedPage]) -> str:
    page_markdown: list[str] = []
    for page in pages:
        blocks: list[str] = []
        for element in page.elements:
            if element.type == "heading":
                blocks.append(f"{'#' * (element.level or 2)} {element.text}")
            elif element.type == "list":
                blocks.append(f"- {element.text}")
            elif element.type == "table" and element.table is not None:
                blocks.append(element.table.markdown)
            else:
                blocks.append(element.text)
        page_markdown.append("\n\n".join(blocks))
    return "\n\n---\n\n".join(page_markdown).strip()


def build_structured_content(document: Any) -> StructuredContent:
    elements: list[ParsedElement] = []

    for item in _iter_document_items(document):
        element_type = _element_type(item)
        if element_type is None:
            continue

        page_numbers = _page_numbers(item)
        # A semantic item without page provenance cannot be shown, cited, or
        # chunked safely. Dropping it is preferable to persisting an orphan.
        if not page_numbers:
            continue
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
