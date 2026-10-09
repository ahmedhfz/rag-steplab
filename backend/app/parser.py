import math
import os
import re
from collections import Counter
from dataclasses import dataclass, field
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from statistics import median
from typing import Any, Callable, Iterable

try:  # Docling is installed in the worker image, not required for API imports.
    from docling.datamodel.base_models import InputFormat
    from docling.document_converter import DocumentConverter, PdfFormatOption
except ImportError:  # pragma: no cover - exercised in lightweight local tooling
    InputFormat = None  # type: ignore[assignment,misc]
    DocumentConverter = None  # type: ignore[assignment,misc]
    PdfFormatOption = None  # type: ignore[assignment,misc]

try:  # Optional pipeline knobs vary across pinned Docling patch releases.
    from docling.datamodel.pipeline_options import PdfPipelineOptions
except ImportError:  # pragma: no cover - exercised in lightweight local tooling
    PdfPipelineOptions = None  # type: ignore[assignment,misc]

try:
    from docling.datamodel.pipeline_options import HeadingHierarchyOptions
except ImportError:  # pragma: no cover - older Docling builds
    HeadingHierarchyOptions = None  # type: ignore[assignment,misc]

try:
    from docling.datamodel.pipeline_options import RapidOcrOptions
except ImportError:  # pragma: no cover - older Docling builds
    RapidOcrOptions = None  # type: ignore[assignment,misc]

try:
    from docling.datamodel.pipeline_options import OcrMode
except ImportError:  # pragma: no cover - older Docling builds
    OcrMode = None  # type: ignore[assignment,misc]

from .config import get_settings
from .errors import ApiProblem
from .ocr import ARTIFACTS, asset_manifest, model_root
from .schemas import (
    DocumentMetadata,
    ParseResponse,
    ParseSummary,
    ParsedElement,
    ParsedPage,
    ParsedTable,
    StructuredContent,
    SourceRegion,
)


@dataclass(frozen=True)
class _TextLine:
    text: str
    top: float
    left: float
    height: float
    font_key: str


@dataclass
class _LayoutMemo:
    """Per-document cache for typography lookups during normalization.

    Converting every textline cell to top-left coordinates for every heading
    candidate made attached-label detection quadratic on long PDFs.
    """

    page_boxes: dict[int, list[tuple[float, float, float, float]] | None] = field(default_factory=dict)
    heights: dict[int, float | None] = field(default_factory=dict)


@dataclass(frozen=True)
class _IteratedItem:
    """Docling item plus the traversal depth returned by ``iterate_items``.

    Docling returns the hierarchy depth as the second tuple value. Keeping it
    next to the item prevents the normalizer from silently flattening list and
    nested content while still allowing the existing item helpers to operate
    on the original Docling object.
    """

    value: Any
    traversal_level: int | None = None

    @property
    def level(self) -> int | None:
        label_value = _label(self.value)
        item_level = getattr(self.value, "level", None)
        if (
            isinstance(item_level, int)
            and item_level > 0
            and not (
                label_value in {"title", "section_header", "heading"}
                and getattr(self.value, "self_ref", None)
            )
        ):
            return item_level
        # ``iterate_items`` depth includes Docling group nodes (lists, forms,
        # and layout containers), so it is meaningful for list descendants but
        # must not be mistaken for a heading hierarchy level.
        if label_value in {"list_item", "list", "checkbox_selected", "checkbox_unselected"}:
            return self.traversal_level
        return None

    def __getattr__(self, name: str) -> Any:
        return getattr(self.value, name)


def _safe_unload(resource: Any | None) -> None:
    if resource is None:
        return
    try:
        resource.unload()
    except Exception:
        # Parse sonucu hazırsa cleanup hatası kullanıcı yanıtını bozmamalı.
        pass


_converter_cache: dict[str, Any] = {}
_ocr_manifest: dict[str, Any] | None = None


