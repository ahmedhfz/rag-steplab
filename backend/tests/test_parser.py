from pathlib import Path
from types import SimpleNamespace

import pytest

from app.errors import ApiProblem
from app.parser import _TextLine, _build_page_elements, build_structured_content, parse_pdf_file


def semantic_item(label, text, box=None, page=1, **kwargs):
    bbox = SimpleNamespace(l=box[0], t=box[1], r=box[2], b=box[3], coord_origin="TOPLEFT") if box else None
    return SimpleNamespace(label=label, text=text, prov=[SimpleNamespace(page_no=page, bbox=bbox)], **kwargs)


def semantic_document(items):
    return SimpleNamespace(pages={1: SimpleNamespace(size=SimpleNamespace(height=800))},
                           iterate_items=lambda: iter((item, 0) for item in items))


def parsed_page_cells(*boxes):
    cells = []
    for left, top, right, bottom in boxes:
        box = SimpleNamespace(l=left, t=top, r=right, b=bottom)
        box.to_top_left_origin = lambda height, box=box: box
        cells.append(SimpleNamespace(to_bounding_box=lambda box=box: box))
    return [SimpleNamespace(page_no=1, parsed_page=SimpleNamespace(textline_cells=cells))]


@pytest.mark.parametrize("text", ["Not", "Amaç", "GÜNCEL", "Ödünç kaydı", "Important caveat"])
def test_body_sized_label_attached_to_explanation_is_not_a_section(text):
    items = [semantic_item("section_header", text, (50, 100, 150, 110), level=1),
             semantic_item("text", "Explanation continues on two lines.", (50, 112, 350, 134))]
    cells = parsed_page_cells((50, 100, 150, 110), (50, 112, 350, 122), (50, 124, 200, 134))
    structured = build_structured_content(semantic_document(items), parsed_pages=cells)
    assert [e.type for e in structured.elements] == ["paragraph", "paragraph"]
    assert structured.elements[0].text == text
    assert structured.elements[0].level is None


@pytest.mark.parametrize("text,height,gap,next_type", [
    ("Amaç", 15, 2, "text"),  # larger true section title
    ("Not", 10, 12, "text"),  # separated short heading
    ("2.1 Amaç", 10, 2, "text"),  # structural numbering
    ("IV. Scope", 10, 2, "text"),
    ("Adımlar", 10, 2, "list_item"),  # list-opening subheading
])
def test_structural_heading_signals_are_preserved(text, height, gap, next_type):
    next_top = 100 + height + gap
    items = [semantic_item("section_header", text, (50, 100, 150, 100 + height), level=2),
             semantic_item(next_type, "Body text", (50, next_top, 350, next_top + 10))]
    cells = parsed_page_cells((50, 100, 150, 100 + height), (50, next_top, 350, next_top + 10))
    assert build_structured_content(semantic_document(items), parsed_pages=cells).elements[0].type == "heading"


def test_missing_typography_does_not_demote_short_heading():
    items = [semantic_item("section_header", "Amaç", (50, 100, 150, 110), level=2),
             semantic_item("text", "Explanation", (50, 112, 350, 122))]
    assert build_structured_content(semantic_document(items)).elements[0].type == "heading"


def test_inline_bold_label_requires_same_page_and_nearby_value():
    items = [semantic_item("section_header", "Status", (50, 100, 90, 110), level=1),
             semantic_item("text", "Current", (94, 100, 140, 110))]
    cells = parsed_page_cells((50, 100, 90, 110), (94, 100, 140, 110))
    document = semantic_document(items)
    assert build_structured_content(document, parsed_pages=cells).elements[0].type == "paragraph"
    items[1].prov[0].page_no = 2
    assert build_structured_content(document, parsed_pages=cells).elements[0].type == "heading"


def test_real_pdf_callout_geometry_keeps_the_neighboring_section_title():
    # Page 23 of Gundelik_Yasam_RAG_Stress_Test_28_Sayfa.pdf, top-left coordinates.
    items = [semantic_item("section_header", "21. Ev Kütüphanesi ve Medya Kataloğu",
                           (45.45, 39.714, 335.358, 61.674), level=1),
             semantic_item("section_header", "Ödünç kaydı", (50.85, 190.898, 113.598, 201.365), level=1),
             semantic_item("text", "B-009, 5 Eylül 2026’da P-03 Mert Kaya’ya verilmiştir.",
                           (50.85, 202.948, 550, 225.465))]
    cells = parsed_page_cells((45.45, 39.714, 335.358, 61.674),
                              (50.85, 190.898, 113.598, 201.365),
                              (50.85, 202.948, 550, 213.415), (50.85, 214.998, 450, 225.465))
    assert [e.type for e in build_structured_content(semantic_document(items), parsed_pages=cells).elements] == [
        "heading", "paragraph", "paragraph"]


