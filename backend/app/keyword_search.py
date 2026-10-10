"""Keyword-branch semantics shared by PostgreSQL FTS and in-memory retrieval.

Production ranks chunks with ``ts_rank(to_tsvector('simple', text),
to_tsquery('simple', 't1 | t2 | ...'))``. The in-memory repository and the
local retrieval stage use :func:`ts_rank_score`, which reproduces that formula
for the unweighted ``simple`` vectors, so tests exercise production ranking
instead of a substring heuristic.

The branch stays an OR query on purpose: the ``simple`` configuration has no
stemming, so requiring every term (AND) would drop Turkish inflected forms such
as "depoda" for "depo" and leave the hybrid keyword branch nearly empty.
``ts_rank`` averages per-term evidence, so chunks matching more distinct
content terms still rank higher. Function words are removed because they match
almost every chunk and would otherwise dominate that average.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable

KEYWORD_TERM_VERSION = "simple-or-stopword-v1"

# Letters and digits only; underscores and punctuation separate terms like the
# PostgreSQL default parser does for ordinary words, codes and numbers.
_TERM_RE = re.compile(r"[^\W_]+")

TURKISH_STOPWORDS = frozenset(
    {
        "acaba", "ama", "ancak", "artık", "aslında", "bazı", "belki", "ben", "beni", "benim",
        "bir", "biraz", "birçok", "biri", "birkaç", "bize", "biz", "bu", "buna", "bunda",
        "bundan", "bunlar", "bunu", "bunun", "da", "daha", "de", "değil", "diğer", "diye",
        "en", "gibi", "göre", "hangi", "hangisi", "hem", "hep", "hepsi", "her", "hiç",
        "için", "ile", "ise", "işte", "kadar", "ki", "kim", "kimi", "mi", "mı", "mu", "mü",
        "nasıl", "ne", "neden", "nedir", "nerede", "nereye", "niye", "niçin", "o", "olan",
        "olarak", "oldu", "olduğu", "olur", "ona", "onlar", "onu", "onun", "sadece", "sen",
        "siz", "şey", "şu", "şuna", "şunu", "tüm", "ve", "veya", "ya", "yani",
    }
)
ENGLISH_STOPWORDS = frozenset(
    {
        "a", "an", "and", "are", "as", "at", "be", "by", "did", "do", "does", "for", "from",
        "how", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "what",
        "when", "where", "which", "who", "why", "with",
    }
)
STOPWORDS = TURKISH_STOPWORDS | ENGLISH_STOPWORDS

# PostgreSQL ts_rank defaults: unweighted lexemes use weight D (0.1), a lexeme
# keeps at most 256 positions, and per-term sums are scaled by pi^2/6.
_WEIGHT_D = 0.1
_MAX_POSITIONS = 256
_ZETA_2 = 1.64493406685


def normalize_term(value: str) -> str:
    """Lowercase like the database and fold the dot left by Python's ``"İ".lower()``."""

    return value.lower().replace("̇", "")


def _tokens(text: str) -> list[str]:
    return [normalize_term(token) for token in _TERM_RE.findall(text)]


def keyword_terms(query: str) -> list[str]:
    """Return unique content terms for the OR query, in query order.

    Terms keep their original case: ``to_tsquery('simple', ...)`` lowercases
    them with the same database function as the stored ``search_vector``, so
    Turkish "İ" cannot diverge between query and document. Stopword and
    duplicate checks use the normalized form. A query made only of function
    words keeps them, so an explicit user query never becomes an empty search.
    """

    terms: dict[str, str] = {}
    for term in _TERM_RE.findall(query):
        normalized = normalize_term(term)
        if len(normalized) > 1:
            terms.setdefault(normalized, term)
    content = [term for normalized, term in terms.items() if normalized not in STOPWORDS]
    return content or list(terms.values())


def ts_rank_score(terms: Iterable[str], text: str) -> float:
    """PostgreSQL ``ts_rank`` for an OR query over an unweighted ``simple`` vector.

    Known approximation: the PostgreSQL parser reads a hyphen before digits as
    a sign ("TR-4512" -> "tr", "-4512"), while this tokenizer yields "4512".
    """

    unique = list(dict.fromkeys(normalize_term(term) for term in terms))
    if not unique:
        return 0.0
    frequencies = Counter(_tokens(text))
    total = 0.0
    for term in unique:
        count = min(frequencies.get(term, 0), _MAX_POSITIONS)
        total += sum(_WEIGHT_D / ((position + 1) ** 2) for position in range(count)) / _ZETA_2
    return total / len(unique)