def _converter_cache_key(artifacts_path: Path | None) -> str:
    docling_key = str(artifacts_path.resolve()) if artifacts_path is not None else "<default>"
    return f"{docling_key}|{model_root().resolve()}"


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
        kwargs: dict[str, Any] = {
            "generate_parsed_pages": True,
            "do_ocr": True,
            # Keep Docling's PDF-first merge: native text wins where it exists;
            # OCR fills image/non-text regions selected by the pipeline.
            "force_backend_text": False,
            # Stop before the Modal hard timeout; a partial result is rejected
            # in parse_pdf_file instead of being saved as a complete parse.
            "document_timeout": float(get_settings().docling_document_timeout_seconds),
            # Defaults today, pinned explicitly: no third-party plugin loading
            # and no remote model/API calls from the parse worker.
            "enable_remote_services": False,
            "allow_external_plugins": False,
        }
        if artifacts_path is not None:
            kwargs["artifacts_path"] = str(artifacts_path)
        if HeadingHierarchyOptions is not None:
            try:
                kwargs["heading_hierarchy_options"] = HeadingHierarchyOptions(
                    enabled=True,
                    use_bookmarks=True,
                    use_numbering=True,
                    use_style=True,
                    max_level=6,
                )
            except TypeError:
                # Older pinned Docling builds may not expose this option.
                pass
        if RapidOcrOptions is None:
            raise ApiProblem(503, "ocr_configuration_unavailable", "The pinned OCR configuration is unavailable.")
        global _ocr_manifest
        _ocr_manifest = asset_manifest()
        root = model_root()
        ocr_kwargs: dict[str, Any] = {
            "lang": ["tr"],
            "scale": 3.0,
            "text_score": 0.5,
            "backend": "onnxruntime",
            "det_model_path": str(root / ARTIFACTS["det"][0]),
            "rec_model_path": str(root / ARTIFACTS["rec"][0]),
            "cls_model_path": str(root / ARTIFACTS["cls"][0]),
            # Empty explicit paths prevent Docling from resolving a legacy
            # external dictionary/font; RapidOCR uses ONNX embedded keys.
            "rec_keys_path": "",
            "font_path": "",
            "rapidocr_params": {
                "Rec.rec_keys_path": None,
                "Rec.font_path": None,
                "Rec.lang_type": "tr",
                "Global.font_path": None,
                "Det.use_cuda": False,
                "Rec.use_cuda": False,
                "Cls.use_cuda": False,
                "Det.use_dml": False,
                "Rec.use_dml": False,
                "Cls.use_dml": False,
                "EngineConfig.onnxruntime.intra_op_num_threads": 2,
                "EngineConfig.onnxruntime.inter_op_num_threads": 1,
            },
        }
        if OcrMode is not None:
            ocr_kwargs["mode"] = OcrMode.PDF_AWARE_LAYOUT_REGIONS
        else:
            # Compatibility path for older Docling builds without OcrMode.
            ocr_kwargs["force_full_page_ocr"] = False
        kwargs["ocr_options"] = RapidOcrOptions(**ocr_kwargs)
        try:
            pipeline_options = PdfPipelineOptions(**kwargs)
        except TypeError as exc:
            raise ApiProblem(503, "ocr_configuration_unavailable", "The pinned Docling OCR options are incompatible.") from exc

    if pipeline_options is None:
        raise ApiProblem(503, "ocr_configuration_unavailable", "The pinned PDF pipeline is unavailable.")
    # Uploads are PDF-only; keep Docling's non-PDF backends unreachable.
    return DocumentConverter(
        allowed_formats=[InputFormat.PDF],
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


def parse_pdf_file(
    path: Path,
    file_name: str,
    size_bytes: int,
    progress_callback: Callable[[int, str], None] | None = None,
) -> ParseResponse:
    def report_progress(progress: int, phase: str) -> None:
        if progress_callback is None:
            return
        try:
            progress_callback(progress, phase)
        except Exception:
            # Telemetry must never turn a valid parse into a failed parse.
            return

    try:
        settings = get_settings()
        configured_artifacts = settings.docling_artifacts_path or os.getenv("DOCLING_ARTIFACTS_PATH")
        artifacts_path = Path(configured_artifacts).expanduser() if configured_artifacts else None
        converter_warm = _converter_cache_key(artifacts_path) in _converter_cache
        report_progress(25, "docling_starting")
        max_pages = settings.docling_max_num_pages
        page_total = _pdf_page_count(path)
        if page_total is not None and page_total > max_pages:
            raise ApiProblem(
                422,
                "page_limit_exceeded",
                f"The PDF has {page_total} pages; the parser accepts at most {max_pages}.",
            )
        converter = _get_document_converter(artifacts_path)
        report_progress(30, "docling_ready")
        conversion_result = converter.convert(path, max_num_pages=max_pages)
        timeout_check = getattr(conversion_result, "has_timeout_errors", None)
        if callable(timeout_check) and timeout_check():
            raise ApiProblem(
                422,
                "docling_timeout",
                "Docling exceeded the document processing time limit; no partial parse was saved.",
            )
        report_progress(72, "docling_converted")
        document = getattr(conversion_result, "document", None)
        if document is None:
            raise ApiProblem(
                422,
                "docling_error",
                "Docling could not produce a semantic document.",
            )

        # The existing normalizer is the canonical API/storage boundary. Do not
        # expose Docling's internal document graph to the frontend or database.
        structured = build_structured_content(document, parsed_pages=getattr(conversion_result, "pages", []))
        counts = Counter(element.type for element in structured.elements)
        page_count = len(structured.pages)
        if not structured.elements:
            raise ApiProblem(422, "docling_content_missing", "Docling produced no readable semantic content.")
        markdown = _to_markdown(structured.pages)
        report_progress(90, "content_normalized")
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
            "headingClassifierVersion": "context-v2",
            "mode": "full_document_converter",
            "workerStartMode": "warm" if converter_warm else "cold",
            "ocr": _ocr_manifest,
        },
    )