def test_parse_to_structure_aware_chunking_keeps_text_and_real_section_boundaries(monkeypatch):
    from app.chunking import chunk_structured

    items = [semantic_item("section_header", "1. Library", (50, 50, 250, 70), level=1),
             semantic_item("section_header", "Ödünç kaydı", (50, 100, 150, 110), level=1),
             semantic_item("text", "B-009 was borrowed by P-03.", (50, 112, 350, 122)),
             semantic_item("section_header", "2. Garden", (50, 160, 250, 180), level=1),
             semantic_item("text", "Water the plants.", (50, 190, 350, 200))]
    document = semantic_document(items)
    pages = parsed_page_cells((50, 100, 150, 110), (50, 112, 350, 122))
    monkeypatch.setattr("app.parser._get_document_converter", lambda *_args: SimpleNamespace(
        convert=lambda path: SimpleNamespace(document=document, pages=pages)))
    parsed = parse_pdf_file(Path("lesson.pdf"), "lesson.pdf", 123)
    before = chunk_structured(build_structured_content(document), "structure_aware",
                              {"chunk_size_tokens": 512, "overlap_tokens": 0})
    after = chunk_structured(parsed.structured.model_dump(by_alias=True), "structure_aware",
                             {"chunk_size_tokens": 512, "overlap_tokens": 0})
    assert len(before) == 3
    assert len(after) == 2
    assert after[0].heading_path == ["1. Library"]
    assert after[1].heading_path == ["2. Garden"]
    assert "Ödünç kaydı" in after[0].text and "B-009" in after[0].text
    assert after[0].source_element_ids == ["element-1", "element-2", "element-3"]
    assert all(chunk.page_numbers == [1] for chunk in after)
    assert parsed.summary.heading_count == 2
    assert "# Ödünç kaydı" not in parsed.markdown
    assert parsed.run_metadata["headingClassifierVersion"] == "context-v1"


@pytest.mark.parametrize("text", ["Miktar", "Durum", "Not", "Amaç", "GÜNCEL", "Ödünç kaydı"])
def test_heading_inside_table_is_text_but_same_title_outside_is_preserved(text):
    items = [semantic_item("section_header", text, (10, 10, 90, 22), level=2),
             semantic_item("section_header", text, (10, 50, 90, 62), level=2),
             semantic_item("table", "", (5, 45, 300, 150))]
    structured = build_structured_content(semantic_document(items))
    assert [e.type for e in structured.elements] == ["heading", "paragraph", "table"]
    assert structured.elements[0].level == 2
    assert structured.elements[1].level is None
    assert structured.elements[1].text == text
    assert structured.elements[1].page_numbers == [1]


@pytest.mark.parametrize("container", ["table", "key_value_area", "inline", "picture"])
def test_local_container_overrides_layout_heading_without_geometry(container):
    node = SimpleNamespace(label=container, parent=None)
    parent = SimpleNamespace(cref="#/groups/0", resolve=lambda document: node)
    item = semantic_item("section_header", "Local label", parent=parent, level=1)
    assert build_structured_content(semantic_document([item])).elements[0].type == "paragraph"


def test_form_area_can_contain_a_real_checklist_section_title():
    node = SimpleNamespace(label="form_area", parent=None)
    parent = SimpleNamespace(cref="#/groups/0", resolve=lambda document: node)
    item = semantic_item("section_header", "Departure checklist", parent=parent, level=2)
    assert build_structured_content(semantic_document([item])).elements[0].type == "heading"


def test_table_geometry_is_page_and_coordinate_origin_aware():
    heading = semantic_item("section_header", "Miktar", (10, 50, 90, 62), level=1)
    table = semantic_item("table", "", (5, 755, 300, 650))
    table.prov[0].bbox.coord_origin = "BOTTOMLEFT"
    document = semantic_document([heading, table])
    assert build_structured_content(document).elements[0].type == "paragraph"
    table.prov[0].page_no = 2
    assert build_structured_content(document).elements[0].type == "heading"


def test_caption_and_bold_paragraph_do_not_become_headings():
    items = [semantic_item("caption", "Figure 1. Overview"),
             semantic_item("text", "Not", formatting=SimpleNamespace(bold=True)),
             semantic_item("section_header", "Amaç", level=2)]
    assert [e.type for e in build_structured_content(semantic_document(items)).elements] == [
        "other", "paragraph", "heading"]


