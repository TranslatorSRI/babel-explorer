"""Pluggable cross-reference providers for `babel-explorer search-xrefs`.

Each provider queries an external mapping source (OLS4, MyChem.info, ...) for
candidate cross-references and returns a list of ``CandidateXRef`` records that
the CLI then diffs against Babel's local ``Concord.parquet``.

Adding a new provider:
    1. Create a class in this package whose interface matches ``XRefProvider``
       (a ``name`` attribute and a ``fetch(curie) -> list[CandidateXRef]`` method).
    2. Register a factory in ``PROVIDERS`` below.
"""

import dataclasses
from typing import Callable, Protocol, runtime_checkable


@dataclasses.dataclass(frozen=True)
class CandidateXRef:
    """A candidate cross-reference proposed by an external mapping source."""

    query_curie: str
    target_curie: str
    provider: str
    predicate: str
    confidence: float | None
    evidence: str
    in_babel: bool
    target_label: str = ""
    target_biolink_type: tuple[str, ...] = ()

    def __lt__(self, other):
        return (self.query_curie, self.provider, self.target_curie) < (
            other.query_curie,
            other.provider,
            other.target_curie,
        )


@runtime_checkable
class XRefProvider(Protocol):
    """Interface that every cross-reference provider implements."""

    name: str

    def fetch(self, curie: str) -> list[CandidateXRef]: ...


# Provider registry — populated after provider classes are imported.
PROVIDERS: dict[str, Callable[..., XRefProvider]] = {}


# Imports placed after type definitions so provider modules can safely
# `from babel_explorer.core.providers import CandidateXRef`.
from babel_explorer.core.providers.ols import OLS4Provider  # noqa: E402


def _build_ols(**kw) -> "OLS4Provider":
    return OLS4Provider(kw.get("ols_url", ""), timeout=kw.get("timeout", 30))


PROVIDERS["ols"] = _build_ols


from babel_explorer.core.providers.mychem import MyChemProvider  # noqa: E402


def _build_mychem(**kw) -> "MyChemProvider":
    return MyChemProvider(
        kw.get("mychem_url", ""),
        nodenorm=kw.get("nodenorm"),
        timeout=kw.get("timeout", 30),
    )


PROVIDERS["mychem"] = _build_mychem