def _pdf_page_count(path: Path) -> int | None:
    """Read the page count cheaply so over-limit PDFs fail with a clear code."""

    try:
        import pypdfium2

        document = pypdfium2.PdfDocument(str(path))
        try:
            return len(document)
        finally:
            document.close()
    except Exception:
        # Docling still enforces ``max_num_pages``; an unreadable header is
        # reported by its normal conversion error path.
        return None


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
    return _join_normalized_lines(line.text for line in lines)


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


def build_structured_content(document: Any, *, parsed_pages: Iterable[Any] = ()) -> StructuredContent:
    elements: list[ParsedElement] = []
    element_sources: list[Any] = []
    items = list(_iter_document_items(document))
    tables = [item for item in items if _element_type(item) == "table"]
    page_cells = {
        page.page_no: getattr(getattr(page, "parsed_page", None), "textline_cells", []) or []
        for page in parsed_pages
    }

    heading_heights: dict[int, list[float]] = {}
    last_heading: tuple[int, float | None] | None = None
    content_since_heading = True
    memo = _LayoutMemo()

    for index, item in enumerate(items):
        element_type = _element_type(item)
        if element_type is None:
            continue
        following = items[index + 1] if index + 1 < len(items) else None
        if element_type == "heading" and (
            _is_local_heading(item, document, tables)
            or _is_attached_label(
                item,
                following,
                document,
                page_cells,
                (items[position] for position in range(index + 1, len(items))),
                memo=memo,
            )
        ):
            element_type = "paragraph"

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
            text = _repair_wrapped_time_range(
                _item_text(item),
                item,
                document,
                page_cells,
            )

        if not text and element_type != "table":
            continue

        level = getattr(item, "level", None)
        if _element_type(item) == "heading" and element_type != "heading":
            level = None
        elif element_type == "heading":
            if _numbered_heading_level(text) == 1:
                # A numbered top-level section establishes a new local style
                # hierarchy; unrelated earlier sections must not change the
                # level of equal-sized sibling headings in this section.
                heading_heights = {}
                last_heading = None
                content_since_heading = True
            level = _infer_heading_level(
                item,
                text,
                document,
                page_cells,
                heading_heights,
                last_heading,
                content_since_heading,
                memo=memo,
            )
            height = _line_height(item, document, page_cells, memo)
            if height is not None:
                heading_heights.setdefault(level, []).append(height)
            last_heading = (level, height)
            content_since_heading = False
        else:
            content_since_heading = True
        element = ParsedElement(
            id=f"element-{len(elements) + 1}",
            type=element_type,
            page_numbers=page_numbers,
            text=text,
            level=level if isinstance(level, int) and level > 0 else None,
            table=table,
            **_source_metadata(item, document, page_cells),
        )
        elements.append(element)
        element_sources.append(item)

    ordered_pairs = _reorder_semantic_blocks(
        list(zip(elements, element_sources)),
        document,
    )
    elements = [
        element.model_copy(update={"id": f"element-{index}"})
        for index, (element, _source) in enumerate(ordered_pairs, start=1)
    ]

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