class FakeTable:
    label = "table"
    prov = [SimpleNamespace(page_no=2)]
    data = SimpleNamespace(grid=[[SimpleNamespace(text="Name"), SimpleNamespace(text="Value")]])

    def export_to_markdown(self, document):
        return "| Name | Value |\n| --- | --- |"


class FakeDocument:
    pages = {1: object(), 2: object()}

    def iterate_items(self):
        return iter([
            (SimpleNamespace(label="title", text="RAG StepLab", prov=[SimpleNamespace(page_no=1)], level=1), 0),
            (SimpleNamespace(label="text", text="A paragraph.", prov=[SimpleNamespace(page_no=1)]), 0),
            (SimpleNamespace(label="list_item", text="First item", prov=[SimpleNamespace(page_no=2)]), 0),
            (FakeTable(), 0),
        ])


def test_build_structured_content_normalizes_docling_items():
    structured = build_structured_content(FakeDocument())

    assert [element.type for element in structured.elements] == ["heading", "paragraph", "list", "table"]
    assert structured.pages[0].page_number == 1
    assert [element.text for element in structured.pages[0].elements] == ["RAG StepLab", "A paragraph."]
    assert structured.pages[1].elements[-1].table is not None
    assert structured.pages[1].elements[-1].table.rows == [["Name", "Value"]]


def test_build_page_elements_preserves_headings_and_joins_paragraph_lines():
    lines = [
        _TextLine(text="RAG StepLab", top=10, left=10, height=18, font_key="heading"),
        _TextLine(text="Retrieval uses persisted", top=40, left=10, height=10, font_key="body"),
        _TextLine(text="document chunks.", top=51, left=10, height=10, font_key="body"),
        _TextLine(text="- Dense retrieval", top=80, left=10, height=10, font_key="body"),
    ]

    elements = _build_page_elements(lines, page_number=1, first_element_number=4)

    assert [element.id for element in elements] == ["element-4", "element-5", "element-6"]
    assert [element.type for element in elements] == ["heading", "paragraph", "list"]
    assert elements[1].text == "Retrieval uses persisted document chunks."
    assert elements[2].text == "Dense retrieval"


def test_parse_pdf_file_uses_full_document_converter_and_existing_normalizer(monkeypatch):
    class Converter:
        def convert(self, path):
            assert path == Path("lesson.pdf")
            return SimpleNamespace(document=FakeDocument())

    def fail_if_legacy_text_layer_is_used(*_args, **_kwargs):
        raise AssertionError("legacy text-cell extraction must not run")

    monkeypatch.setattr("app.parser._get_document_converter", lambda *_args, **_kwargs: Converter())
    monkeypatch.setattr("app.parser._extract_text_lines", fail_if_legacy_text_layer_is_used)

    parsed = parse_pdf_file(Path("lesson.pdf"), "lesson.pdf", 123)

    assert parsed.document.page_count == 2
    assert parsed.summary is not None
    assert parsed.summary.table_count == 1
    assert parsed.structured is not None
    assert parsed.structured.elements[-1].type == "table"
    assert parsed.run_metadata["mode"] == "full_document_converter"


def test_parse_pdf_file_reports_real_lifecycle_checkpoints(monkeypatch):
    class Converter:
        def convert(self, _path):
            return SimpleNamespace(document=FakeDocument())

    monkeypatch.setattr("app.parser._get_document_converter", lambda *_args, **_kwargs: Converter())
    checkpoints = []

    parsed = parse_pdf_file(
        Path("lesson.pdf"),
        "lesson.pdf",
        123,
        progress_callback=lambda progress, phase: checkpoints.append((progress, phase)),
    )

    assert parsed.summary is not None
    assert checkpoints == [
        (25, "docling_starting"),
        (30, "docling_ready"),
        (72, "docling_converted"),
        (90, "content_normalized"),
    ]


def test_parse_pdf_file_accepts_a_document_without_semantic_tables(monkeypatch):
    document = SimpleNamespace(
        pages={1: object()},
        iterate_items=lambda: iter([(SimpleNamespace(
            label="text",
            text="Only text",
            prov=[SimpleNamespace(page_no=1)],
        ), 0)]),
    )
    monkeypatch.setattr(
        "app.parser._get_document_converter",
        lambda *_args, **_kwargs: SimpleNamespace(convert=lambda _path: SimpleNamespace(document=document)),
    )

    result = parse_pdf_file(Path("lesson.pdf"), "lesson.pdf", 123)

    assert result.summary is not None
    assert result.summary.table_count == 0
