"""Deterministic chunking over the persisted normalized parse contract."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Any, Iterable


CHUNKER_VERSION = "rag-steplab-chunker-v1"


class LocalTokenizer:
    """Use cl100k_base when installed, with a deterministic fallback for tests."""

    def __init__(self) -> None:
        self._encoder = None
        try:
            import tiktoken

            self._encoder = tiktoken.get_encoding("cl100k_base")
        except Exception:  # pragma: no cover - fallback depends on environment
            self._encoder = None
        self.version = "local_cl100k_v1" if self._encoder is not None else "local_character_fallback_v1"

    def encode(self, text: str) -> list[int]:
        if self._encoder is not None:
            return list(self._encoder.encode(text, disallowed_special=()))
        # Fallback keeps tests and health endpoints usable without a native model.
        return [ord(char) for char in text]

    def decode(self, tokens: Iterable[int]) -> str:
        values = list(tokens)
        if self._encoder is not None:
            return self._encoder.decode(values)
        return "".join(chr(value) for value in values)

    def count(self, text: str) -> int:
        return len(self.encode(text))


TOKENIZER = LocalTokenizer()
TOKENIZER_VERSION = TOKENIZER.version


@dataclass(frozen=True)
class ElementRecord:
    id: str
    type: str
    text: str
    page_numbers: tuple[int, ...]
    level: int | None
    heading_path: tuple[str, ...]


@dataclass(frozen=True)
class ChunkDraft:
    ordinal: int
    text: str
    page_numbers: list[int]
    source_element_ids: list[str]
    heading_path: list[str]
    token_count: int
    character_count: int


def _value(item: Any, key: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        if key in item:
            return item[key]
        # API payloads use camelCase while persisted Pydantic dumps use snake_case.
        # Accept both at this boundary so provenance is never silently dropped.
        camel_key = re.sub(r"_([a-z])", lambda match: match.group(1).upper(), key)
        return item.get(camel_key, default)
    return getattr(item, key, default)


def _elements(structured: Any) -> list[ElementRecord]:
    raw = _value(structured, "elements", []) or []
    result: list[ElementRecord] = []
    stack: list[tuple[int, str]] = []
    for index, item in enumerate(raw):
        element_id = str(_value(item, "id", f"element-{index + 1}"))
        kind = str(_value(item, "type", "other"))
        text = str(_value(item, "text", "") or "").strip()
        page_numbers = tuple(
            sorted({int(page) for page in (_value(item, "page_numbers", []) or []) if int(page) > 0})
        )
        level_value = _value(item, "level", None)
        level = int(level_value) if isinstance(level_value, int) and level_value > 0 else None
        if kind == "heading":
            heading_level = level or 1
            while stack and stack[-1][0] >= heading_level:
                stack.pop()
            stack.append((heading_level, text))
        heading_path = tuple(value for _, value in stack if value)
        if text:
            result.append(
                ElementRecord(
                    id=element_id,
                    type=kind,
                    text=text,
                    page_numbers=page_numbers,
                    level=level,
                    heading_path=heading_path,
                )
            )
    return result


def _config_value(config: Any, name: str, default: int) -> int:
    value = _value(config, name, default)
    return int(value)


def _validate_config(config: Any) -> tuple[int, int]:
    size = _config_value(config, "chunk_size_tokens", 512)
    overlap = _config_value(config, "overlap_tokens", 64)
    if size < 32 or size > 4096:
        raise ValueError("chunk_size_tokens must be between 32 and 4096")
    if overlap < 0 or overlap >= size:
        raise ValueError("overlap_tokens must be smaller than chunk_size_tokens")
    if overlap > size // 4:
        raise ValueError("overlap_tokens must not exceed 25% of chunk_size_tokens")
    return size, overlap


def _window_drafts(
    records: list[ElementRecord], size: int, overlap: int, *, ordinal_start: int = 0
) -> list[ChunkDraft]:
    """Create windows from token segments while retaining exact provenance."""

    token_values: list[int] = []
    segment_indexes: list[int] = []
    for index, record in enumerate(records):
        if index:
            separator = TOKENIZER.encode("\n\n")
            token_values.extend(separator)
            segment_indexes.extend([-1] * len(separator))
        encoded = TOKENIZER.encode(record.text)
        token_values.extend(encoded)
        segment_indexes.extend([index] * len(encoded))

    if not token_values:
        return []
    step = max(1, size - overlap)
    drafts: list[ChunkDraft] = []
    start = 0
    ordinal = ordinal_start
    while start < len(token_values):
        end = min(start + size, len(token_values))
        text = TOKENIZER.decode(token_values[start:end]).strip()
        indexes = sorted({idx for idx in segment_indexes[start:end] if idx >= 0})
        source = [records[idx] for idx in indexes]
        if text and source:
            pages = sorted({page for record in source for page in record.page_numbers})
            headings = list(source[-1].heading_path or source[0].heading_path)
            drafts.append(
                ChunkDraft(
                    ordinal=ordinal,
                    text=text,
                    page_numbers=pages,
                    source_element_ids=[record.id for record in source],
                    heading_path=headings,
                    token_count=TOKENIZER.count(text),
                    character_count=len(text),
                )
            )
            ordinal += 1
        if end >= len(token_values):
            break
        start += step
    return drafts


def _split_recursive(record: ElementRecord, size: int, overlap: int) -> list[ChunkDraft]:
    text = record.text
    if TOKENIZER.count(text) <= size:
        return _window_drafts([record], size, overlap)
    pieces = [piece.strip() for piece in re.split(r"\n\s*\n|(?<=[.!?])\s+|\n|(?<=,|;)\s+|\s+", text) if piece.strip()]
    if not pieces:
        return _window_drafts([record], size, overlap)
    # Greedily group semantic pieces, then use token windows only for a single
    # oversized piece. This exposes the recursive boundary without hiding it.
    groups: list[str] = []
    current = ""
    for piece in pieces:
        candidate = f"{current} {piece}".strip()
        if current and TOKENIZER.count(candidate) > size:
            groups.append(current)
            current = piece
        else:
            current = candidate
    if current:
        groups.append(current)
    drafts: list[ChunkDraft] = []
    for group in groups:
        group_record = ElementRecord(
            id=record.id,
            type=record.type,
            text=group,
            page_numbers=record.page_numbers,
            level=record.level,
            heading_path=record.heading_path,
        )
        if TOKENIZER.count(group) > size:
            drafts.extend(_window_drafts([group_record], size, overlap))
        else:
            drafts.extend(_window_drafts([group_record], size, overlap))
    return drafts


def _recursive(records: list[ElementRecord], size: int, overlap: int) -> list[ChunkDraft]:
    result: list[ChunkDraft] = []
    for record in records:
        for draft in _split_recursive(record, size, overlap):
            result.append(
                ChunkDraft(
                    ordinal=len(result),
                    text=draft.text,
                    page_numbers=draft.page_numbers,
                    source_element_ids=draft.source_element_ids,
                    heading_path=draft.heading_path,
                    token_count=draft.token_count,
                    character_count=draft.character_count,
                )
            )
    return result


def _structure_aware(records: list[ElementRecord], size: int, overlap: int) -> list[ChunkDraft]:
    sections: list[list[ElementRecord]] = []
    current: list[ElementRecord] = []
    for record in records:
        if record.type == "heading" and current:
            sections.append(current)
            current = []
        current.append(record)
    if current:
        sections.append(current)

    result: list[ChunkDraft] = []
    for section in sections:
        combined = "\n\n".join(record.text for record in section)
        if TOKENIZER.count(combined) <= size:
            source = section
            result.append(
                ChunkDraft(
                    ordinal=len(result),
                    text=combined.strip(),
                    page_numbers=sorted({p for r in source for p in r.page_numbers}),
                    source_element_ids=[r.id for r in source],
                    heading_path=list(source[-1].heading_path or source[0].heading_path),
                    token_count=TOKENIZER.count(combined.strip()),
                    character_count=len(combined.strip()),
                )
            )
            continue
        # Preserve heading provenance in every fallback piece, while tables and
        # lists remain intact whenever their individual text fits.
        for record in section:
            for draft in _split_recursive(record, size, overlap):
                result.append(
                    ChunkDraft(
                        ordinal=len(result),
                        text=draft.text,
                        page_numbers=draft.page_numbers,
                        source_element_ids=draft.source_element_ids,
                        heading_path=draft.heading_path,
                        token_count=draft.token_count,
                        character_count=draft.character_count,
                    )
                )
    return result


def chunk_structured(structured: Any, strategy: str, config: Any) -> list[ChunkDraft]:
    size, overlap = _validate_config(config)
    records = _elements(structured)
    if strategy == "fixed_token":
        return _window_drafts(records, size, overlap)
    if strategy == "recursive_token":
        return _recursive(records, size, overlap)
    if strategy == "structure_aware":
        return _structure_aware(records, size, overlap)
    raise ValueError(f"Unknown chunk strategy: {strategy}")


def config_hash(config: Any) -> str:
    size, overlap = _validate_config(config)
    value = f"{size}:{overlap}:{TOKENIZER_VERSION}:{CHUNKER_VERSION}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