def _label(item: Any) -> str:
    label = getattr(item, "label", "")
    return str(getattr(label, "value", label)).lower().replace("docitemlabel.", "")


def _source_metadata(item: Any, document: Any, page_cells: dict) -> dict:
    """Associate retained cells by geometry; never infer confidence from text."""
    regions: list[SourceRegion] = []
    seen: set[tuple[int, int]] = set()
    boxes: list[tuple[tuple[int, float, float, float, float], str]] = [
        (box, "unknown") for box in _item_boxes(item, document)
    ]
    # Table Markdown includes resolved caption text, so the caption's cells
    # contribute to the table's origin. Its box alone is not OCR evidence:
    # only a matched cell with ``from_ocr=True`` can claim OCR.
    for reference in getattr(item, "captions", []) or []:
        resolver = getattr(reference, "resolve", None)
        if not callable(resolver):
            continue
        try:
            caption = resolver(document)
        except Exception:
            continue
        boxes.extend((box, "unknown") for box in _item_boxes(caption, document))
    for (page, left, top, right, bottom), box_origin in boxes:
        page_item = (getattr(document, "pages", {}) or {}).get(page)
        page_height = getattr(getattr(page_item, "size", None), "height", None)
        matched = False
        for index, cell in enumerate(page_cells.get(page, [])):
            rect = getattr(cell, "rect", None)
            if rect is None:
                continue
            xs = [float(getattr(rect, f"r_x{i}")) for i in range(4)]
            ys = [float(getattr(rect, f"r_y{i}")) for i in range(4)]
            rect_origin = getattr(rect, "coord_origin", "TOPLEFT")
            if str(getattr(rect_origin, "value", rect_origin)) == "BOTTOMLEFT":
                if page_height is None:
                    continue
                ys = [page_height - y for y in ys]
            cl, ct, cr, cb = min(xs), min(ys), max(xs), max(ys)
            # A cell's center belongs to the semantic region. Border touching
            # alone is not evidence that an adjacent label contributed text.
            if not (left <= (cl + cr) / 2 <= right and top <= (ct + cb) / 2 <= bottom):
                continue
            matched = True
            if (page, index) in seen:
                continue
            seen.add((page, index))
            from_ocr = getattr(cell, "from_ocr", None)
            origin = "ocr" if from_ocr is True else "native_pdf" if from_ocr is False else "unknown"
            raw_confidence = getattr(cell, "confidence", None) if origin == "ocr" else None
            try:
                confidence = float(raw_confidence) if raw_confidence is not None else None
            except (TypeError, ValueError):
                confidence = None
            if confidence is not None and (not math.isfinite(confidence) or not 0 <= confidence <= 1):
                confidence = None
            regions.append(SourceRegion(page_number=page, bbox=[cl, ct, cr, cb],
                                        page_height=page_height,
                                        origin=origin, confidence=confidence,
                                        text=str(getattr(cell, "text", "") or "")))
        if not matched:
            regions.append(SourceRegion(page_number=page, bbox=[left, top, right, bottom],
                                        page_height=page_height, origin=box_origin))
    origins = {region.origin for region in regions}
    if {"native_pdf", "ocr"} <= origins:
        origin = "mixed"
    elif "ocr" in origins:
        # An unmatched geometry box is unknown, but a retained OCR cell is
        # still positive evidence that this element contains OCR text.
        origin = "ocr"
    elif "native_pdf" in origins:
        origin = "native_pdf"
    else:
        origin = "unknown"
    return {"source_origin": origin, "source_regions": regions}


