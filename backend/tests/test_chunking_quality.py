"""Turkish chunking regressions for the token, recursive and structure contracts."""

import re

import pytest

from app.chunking import TOKENIZER, chunk_structured


SENTENCES = (
    "Bu belge çalışma güvenliği, İstanbul şubesi ve Ankara deposundaki iş akışlarını açıklar. "
    "Çalışanların ağır yük taşırken koruyucu ekipman kullanması zorunludur. "
    "Şirket, öğütülmüş ürünleri güvenli şekilde saklamak için ölçülü depolama çözümleri uygular. "
)
PARAGRAPH = SENTENCES * 4
WORDS = set(re.findall(r"\w+", PARAGRAPH + " Giriş Ölçüm Sonuçları"))


def _structured() -> dict:
    return {
        "elements": [
            {"id": "h1", "type": "heading", "level": 1, "text": "Giriş", "page_numbers": [1]},
            {"id": "p1", "type": "paragraph", "text": PARAGRAPH, "page_numbers": [1]},
            {"id": "h2", "type": "heading", "level": 2, "text": "Ölçüm Sonuçları", "page_numbers": [2]},
            {"id": "p2", "type": "paragraph", "text": PARAGRAPH, "page_numbers": [2]},
        ]
    }


CONFIG = {"chunk_size_tokens": 64, "overlap_tokens": 16}


@pytest.mark.parametrize("strategy", ["fixed_token", "recursive_token", "structure_aware"])
def test_chunks_never_split_utf8_characters_or_exceed_token_size(strategy):
    drafts = chunk_structured(_structured(), strategy, CONFIG)

    assert drafts
    for draft in drafts:
        assert "�" not in draft.text
        assert draft.token_count == TOKENIZER.count(draft.text)
        assert draft.token_count <= CONFIG["chunk_size_tokens"]


def test_recursive_token_cuts_only_at_natural_word_boundaries():
    drafts = chunk_structured(_structured(), "recursive_token", CONFIG)
    fixed = chunk_structured(_structured(), "fixed_token", CONFIG)

    for draft in drafts:
        first = re.findall(r"\w+", draft.text)[0]
        last = re.findall(r"\w+", draft.text)[-1]
        assert first in WORDS and last in WORDS, draft.text
    # Paragraph and sentence boundaries make the recursive output observably
    # different from blind token windows.
    assert [draft.text for draft in drafts] != [draft.text for draft in fixed]
    assert sum(draft.text.endswith((".", "Giriş", "Sonuçları")) for draft in drafts) >= len(drafts) // 2


def test_recursive_token_keeps_short_paragraphs_whole():
    structured = {
        "elements": [
            {"id": f"p{index}", "type": "paragraph", "text": SENTENCES.strip(), "page_numbers": [1]}
            for index in range(4)
        ]
    }

    drafts = chunk_structured(structured, "recursive_token", {"chunk_size_tokens": 128, "overlap_tokens": 0})

    for draft in drafts:
        for paragraph in draft.text.split("\n\n"):
            assert paragraph == SENTENCES.strip()


@pytest.mark.parametrize("strategy", ["recursive_token", "structure_aware"])
def test_overlap_is_carried_for_long_elements(strategy):
    drafts = chunk_structured(_structured(), strategy, CONFIG)

    carried = 0
    for previous, current in zip(drafts, drafts[1:]):
        if set(previous.source_element_ids) & set(current.source_element_ids):
            words = re.findall(r"\w+", current.text)
            prefix = " ".join(words[:3])
            if prefix and prefix in " ".join(re.findall(r"\w+", previous.text)):
                carried += 1
    assert carried > 0


def test_structure_aware_does_not_emit_a_bare_heading_chunk():
    drafts = chunk_structured(_structured(), "structure_aware", CONFIG)

    assert all(draft.text not in {"Giriş", "Ölçüm Sonuçları"} for draft in drafts)
    assert drafts[0].text.startswith("Giriş\n\n")
    assert drafts[0].source_element_ids == ["h1", "p1"]


def test_oversized_single_word_falls_back_to_utf8_safe_windows():
    word = "çğıöşü" * 80
    structured = {"elements": [{"id": "p1", "type": "paragraph", "text": word, "page_numbers": [1]}]}

    drafts = chunk_structured(structured, "recursive_token", {"chunk_size_tokens": 32, "overlap_tokens": 0})

    assert "".join(draft.text for draft in drafts) == word
    assert all(draft.token_count <= 32 and "�" not in draft.text for draft in drafts)
