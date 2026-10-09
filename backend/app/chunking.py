"""Deterministic chunking over the persisted normalized parse contract."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Iterable


CHUNKER_VERSION = "rag-steplab-chunker-v2"
CHUNKER_VERSIONS = {
    "fixed_token": CHUNKER_VERSION,
    "recursive_token": "rag-steplab-recursive-chunker-v4",
    "structure_aware": "rag-steplab-structure-chunker-v4",
}


def chunker_version_for_strategy(strategy: str) -> str:
    """Return the output contract version for one chunking strategy."""

    try:
        return CHUNKER_VERSIONS[strategy]
    except KeyError as exc:
        raise ValueError(f"Unknown chunk strategy: {strategy}") from exc


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

    def token_bytes(self, tokens: Iterable[int]) -> list[bytes]:
        """Return raw token bytes; byte-level BPE may split one character."""

        if self._encoder is not None:
            return [self._encoder.decode_single_token_bytes(value) for value in tokens]
        return [chr(value).encode("utf-8") for value in tokens]

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


@dataclass(frozen=True)
class _TokenStream:
    tokens: list[int]
    owners: list[int]
    # Byte offset of every token start plus the final byte length. Windows are
    # cut on these offsets and then aligned to UTF-8 character starts, so a
    # byte-level BPE token boundary inside "ş" or "ı" never yields U+FFFD.
    offsets: list[int]
    data: bytes


def _token_stream(texts: list[str]) -> _TokenStream:
    tokens: list[int] = []
    owners: list[int] = []
    for index, text in enumerate(texts):
        if index:
            separator = TOKENIZER.encode("\n\n")
            tokens.extend(separator)
            owners.extend([-1] * len(separator))
        encoded = TOKENIZER.encode(text)
        tokens.extend(encoded)
        owners.extend([index] * len(encoded))
    offsets = [0]
    parts: list[bytes] = []
    for value in TOKENIZER.token_bytes(tokens):
        parts.append(value)
        offsets.append(offsets[-1] + len(value))
    return _TokenStream(tokens=tokens, owners=owners, offsets=offsets, data=b"".join(parts))


def _char_start(data: bytes, position: int) -> int:
    while 0 < position < len(data) and (data[position] & 0xC0) == 0x80:
        position -= 1
    return position


def _stream_text(stream: _TokenStream, start: int, end: int) -> str:
    left = _char_start(stream.data, stream.offsets[start])
    right = _char_start(stream.data, stream.offsets[end])
    return stream.data[left:right].decode("utf-8").strip()


def _token_windows(stream: _TokenStream, size: int, overlap: int) -> list[tuple[int, int, str]]:
    """Return UTF-8 safe ``(start, end, text)`` windows of at most ``size`` tokens.

    A character split across two tokens belongs to the window where it starts.
    Re-encoding a cut substring can differ from the source token slice, so the
    window shrinks until its persisted text honours the token-size contract.
    """

    windows: list[tuple[int, int, str]] = []
    total = len(stream.tokens)
    start = 0
    while start < total:
        end = min(start + size, total)
        text = _stream_text(stream, start, end)
        while end > start + 1 and TOKENIZER.count(text) > size:
            end -= 1
            text = _stream_text(stream, start, end)
        windows.append((start, end, text))
        if end >= total:
            break
        start = max(start + 1, end - overlap)
    return windows


def _window_drafts(
    records: list[ElementRecord], size: int, overlap: int, *, ordinal_start: int = 0
) -> list[ChunkDraft]:
    """Create fixed token windows while retaining exact provenance."""

    stream = _token_stream([record.text for record in records])
    drafts: list[ChunkDraft] = []
    ordinal = ordinal_start
    for start, end, text in _token_windows(stream, size, overlap):
        indexes = sorted({idx for idx in stream.owners[start:end] if idx >= 0})
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
    return drafts


@dataclass(frozen=True)
class _Piece:
    """A natural-boundary text unit that is already within the chunk size."""

    record: ElementRecord
    text: str
    # Separator used before this piece when the previous piece is part of the
    # same element; pieces of different elements are separated by a blank line.
    joiner: str = "\n\n"


# Recursive separator hierarchy: paragraph -> line -> sentence -> clause ->
# word. Only a single word longer than the chunk size reaches token windows.
_SEPARATORS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\n\s*\n"), "\n\n"),
    (re.compile(r"\n"), "\n"),
    (re.compile(r"(?<=[.!?…])\s+"), " "),
    (re.compile(r"(?<=[,;:])\s+"), " "),
    (re.compile(r"\s+"), " "),
)


def _split_text(text: str, size: int, level: int = 0, joiner: str = "\n\n") -> list[tuple[str, str]]:
    """Split text at the coarsest natural boundary that fits ``size``."""

    if TOKENIZER.count(text) <= size:
        return [(joiner, text)]
    for index in range(level, len(_SEPARATORS)):
        pattern, separator = _SEPARATORS[index]
        parts = [part.strip() for part in pattern.split(text) if part.strip()]
        if len(parts) > 1:
            result: list[tuple[str, str]] = []
            for position, part in enumerate(parts):
                result.extend(_split_text(part, size, index + 1, joiner if position == 0 else separator))
            return result
    # No natural boundary is left (for example a very long URL or identifier).
    windows = _token_windows(_token_stream([text]), size, 0)
    return [
        (joiner if position == 0 else "", window_text)
        for position, (_, _, window_text) in enumerate(windows)
        if window_text
    ]


def _split_table_record(record: ElementRecord, size: int) -> list[str]:
    """Split Markdown tables by complete rows and repeat their header."""

    lines = [line.strip() for line in record.text.splitlines() if line.strip()]
    if len(lines) < 3 or not all(line.startswith("|") for line in lines):
        return []
    header = lines[:2]
    body = lines[2:]
    groups: list[str] = []
    current = header[:]
    for row in body:
        candidate = "\n".join(current + [row])
        if len(current) > len(header) and TOKENIZER.count(candidate) > size:
            groups.append("\n".join(current))
            current = header[:]
            candidate = "\n".join(current + [row])
        if TOKENIZER.count(candidate) <= size:
            current.append(row)
            continue
        # A single pathological row cannot retain the Markdown table shape;
        # fall back to the natural-boundary splitter for that row only.
        if len(current) > len(header):
            groups.append("\n".join(current))
        groups.extend(text for _, text in _split_text(row, size))
        current = header[:]
    if len(current) > len(header):
        groups.append("\n".join(current))
    return [group for group in groups if group.strip()]


def _record_pieces(record: ElementRecord, size: int) -> list[_Piece]:
    if TOKENIZER.count(record.text) <= size:
        return [_Piece(record=record, text=record.text)]
    if record.type == "table":
        groups = _split_table_record(record, size)
        if groups:
            return [
                _Piece(record=record, text=text, joiner="\n\n" if position == 0 else joiner)
                for group in groups
                for position, (joiner, text) in enumerate(_split_text(group, size))
            ]
    return [_Piece(record=record, text=text, joiner=joiner) for joiner, text in _split_text(record.text, size)]


def _join_pieces(pieces: list[_Piece]) -> str:
    parts: list[str] = []
    for index, piece in enumerate(pieces):
        if index:
            same_record = pieces[index - 1].record.id == piece.record.id
            parts.append(piece.joiner if same_record else "\n\n")
        parts.append(piece.text)
    return "".join(parts).strip()


def _overlap_tail(pieces: list[_Piece], overlap: int) -> list[_Piece]:
    """Carry up to ``overlap`` tokens, cutting a long piece only at a word start."""

    if overlap <= 0:
        return []
    tail: list[_Piece] = []
    for piece in reversed(pieces):
        candidate = [piece] + tail
        if TOKENIZER.count(_join_pieces(candidate)) <= overlap:
            tail = candidate
            continue
        if piece.record.type != "table":
            # A shorter suffix never needs more tokens, so binary-search the
            # longest word-aligned suffix that still fits the overlap budget.
            starts = [match.start() for match in re.finditer(r"\S+", piece.text)][1:]
            low, high, best = 0, len(starts) - 1, None
            while low <= high:
                middle = (low + high) // 2
                suffix = _Piece(record=piece.record, text=piece.text[starts[middle]:], joiner=piece.joiner)
                if TOKENIZER.count(_join_pieces([suffix] + tail)) <= overlap:
                    best = suffix
                    high = middle - 1
                else:
                    low = middle + 1
            if best is not None:
                tail = [best] + tail
        break
    return tail


def _draft_from_pieces(pieces: list[_Piece], ordinal: int) -> ChunkDraft | None:
    text = _join_pieces(pieces)
    if not text:
        return None
    records: list[ElementRecord] = []
    for piece in pieces:
        if all(record.id != piece.record.id for record in records):
            records.append(piece.record)
    return ChunkDraft(
        ordinal=ordinal,
        text=text,
        page_numbers=sorted({page for record in records for page in record.page_numbers}),
        source_element_ids=[record.id for record in records],
        heading_path=list(records[-1].heading_path or records[0].heading_path),
        token_count=TOKENIZER.count(text),
        character_count=len(text),
    )


def _pack_pieces(
    pieces: list[_Piece],
    size: int,
    overlap: int,
    *,
    ordinal_start: int = 0,
) -> list[ChunkDraft]:
    """Greedily pack natural pieces; never cut inside a piece or a table row."""

    drafts: list[ChunkDraft] = []
    current: list[_Piece] = []

    def emit(values: list[_Piece]) -> None:
        draft = _draft_from_pieces(values, ordinal_start + len(drafts))
        if draft is not None:
            drafts.append(draft)

    for piece in pieces:
        if not current or TOKENIZER.count(_join_pieces(current + [piece])) <= size:
            current = current + [piece]
            continue
        # A heading belongs with the content after it: move trailing headings
        # forward when they fit instead of ending a chunk on a bare heading.
        moved = 0
        while len(current) - moved > 1 and current[-1 - moved].record.type == "heading":
            moved += 1
        if moved and TOKENIZER.count(_join_pieces(current[-moved:] + [piece])) <= size:
            emit(current[:-moved])
            current = current[-moved:] + [piece]
            continue
        emit(current)
        # Shrink (not drop) the overlap when the next piece leaves less room.
        budget = min(overlap, size - TOKENIZER.count(_join_pieces([piece])) - 2)
        current = _overlap_tail(current, budget) + [piece]
        while len(current) > 1 and TOKENIZER.count(_join_pieces(current)) > size:
            current.pop(0)
    if current:
        emit(current)
    return drafts


def _recursive(records: list[ElementRecord], size: int, overlap: int) -> list[ChunkDraft]:
    # Elements are paragraph-level boundaries. Oversized elements descend to
    # line, sentence, clause and word boundaries; the packer then fills chunks
    # without cutting inside those pieces and carries a word-aligned overlap.
    pieces: list[_Piece] = []
    for record in records:
        pieces.extend(_record_pieces(record, size))
    return _pack_pieces(pieces, size, overlap)


def _structure_aware(records: list[ElementRecord], size: int, overlap: int) -> list[ChunkDraft]:
    sections: list[list[ElementRecord]] = []
    current: list[ElementRecord] = []
    current_root_level: int | None = None
    for record in records:
        if record.type == "heading":
            heading_level = record.level or 1
            if current_root_level is None and heading_level <= 2:
                if current:
                    sections.append(current)
                    current = []
                current_root_level = heading_level
            elif heading_level <= 2 and current:
                # A level-1 parent immediately followed by its first level-2
                # child becomes that child's root. Subsequent level-2 siblings
                # start a new semantic section, while level-3 descendants stay
                # attached to the active root.
                parent_only = (
                    len(current) == 1
                    and current[0].type == "heading"
                    and (current[0].level or 1) < heading_level
                )
                if parent_only:
                    current_root_level = heading_level
                elif current_root_level == 1 and heading_level == 2:
                    sections.append(current)
                    current = []
                    current_root_level = heading_level
                elif current_root_level is not None and heading_level <= current_root_level:
                    sections.append(current)
                    current = []
                    current_root_level = heading_level
        current.append(record)
    if current:
        sections.append(current)

    result: list[ChunkDraft] = []
    for section in sections:
        whole = [_Piece(record=record, text=record.text) for record in section]
        if TOKENIZER.count(_join_pieces(whole)) <= size:
            draft = _draft_from_pieces(whole, len(result))
            if draft is not None:
                result.append(draft)
            continue
        # Preserve the section boundary while packing natural pieces with a
        # word-aligned overlap. Tables are split only between complete rows.
        pieces: list[_Piece] = []
        for record in section:
            pieces.extend(_record_pieces(record, size))
        result.extend(_pack_pieces(pieces, size, overlap, ordinal_start=len(result)))
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


def effective_config(config: Any) -> dict[str, int]:
    """Return only the validated/defaulted values that affect chunk output."""

    size, overlap = _validate_config(config)
    return {"chunk_size_tokens": size, "overlap_tokens": overlap}


def config_hash(config: Any) -> str:
    canonical = effective_config(config)
    value = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