def _item_boxes(item: Any, document: Any) -> list[tuple[int, float, float, float, float]]:
    """Compare provenance in top-left coordinates; absent geometry is not evidence."""
    boxes = []
    for prov in getattr(item, "prov", []) or []:
        bbox = getattr(prov, "bbox", None)
        page = getattr(prov, "page_no", None)
        if bbox is None or not isinstance(page, int) or page < 1:
            continue
        left, top, right, bottom = (float(getattr(bbox, key)) for key in ("l", "t", "r", "b"))
        origin = getattr(bbox, "coord_origin", "TOPLEFT")
        if str(getattr(origin, "value", origin)) == "BOTTOMLEFT":
            page_item = (getattr(document, "pages", {}) or {}).get(page)
            height = getattr(getattr(page_item, "size", None), "height", None)
            if height is None:
                continue
            top, bottom = height - top, height - bottom
        if right > left and bottom > top:
            boxes.append((page, left, top, right, bottom))
    return boxes


def _reorder_semantic_blocks(
    pairs: list[tuple[ParsedElement, Any]],
    document: Any,
) -> list[tuple[ParsedElement, Any]]:
    """Repair proven multi-column inversions without reordering body lines.

    Docling can emit a later visual column before an earlier top-row column.
    A block starts at a normalized level-1/2 heading and contains all of its
    descendants until the next such heading. Reorder only contiguous blocks
    whose first provenance page is the same and whose geometry shows an
    inversion; ordinary single-column output therefore remains byte-for-byte
    ordered apart from the stable element IDs.
    """

    if len(pairs) < 2:
        return pairs

    blocks: list[list[tuple[ParsedElement, Any]]] = []
    current: list[tuple[ParsedElement, Any]] = []
    for pair in pairs:
        element = pair[0]
        if (
            current
            and element.type == "heading"
            and (element.level or 1) <= 2
        ):
            blocks.append(current)
            current = []
        current.append(pair)
    if current:
        blocks.append(current)

    def block_key(block: list[tuple[ParsedElement, Any]]) -> tuple[int, float, float] | None:
        for _element, source in block:
            boxes = _item_boxes(source, document)
            if boxes:
                page, left, top, _right, _bottom = min(boxes, key=lambda value: (value[0], value[2], value[1]))
                return page, top, left
        return None

    reordered: list[list[tuple[ParsedElement, Any]]] = []
    start = 0
    while start < len(blocks):
        key = block_key(blocks[start])
        page = key[0] if key is not None else None
        end = start + 1
        while end < len(blocks):
            next_key = block_key(blocks[end])
            if page is None or next_key is None or next_key[0] != page:
                break
            end += 1
        run = blocks[start:end]
        keys = [block_key(block) for block in run]
        if all(value is not None for value in keys):
            comparable = [(value[1], value[2]) for value in keys if value is not None]
            if any(left > right for left, right in zip(comparable, comparable[1:])):
                run = sorted(run, key=lambda block: block_key(block) or (page or 0, float("inf"), float("inf")))
        reordered.extend(run)
        start = end

    return [pair for block in reordered for pair in block]


