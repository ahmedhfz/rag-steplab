from types import SimpleNamespace

from app.parser import _TextLine, _build_page_elements, build_structured_content


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
