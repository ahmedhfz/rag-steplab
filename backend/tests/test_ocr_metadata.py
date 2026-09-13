from types import SimpleNamespace as NS

from app import parser
from app.parser import _source_metadata
from app.schemas import ParsedElement


def cell(text, left, ocr, confidence=None):
    return NS(text=text, from_ocr=ocr, confidence=confidence,
              rect=NS(r_x0=left, r_x1=left+20, r_x2=left+20, r_x3=left,
                      r_y0=10, r_y1=10, r_y2=20, r_y3=20))


def test_mixed_retains_per_cell_origin_without_native_confidence():
    item = NS(prov=[NS(page_no=1, bbox=NS(l=0, t=0, r=100, b=30, coord_origin="TOPLEFT"))])
    metadata = _source_metadata(item, NS(pages={}), {1: [cell("native", 0, False, 1), cell("pirinç", 30, True, .95)]})
    assert metadata["source_origin"] == "mixed"
    assert [r.origin for r in metadata["source_regions"]] == ["native_pdf", "ocr"]
    assert [r.confidence for r in metadata["source_regions"]] == [None, .95]
    assert metadata["source_regions"][1].bbox == [30, 10, 50, 20]


def test_legacy_elements_remain_unknown():
    element = ParsedElement(id="old", type="paragraph", text="old record")
    assert element.source_origin == "unknown"
    assert element.source_regions == []


def test_no_cells_do_not_invent_native_origin():
    item = NS(prov=[NS(page_no=1, bbox=NS(l=0, t=0, r=100, b=30, coord_origin="TOPLEFT"))])
    metadata = _source_metadata(item, NS(pages={}), {})
    assert metadata["source_origin"] == "unknown"
    assert metadata["source_regions"][0].confidence is None


def test_bottom_left_cells_are_converted_to_pdf_top_left():
    item = NS(prov=[NS(page_no=1, bbox=NS(l=0, t=0, r=100, b=30, coord_origin="TOPLEFT"))])
    native = cell("native", 0, False)
    native.rect.coord_origin = "BOTTOMLEFT"
    for index in range(4):
        setattr(native.rect, f"r_y{index}", 100 - getattr(native.rect, f"r_y{index}"))
    metadata = _source_metadata(item, NS(pages={1: NS(size=NS(height=100))}), {1: [native]})
    assert metadata["source_origin"] == "native_pdf"
    assert metadata["source_regions"][0].bbox == [0, 10, 20, 20]


def test_table_caption_ocr_contribution_makes_table_mixed():
    caption = NS(
        prov=[
            NS(
                page_no=1,
                bbox=NS(l=5, t=5, r=50, b=12, coord_origin="TOPLEFT"),
            )
        ]
    )
    item = NS(
        prov=[NS(page_no=1, bbox=NS(l=0, t=0, r=100, b=30, coord_origin="TOPLEFT"))],
        captions=[NS(resolve=lambda _document: caption)],
    )
    metadata = _source_metadata(item, NS(pages={}), {1: [cell("native", 0, False)]})
    assert metadata["source_origin"] == "mixed"
    assert any(region.origin == "ocr" for region in metadata["source_regions"])


def test_ocr_evidence_wins_over_unmatched_geometry_box():
    caption = NS(
        prov=[
            NS(
                page_no=1,
                bbox=NS(l=5, t=5, r=50, b=12, coord_origin="TOPLEFT"),
            )
        ]
    )
    item = NS(
        prov=[NS(page_no=1, bbox=NS(l=0, t=0, r=4, b=4, coord_origin="TOPLEFT"))],
        captions=[NS(resolve=lambda _document: caption)],
    )
    metadata = _source_metadata(item, NS(pages={}), {1: [cell("ocr", 5, True, .8)]})
    assert metadata["source_origin"] == "ocr"


def test_converter_explicitly_selects_pdf_aware_turkish_onnx_profile(tmp_path, monkeypatch):
    class DummyPipelineOptions:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class DummyOcrOptions:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class DummyPdfFormatOption:
        def __init__(self, *, pipeline_options):
            self.pipeline_options = pipeline_options

    class DummyConverter:
        def __init__(self, *, format_options):
            self.format_to_options = format_options

    monkeypatch.setattr(parser, "InputFormat", NS(PDF="pdf"))
    monkeypatch.setattr(parser, "DocumentConverter", DummyConverter)
    monkeypatch.setattr(parser, "PdfFormatOption", DummyPdfFormatOption)
    monkeypatch.setattr(parser, "PdfPipelineOptions", DummyPipelineOptions)
    monkeypatch.setattr(parser, "RapidOcrOptions", DummyOcrOptions)
    monkeypatch.setattr(parser, "HeadingHierarchyOptions", None)
    monkeypatch.setattr(parser, "OcrMode", NS(PDF_AWARE_LAYOUT_REGIONS="pdf_aware_layout_regions"))
    monkeypatch.setattr(parser, "asset_manifest", lambda: {"profile": "test"})
    monkeypatch.setattr(parser, "model_root", lambda: tmp_path)

    converter = parser._build_document_converter()
    pipeline = converter.format_to_options["pdf"].pipeline_options
    ocr = pipeline.kwargs["ocr_options"]
    assert pipeline.kwargs["do_ocr"] is True
    assert pipeline.kwargs["force_backend_text"] is False
    assert ocr.kwargs["mode"] == "pdf_aware_layout_regions"
    assert ocr.kwargs["lang"] == ["tr"]
    assert ocr.kwargs["backend"] == "onnxruntime"
    assert ocr.kwargs["rec_model_path"] == str(tmp_path / parser.ARTIFACTS["rec"][0])