def _page_cell_boxes(
    document: Any,
    page_cells: dict[int, list[Any]],
    page: int,
    memo: _LayoutMemo | None = None,
) -> list[tuple[float, float, float, float]] | None:
    if memo is not None and page in memo.page_boxes:
        return memo.page_boxes[page]
    page_item = (getattr(document, "pages", {}) or {}).get(page)
    page_height = getattr(getattr(page_item, "size", None), "height", None)
    boxes: list[tuple[float, float, float, float]] | None = None
    if page_height is not None:
        boxes = []
        for cell in page_cells.get(page, []):
            box = cell.to_bounding_box().to_top_left_origin(page_height)
            boxes.append((box.l, box.t, box.r, box.b))
    if memo is not None:
        memo.page_boxes[page] = boxes
    return boxes


def _line_height(
    item: Any,
    document: Any,
    page_cells: dict[int, list[Any]],
    memo: _LayoutMemo | None = None,
) -> float | None:
    if memo is not None and id(item) in memo.heights:
        return memo.heights[id(item)]
    heights = []
    for page, left, top, right, bottom in _item_boxes(item, document):
        for box_left, box_top, box_right, box_bottom in _page_cell_boxes(document, page_cells, page, memo) or []:
            area = (box_right - box_left) * (box_bottom - box_top)
            intersection = max(0, min(right, box_right) - max(left, box_left)) * max(
                0, min(bottom, box_bottom) - max(top, box_top)
            )
            if area > 0 and intersection >= area * 0.8:
                heights.append(box_bottom - box_top)
    result = median(heights) if heights else None
    if memo is not None:
        memo.heights[id(item)] = result
    return result


def _repair_wrapped_time_range(
    text: str,
    item: Any,
    document: Any,
    page_cells: dict[int, list[Any]],
) -> str:
    """Restore a range separator Docling drops at a visual line break.

    Docling can flatten a source cell ending in ``18:00-`` together with the
    next line as ``18:0020:00``. The page textline cell still contains the
    source hyphen, so use that provenance to repair only a matching time token.
    This deliberately avoids general text guessing or changing already valid
    ranges.
    """

    if not text or re.search(r"\d{1,2}:\d{2}\d{1,2}:\d{2}", text) is None:
        return text

    original_text = text

    for page, left, top, right, bottom in _item_boxes(item, document):
        page_item = (getattr(document, "pages", {}) or {}).get(page)
        page_height = getattr(getattr(page_item, "size", None), "height", None)
        if page_height is None:
            continue
        for cell in page_cells.get(page, []):
            cell_text = str(getattr(cell, "text", "") or "").strip()
            match = re.search(r"(\d{1,2}:\d{2})-\s*$", cell_text)
            if match is None:
                continue
            try:
                box = cell.to_bounding_box()
                box = box.to_top_left_origin(page_height)
            except (AttributeError, TypeError):
                continue
            area = (box.r - box.l) * (box.b - box.t)
            intersection = max(0, min(right, box.r) - max(left, box.l)) * max(
                0,
                min(bottom, box.b) - max(top, box.t),
            )
            if area <= 0 or intersection <= 0:
                continue
            prefix = match.group(1)
            text = re.sub(
                rf"{re.escape(prefix)}(?=\d{{1,2}}:\d{{2}})",
                f"{prefix}-",
                text,
                count=1,
            )
            if text != original_text:
                return text
    return text


