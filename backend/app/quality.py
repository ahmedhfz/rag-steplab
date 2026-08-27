"""Reusable, deterministic quality calculations for the RAG pipeline."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any


def _clean_ids(values: Any) -> set[str]:
    if values is None or isinstance(values, (str, bytes, dict)):
        return set()
    try:
        items = iter(values)
    except TypeError:
        return set()
    return {
        str(value).strip()
        for value in items
        if value is not None and str(value).strip()
    }


def _source_element_ids(result: dict[str, Any]) -> set[str]:
    return _clean_ids(result.get("sourceElementIds", result.get("source_element_ids", [])))


def compute_retrieval_metrics(
    ranked_results: Sequence[dict[str, Any]] | Iterable[dict[str, Any]],
    relevant_element_ids: Iterable[str],
    *,
    top_k: int | None = None,
) -> dict[str, Any]:
    """Compute answerable-case retrieval metrics from a ranked result list.

    A case without relevant element IDs is an explicit no-answer/abstention
    case, not a retrieval failure. Its retrieval metrics are therefore null
    and excluded from aggregate retrieval averages.
    """

    results = list(ranked_results)
    if top_k is not None:
        results = results[: max(0, top_k)]
    expected = _clean_ids(relevant_element_ids)
    if not expected:
        return {
            "hitAtK": None,
            "precisionAtK": None,
            "recallAtK": None,
            "mrr": None,
            "retrievalEligible": False,
            "expectedElementCount": 0,
            "retrievedRelevantElementCount": 0,
            "firstRelevantRank": None,
        }

    relevant_ranks: list[int] = []
    retrieved_relevant: set[str] = set()
    for index, result in enumerate(results, start=1):
        matched = _source_element_ids(result).intersection(expected)
        if matched:
            relevant_ranks.append(index)
            retrieved_relevant.update(matched)

    return {
        "hitAtK": 1.0 if relevant_ranks else 0.0,
        "precisionAtK": len(relevant_ranks) / max(1, len(results)),
        "recallAtK": len(retrieved_relevant) / len(expected),
        "mrr": 1 / relevant_ranks[0] if relevant_ranks else 0.0,
        "retrievalEligible": True,
        "expectedElementCount": len(expected),
        "retrievedRelevantElementCount": len(retrieved_relevant),
        "firstRelevantRank": relevant_ranks[0] if relevant_ranks else None,
    }
