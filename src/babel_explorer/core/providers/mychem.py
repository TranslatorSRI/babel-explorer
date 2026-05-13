"""MyChem.info cross-reference provider.

Hits ``/chem/{id}`` on MyChem.info and emits the canonical per-source IDs
(CHEBI, DrugBank, PubChem CID, UNII, ChEMBL, InChIKey) as ``CandidateXRef``s.
MyChem is forgiving about input IDs (CHEBI CURIEs, PubChem CIDs, ChEMBL IDs,
DrugBank IDs, UNIIs, InChIKeys all work), so for most inputs we pass the local
ID through directly. For inputs MyChem doesn't recognise, we fall back to
looking up an InChIKey in the NodeNorm clique.
"""

import functools
import logging

import requests

from babel_explorer.core.providers import CandidateXRef
from babel_explorer.core.nodenorm import NodeNorm


_MYCHEM_PREDICATE = "skos:exactMatch"
_MYCHEM_CONFIDENCE = 0.9

# Fields to request from MyChem.info — one canonical ID per source section.
_FIELDS = "chebi.id,pubchem.cid,unii.unii,drugbank.id,chembl.molecule_chembl_id"

# Source section → (value-field, Babel CURIE prefix, value-already-a-curie?)
# Used to translate each per-source ID in the MyChem response to a CandidateXRef.
_SOURCE_TO_BABEL = [
    ("chebi", "id", "CHEBI", True),
    ("drugbank", "id", "DRUGBANK", False),
    ("pubchem", "cid", "PUBCHEM.COMPOUND", False),
    ("unii", "unii", "UNII", False),
    ("chembl", "molecule_chembl_id", "CHEMBL.COMPOUND", False),
]

# CURIE prefixes that MyChem.info accepts as direct lookup IDs (we pass through
# the local-ID portion). Anything else routes via NodeNorm InChIKey resolution.
_DIRECT_LOOKUP_PREFIXES = {
    "CHEBI",
    "DRUGBANK",
    "PUBCHEM.COMPOUND",
    "UNII",
    "CHEMBL.COMPOUND",
    "INCHIKEY",
}


class MyChemProvider:
    """Client for the MyChem.info v1 chemical-annotation API."""

    name = "MyChem.info"

    def __init__(
        self,
        mychem_url: str = "",
        nodenorm: NodeNorm | None = None,
        timeout: int = 30,
    ):
        """
        :param mychem_url: Base URL of MyChem.info (e.g. ``https://mychem.info/v1``).
            Pass an empty string to skip all network calls.
        :param nodenorm: Optional ``NodeNorm`` client used to resolve inputs that
            MyChem can't look up directly (e.g. UMLS CUIs → InChIKey via the clique).
        :param timeout: HTTP request timeout in seconds.
        """
        self.mychem_url = mychem_url.rstrip("/")
        self.nodenorm = nodenorm
        self.timeout = timeout

    @functools.lru_cache(maxsize=None)
    def fetch(self, curie: str) -> list[CandidateXRef]:
        """Return candidate cross-references from MyChem.info for ``curie``.

        Returns an empty list if MyChem doesn't recognise the CURIE (even after
        NodeNorm InChIKey fallback), or if ``mychem_url`` is empty.

        :raises requests.HTTPError: If MyChem returns a non-2xx status that
            isn't 404 (404 is treated as "unknown ID", not an error).
        """
        if not self.mychem_url:
            return []
        if ":" not in curie:
            return []

        for lookup_id in self._lookup_ids_for(curie):
            data = self._fetch_chem(lookup_id)
            if data is None:
                continue
            candidates = self._extract_candidates(curie, data)
            if candidates:
                return candidates
        return []

    def _lookup_ids_for(self, curie: str):
        """Yield MyChem-compatible lookup IDs to try for ``curie``, in order."""
        prefix, _, local_id = curie.partition(":")
        if prefix.upper() in _DIRECT_LOOKUP_PREFIXES:
            yield local_id if prefix.upper() != "CHEBI" else curie
        # Fallback: ask NodeNorm for an InChIKey in the clique.
        if self.nodenorm is not None:
            for ident in self.nodenorm.get_clique_identifiers(curie):
                if ident.curie.startswith("INCHIKEY:"):
                    yield ident.curie.split(":", 1)[1]
                    return  # only one InChIKey is needed

    def _fetch_chem(self, lookup_id: str) -> dict | None:
        """GET /chem/{id}; return JSON dict, or None on 404."""
        try:
            response = requests.get(
                f"{self.mychem_url}/chem/{lookup_id}",
                params={"fields": _FIELDS},
                timeout=self.timeout,
            )
        except requests.RequestException:
            raise
        if response.status_code == 404:
            return None
        response.raise_for_status()
        data = response.json()
        if isinstance(data, dict) and data.get("success") is False:
            return None
        return data

    def _extract_candidates(self, curie: str, data: dict) -> list[CandidateXRef]:
        """Walk a MyChem response and emit a candidate per known equivalent ID."""
        evidence_id = data.get("_id", "")
        evidence = (
            f"{self.mychem_url}/chem/{evidence_id}" if evidence_id else self.mychem_url
        )

        seen: set[str] = set()
        candidates: list[CandidateXRef] = []

        # InChIKey from the _id field — high-confidence structural equivalence.
        if evidence_id:
            target = f"INCHIKEY:{evidence_id}"
            if target != curie:
                seen.add(target)
                candidates.append(self._make_candidate(curie, target, evidence))

        for section, field, prefix, is_curie in _SOURCE_TO_BABEL:
            for entry in _iter_section_entries(data.get(section)):
                value = entry.get(field) if isinstance(entry, dict) else None
                if value is None or value == "":
                    continue
                target = str(value) if is_curie else f"{prefix}:{value}"
                if target == curie or target in seen:
                    continue
                seen.add(target)
                candidates.append(self._make_candidate(curie, target, evidence))

        return candidates

    def _make_candidate(self, query: str, target: str, evidence: str) -> CandidateXRef:
        return CandidateXRef(
            query_curie=query,
            target_curie=target,
            provider=self.name,
            predicate=_MYCHEM_PREDICATE,
            confidence=_MYCHEM_CONFIDENCE,
            evidence=evidence,
            in_babel=False,
        )


def _iter_section_entries(section):
    """Normalise a MyChem source-section value into an iterable of dict entries.

    MyChem may return a section as a dict (single record) or a list of dicts
    (multiple records for the same InChIKey, e.g. multiple PubChem CIDs).
    """
    if section is None:
        return
    if isinstance(section, list):
        for entry in section:
            if isinstance(entry, dict):
                yield entry
    elif isinstance(section, dict):
        yield section
    else:
        logging.debug(f"MyChem: unexpected section type {type(section).__name__}")