def _is_attached_label(
    item: Any,
    following: Any,
    document: Any,
    page_cells: dict[int, list[Any]],
    candidates: Iterable[Any] = (),
    *,
    memo: _LayoutMemo | None = None,
) -> bool:
    text = _item_text(item)
    sentence_like = text.rstrip().endswith((".", "!", "?"))
    if _label(item) == "title" or re.match(
        r"^(?:\d+(?:\.\d+)*[.)]?|[IVXLCDM]+[.)])\s+\S", text
    ):
        return False
    if (len(text) > 80 or len(text.split()) > 10) and not sentence_like:
        return False
    height = _line_height(item, document, page_cells, memo)
    # Boldness alone is not structure. Require body-sized text AND a tight,
    # aligned continuation. Without source typography, keep Docling's decision.
    height_limit = 1.35 if sentence_like else 1.05
    if height is None:
        return False
    item_pages = set(_page_numbers(item))
    last_page = max(item_pages) if item_pages else None
    seen: set[int] = set()
    for paragraph in _chain_candidates(following, candidates):
        if id(paragraph) in seen:
            continue
        seen.add(id(paragraph))
        paragraph_pages = _page_numbers(paragraph)
        # An attached continuation shares the label's page. Items arrive in
        # reading order, so the scan stops at the first later-page item
        # instead of walking the rest of the document for every heading.
        if paragraph_pages and last_page is not None and min(paragraph_pages) > last_page:
            break
        if _element_type(paragraph) != "paragraph" or not item_pages.intersection(paragraph_pages):
            continue
        body_height = _line_height(paragraph, document, page_cells, memo)
        if body_height is None or height > body_height * height_limit:
            continue
        for page, left, top, right, bottom in _item_boxes(item, document):
            if bottom - top > height * 1.4:
                continue
            for next_page, nl, nt, nr, nb in _item_boxes(paragraph, document):
                if page != next_page:
                    continue
                below = abs(nl - left) <= height * 0.5 and 0 <= nt - bottom <= height * 0.6
                inline = abs(nt - top) <= height * 0.25 and 0 <= nl - right <= height
                if below or inline:
                    return True
    return False


def _chain_candidates(following: Any, candidates: Iterable[Any]) -> Iterable[Any]:
    if following is not None:
        yield following
    for candidate in candidates:
        if candidate is not None:
            yield candidate


def _is_local_heading(item: Any, document: Any, tables: list[Any]) -> bool:
    # A layout-model section_header is a candidate, not a document hierarchy tag.
    # Keep the text/provenance even when its local role contradicts that label.
    parent = getattr(item, "parent", None)
    seen: set[str] = set()
    while parent is not None and callable(getattr(parent, "resolve", None)):
        ref = str(getattr(parent, "cref", ""))
        if ref in seen:
            break
        seen.add(ref)
        node = parent.resolve(document)
        # form_area can wrap an entire checklist section, including its real
        # title. Only containers with an unambiguously local role override it.
        if _label(node) in {"table", "picture", "caption", "key_value_region",
                            "key_value_area", "inline"}:
            return True
        parent = getattr(node, "parent", None)

    for page, left, top, right, bottom in _item_boxes(item, document):
        for table in tables:
            for table_page, tl, tt, tr, tb in _item_boxes(table, document):
                if page != table_page:
                    continue
                intersection = max(0, min(right, tr) - max(left, tl)) * max(0, min(bottom, tb) - max(top, tt))
                if intersection >= (right - left) * (bottom - top) * 0.9:
                    return True
    return False


def _iter_document_items(document: Any) -> Iterable[Any]:
    iterator = getattr(document, "iterate_items", None)
    if callable(iterator):
        for entry in iterator():
            if isinstance(entry, tuple):
                item = entry[0]
                traversal_level = entry[1] if len(entry) > 1 and isinstance(entry[1], int) else None
                yield _IteratedItem(item, traversal_level if traversal_level and traversal_level > 0 else None)
            else:
                yield entry
        return

    for collection_name in ("texts", "tables"):
        for item in getattr(document, collection_name, []) or []:
            yield item


