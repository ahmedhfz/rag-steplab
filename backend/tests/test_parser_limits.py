"""Parse budget and normalization cost regressions."""

from pathlib import Path
from types import SimpleNamespace

import pytest

from app import parser
from app.errors import ApiProblem
from app.parser import build_structured_content, parse_pdf_file
from tests.test_parser import FakeDocument, semantic_item


def test_attached_label_detection_converts_each_page_cell_once():
    pages = 60
    conversions = 0
    items = []
    page_cells = []
    for page in range(1, pages + 1):
        # A larger heading followed by body text is a real section title, so
        # the old scan walked every later paragraph of the document for it.
        items.append(semantic_item("section_header", f"Bölüm {page}", (50, 100, 150, 115), page=page, level=2))
        items.append(semantic_item("text", "Gövde metni birinci satır.", (50, 117, 350, 127), page=page))
        items.append(semantic_item("text", "Gövde metni ikinci satır.", (50, 129, 350, 139), page=page))
        cells = []
        for left, top, right, bottom in ((50, 100, 150, 115), (50, 117, 350, 127), (50, 129, 350, 139)):
            box = SimpleNamespace(l=left, t=top, r=right, b=bottom)
            box.to_top_left_origin = lambda _height, box=box: box

            def to_bounding_box(box=box):
                nonlocal conversions
                conversions += 1
                return box

            cells.append(SimpleNamespace(to_bounding_box=to_bounding_box))
        page_cells.append(SimpleNamespace(page_no=page, parsed_page=SimpleNamespace(textline_cells=cells)))
    document = SimpleNamespace(
        pages={page: SimpleNamespace(size=SimpleNamespace(height=800)) for page in range(1, pages + 1)},
        iterate_items=lambda: iter((item, 0) for item in items),
    )

    structured = build_structured_content(document, parsed_pages=page_cells)

    assert [element.type for element in structured.elements[:3]] == ["heading", "paragraph", "paragraph"]
    assert conversions == pages * 3


def test_pdf_over_page_limit_fails_before_docling(monkeypatch):
    monkeypatch.setattr(parser, "_pdf_page_count", lambda _path: 500)
    monkeypatch.setattr(
        parser,
        "_get_document_converter",
        lambda *_args, **_kwargs: pytest.fail("the converter must not start for an over-limit PDF"),
    )

    with pytest.raises(ApiProblem) as error:
        parse_pdf_file(Path("large.pdf"), "large.pdf", 123)

    assert error.value.code == "page_limit_exceeded"
    assert "500" in error.value.message


def test_converter_receives_page_limit_and_timeout_partial_result_is_rejected(monkeypatch):
    calls = []

    class Converter:
        def convert(self, path, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(document=FakeDocument(), has_timeout_errors=lambda: True)

    monkeypatch.setattr(parser, "_pdf_page_count", lambda _path: 2)
    monkeypatch.setattr(parser, "_get_document_converter", lambda *_args, **_kwargs: Converter())

    with pytest.raises(ApiProblem) as error:
        parse_pdf_file(Path("slow.pdf"), "slow.pdf", 123)

    assert calls == [{"max_num_pages": 200}]
    assert error.value.code == "docling_timeout"
