"""OLS4 (Ontology Lookup Service v4) cross-reference provider.

Looks up a CURIE in OLS4's v2 entities endpoint and emits each ``oboInOwl:hasDbXref``
value as a ``CandidateXRef``. OLS4 returns dbxref CURIEs with lowercase prefixes
(e.g. ``drugbank:DB00526``); we uppercase the prefix to match Babel convention.
"""

import functools
import logging

import requests

from babel_explorer.core.providers import CandidateXRef
from babel_explorer.core.curie_utils import to_iri


_DBXREF_KEY = "http://www.geneontology.org/formats/oboInOwl#hasDbXref"
_OLS_PREDICATE = "oboInOwl:hasDbXref"


class OLS4Provider:
    """Client for the OLS4 v2 entities API (https://www.ebi.ac.uk/ols4/)."""

    name = "OLS4"

    def __init__(self, ols_url: str = "", timeout: int = 30):
        """
        :param ols_url: Base URL of the OLS4 server (e.g. ``https://www.ebi.ac.uk/ols4``).
            Pass an empty string to skip all network calls and have every lookup
            return an empty list.
        :param timeout: HTTP request timeout in seconds.
        """
        self.ols_url = ols_url.rstrip("/")
        self.timeout = timeout

    @functools.lru_cache(maxsize=None)
    def fetch(self, curie: str) -> list[CandidateXRef]:
        """Return candidate cross-references from OLS4 for ``curie``.

        Returns an empty list if OLS doesn't recognise the CURIE, the prefix
        isn't in the default prefix map, or ``ols_url`` is empty.

        :raises requests.HTTPError: If OLS returns a non-2xx status.
        """
        if not self.ols_url:
            return []

        try:
            iri = to_iri(curie)
        except (ValueError, KeyError) as e:
            logging.debug(f"OLS4: cannot expand {curie!r} to IRI ({e}); skipping")
            return []

        url = f"{self.ols_url}/api/v2/entities"
        response = requests.get(
            url,
            params={"iri": iri, "size": 50},
            timeout=self.timeout,
        )
        response.raise_for_status()
        data = response.json()

        seen: set[str] = set()
        candidates: list[CandidateXRef] = []
        for element in data.get("elements", []):
            for entry in element.get(_DBXREF_KEY, []) or []:
                raw = entry.get("value") if isinstance(entry, dict) else entry
                if not raw or not isinstance(raw, str) or ":" not in raw:
                    continue
                prefix, _, local_id = raw.partition(":")
                if not prefix or not local_id:
                    continue
                target = _normalize_curie_prefix(raw)
                if target == curie or target in seen:
                    continue
                seen.add(target)
                candidates.append(
                    CandidateXRef(
                        query_curie=curie,
                        target_curie=target,
                        provider=self.name,
                        predicate=_OLS_PREDICATE,
                        confidence=None,
                        evidence=iri,
                        in_babel=False,
                    )
                )

        return candidates


def _normalize_curie_prefix(curie: str) -> str:
    """Uppercase the prefix portion of a CURIE; leave the local ID untouched."""
    prefix, _, local_id = curie.partition(":")
    return f"{prefix.upper()}:{local_id}"