def _element_type(item: Any) -> str | None:
    label_value = _label(item)

    if label_value in {"title", "section_header", "heading"}:
        return "heading"
    if label_value in {"text", "paragraph"}:
        return "paragraph"
    if label_value in {"list_item", "list", "checkbox_selected", "checkbox_unselected"}:
        return "list"
    if label_value == "table":
        return "table"
    if label_value in {"caption", "code", "formula", "footnote", "reference"}:
        return "other"
    if label_value in {
        "form",
        "document_index",
        "grading_scale",
        "handwritten_text",
        "marker",
        "field_region",
        "field_heading",
        "field_item",
        "field_key",
        "field_value",
        "field_hint",
        "empty_value",
    }:
        return "other"
    if label_value in {"page_header", "page_footer"}:
        return None
    # Preserve readable content from future Docling labels instead of silently
    # dropping source text. Unknown empty containers remain excluded.
    return "other" if _item_text(item) else None


def _item_text(item: Any) -> str:
    value = getattr(item, "text", "")
    raw = str(value or "")
    return _join_normalized_lines(raw.splitlines()) if "\n" in raw else re.sub(r"\s+", " ", raw).strip()


def _join_normalized_lines(lines: Iterable[str]) -> str:
    """Join wrapped OCR/Docling lines without damaging ranges or codes."""

    text = ""
    for raw_line in lines:
        line = re.sub(r"\s+", " ", str(raw_line or "")).strip()
        if not line:
            continue
        if not text:
            text = line
        elif text.endswith("-"):
            # A time range such as 18:00-\n20:00 is a meaningful token. For
            # ordinary word wrapping, remove the soft hyphen instead.
            if re.search(r"\d{1,2}:\d{2}-$", text) and re.match(r"\d", line):
                text = f"{text}{line}"
            else:
                text = f"{text[:-1]}{line}"
        else:
            text = f"{text} {line}"
    return text.strip()


def _numbered_heading_level(text: str) -> int | None:
    match = re.match(r"^\s*(\d+(?:\.\d+)*)[.)]?\s+\S", text)
    if match:
        return min(6, len(match.group(1).split(".")))
    if re.match(r"^\s*[IVXLCDM]+[.)]\s+\S", text, flags=re.IGNORECASE):
        return 1
    return None


def _infer_heading_level(
    item: Any,
    text: str,
    document: Any,
    page_cells: dict[int, list[Any]],
    heading_heights: dict[int, list[float]],
    last_heading: tuple[int, float | None] | None,
    content_since_heading: bool,
    *,
    memo: _LayoutMemo | None = None,
) -> int:
    numbered = _numbered_heading_level(text)
    if numbered is not None:
        return numbered
    item_level = getattr(item, "level", None)
    if isinstance(item_level, int) and item_level > 1:
        return min(item_level, 6)

    height = _line_height(item, document, page_cells, memo)
    if height is None or not heading_heights:
        return item_level if isinstance(item_level, int) and item_level > 0 else 1

    representatives = {
        level: median(values) for level, values in heading_heights.items() if values
    }
    nearest_level = min(
        representatives,
        key=lambda level: (abs(height - representatives[level]) / max(representatives[level], 1), level),
    )
    nearest_height = representatives[nearest_level]
    # A heading directly following another heading with a visibly smaller
    # typeface is a child (e.g. Tarif -> Malzemeler). Once body content has
    # appeared, the same visual size is treated as a sibling instead.
    if (
        last_heading is not None
        and not content_since_heading
        and last_heading[1] is not None
        and height < last_heading[1] * 0.9
    ):
        return min(6, last_heading[0] + 1)
    # When two heading sizes fall between established levels, use the gap
    # between their observed ranges rather than a moving median. This keeps a
    # sibling such as a second recipe at level 2 even after level-3 labels have
    # contributed more samples to the median.
    for upper_level in sorted(representatives):
        for lower_level in sorted(representatives):
            if lower_level <= upper_level:
                continue
            upper_values = heading_heights[upper_level]
            lower_values = heading_heights[lower_level]
            boundary = (min(upper_values) + max(lower_values)) / 2
            if height >= boundary and abs(height - boundary) <= max(boundary * 0.08, 0.5):
                return upper_level
    if content_since_heading and nearest_level == min(representatives) and height < nearest_height * 0.9:
        return min(6, max(representatives) + 1)
    return nearest_level


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
