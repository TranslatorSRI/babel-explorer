"""Tests for the OLS4 cross-reference provider.

Unit tests use mocks; integration tests call the real OLS4 API.
"""

from unittest.mock import Mock, patch

import pytest
import requests

from babel_explorer.core.providers import CandidateXRef
from babel_explorer.core.providers.ols import OLS4Provider, _normalize_curie_prefix


# Captured-style fixture mirroring OLS4 v2's /api/v2/entities?iri=... response.
SAMPLE_RESPONSE = {
    "elements": [
        {
            "iri": "http://purl.obolibrary.org/obo/CHEBI_31941",
            "curie": "CHEBI:31941",
            "http://www.geneontology.org/formats/oboInOwl#hasDbXref": [
                {
                    "type": ["reification"],
                    "value": "drugbank:DB00526",
                    "axioms": [{"source": "drugbank"}],
                },
                {
                    "type": ["reification"],
                    "value": "kegg.drug:D01790",
                    "axioms": [{"source": "kegg.drug"}],
                },
                {
                    "type": ["reification"],
                    "value": "pubmed:11300320",
                    "axioms": [{"source": "pubmed"}],
                },
                # Duplicate of the first xref — should be deduped.
                {
                    "type": ["reification"],
                    "value": "drugbank:DB00526",
                    "axioms": [{"source": "drugbank"}],
                },
            ],
        }
    ]
}


class TestInit:
    def test_default_url_empty(self):
        assert OLS4Provider().ols_url == ""

    def test_strips_trailing_slash(self):
        assert OLS4Provider("https://x.org/").ols_url == "https://x.org"

    def test_empty_url_returns_empty_without_network(self):
        p = OLS4Provider("")
        p.fetch.cache_clear()
        with patch("babel_explorer.core.providers.ols.requests.get") as mock_get:
            assert p.fetch("CHEBI:31941") == []
            mock_get.assert_not_called()


class TestFetchMocked:
    def _make(self):
        p = OLS4Provider("https://www.ebi.ac.uk/ols4")
        p.fetch.cache_clear()
        return p

    def test_hits_correct_endpoint_with_iri_param(self):
        p = self._make()
        mock_resp = Mock()
        mock_resp.json.return_value = {"elements": []}
        mock_resp.raise_for_status = Mock()
        with patch(
            "babel_explorer.core.providers.ols.requests.get", return_value=mock_resp
        ) as mock_get:
            p.fetch("CHEBI:31941")
            mock_get.assert_called_once()
            args, kwargs = mock_get.call_args
            assert args[0] == "https://www.ebi.ac.uk/ols4/api/v2/entities"
            assert (
                kwargs["params"]["iri"] == "http://purl.obolibrary.org/obo/CHEBI_31941"
            )

    def test_parses_dbxrefs_into_candidates(self):
        p = self._make()
        mock_resp = Mock()
        mock_resp.json.return_value = SAMPLE_RESPONSE
        mock_resp.raise_for_status = Mock()
        with patch(
            "babel_explorer.core.providers.ols.requests.get", return_value=mock_resp
        ):
            candidates = p.fetch("CHEBI:31941")

        assert len(candidates) == 3  # 4 entries, one duplicate
        targets = [c.target_curie for c in candidates]
        assert "DRUGBANK:DB00526" in targets
        assert "KEGG.DRUG:D01790" in targets
        assert "PUBMED:11300320" in targets
        for c in candidates:
            assert isinstance(c, CandidateXRef)
            assert c.provider == "OLS4"
            assert c.predicate == "oboInOwl:hasDbXref"
            assert c.confidence is None
            assert c.in_babel is False
            assert c.query_curie == "CHEBI:31941"
            assert c.evidence == "http://purl.obolibrary.org/obo/CHEBI_31941"

    def test_skips_self_xref(self):
        """An xref that points back to the query CURIE is filtered."""
        p = self._make()
        mock_resp = Mock()
        mock_resp.json.return_value = {
            "elements": [
                {
                    "http://www.geneontology.org/formats/oboInOwl#hasDbXref": [
                        {"value": "chebi:31941"},  # self-loop after normalisation
                        {"value": "drugbank:DB00526"},
                    ]
                }
            ]
        }
        mock_resp.raise_for_status = Mock()
        with patch(
            "babel_explorer.core.providers.ols.requests.get", return_value=mock_resp
        ):
            candidates = p.fetch("CHEBI:31941")
        assert [c.target_curie for c in candidates] == ["DRUGBANK:DB00526"]

    def test_unknown_prefix_returns_empty(self):
        p = self._make()
        with patch("babel_explorer.core.providers.ols.requests.get") as mock_get:
            assert p.fetch("WIBBLE:1") == []
            mock_get.assert_not_called()  # short-circuits before HTTP

    def test_invalid_curie_returns_empty(self):
        p = self._make()
        with patch("babel_explorer.core.providers.ols.requests.get") as mock_get:
            assert p.fetch("not-a-curie") == []
            mock_get.assert_not_called()

    def test_empty_elements_returns_empty(self):
        p = self._make()
        mock_resp = Mock()
        mock_resp.json.return_value = {"elements": []}
        mock_resp.raise_for_status = Mock()
        with patch(
            "babel_explorer.core.providers.ols.requests.get", return_value=mock_resp
        ):
            assert p.fetch("CHEBI:31941") == []

    def test_element_without_dbxref_key(self):
        p = self._make()
        mock_resp = Mock()
        mock_resp.json.return_value = {"elements": [{"iri": "x"}]}
        mock_resp.raise_for_status = Mock()
        with patch(
            "babel_explorer.core.providers.ols.requests.get", return_value=mock_resp
        ):
            assert p.fetch("CHEBI:31941") == []

    def test_malformed_xref_entry_skipped(self):
        p = self._make()
        mock_resp = Mock()
        mock_resp.json.return_value = {
            "elements": [
                {
                    "http://www.geneontology.org/formats/oboInOwl#hasDbXref": [
                        None,
                        {},
                        {"value": ""},
                        {"value": "no_colon"},
                        {"value": ":"},  # both halves empty
                        {"value": ":foo"},  # empty prefix
                        {"value": "foo:"},  # empty local id
                        {"value": "good:1"},
                    ]
                }
            ]
        }
        mock_resp.raise_for_status = Mock()
        with patch(
            "babel_explorer.core.providers.ols.requests.get", return_value=mock_resp
        ):
            candidates = p.fetch("CHEBI:31941")
        assert [c.target_curie for c in candidates] == ["GOOD:1"]

    def test_http_error_raises(self):
        p = self._make()
        mock_resp = Mock()
        mock_resp.raise_for_status.side_effect = requests.HTTPError("500")
        with patch(
            "babel_explorer.core.providers.ols.requests.get", return_value=mock_resp
        ):
            with pytest.raises(requests.HTTPError):
                p.fetch("CHEBI:31941")

    def test_lru_caching(self):
        p = self._make()
        mock_resp = Mock()
        mock_resp.json.return_value = {"elements": []}
        mock_resp.raise_for_status = Mock()
        with patch(
            "babel_explorer.core.providers.ols.requests.get", return_value=mock_resp
        ) as mock_get:
            p.fetch("CHEBI:31941")
            p.fetch("CHEBI:31941")
            mock_get.assert_called_once()


class TestNormalizeCuriePrefix:
    def test_uppercases_prefix(self):
        assert _normalize_curie_prefix("drugbank:DB00526") == "DRUGBANK:DB00526"

    def test_preserves_local_id_case(self):
        assert _normalize_curie_prefix("inchikey:abcDEF") == "INCHIKEY:abcDEF"

    def test_dot_separated_prefix(self):
        assert (
            _normalize_curie_prefix("pubchem.compound:43805")
            == "PUBCHEM.COMPOUND:43805"
        )

    def test_only_uppercases_first_colon_split(self):
        assert _normalize_curie_prefix("a:b:c") == "A:b:c"


# ==========================================================================
# Integration Tests — require real OLS4 API
# ==========================================================================


@pytest.mark.integration
def test_real_ols4_returns_candidates_for_chebi():
    """Real OLS4 call for CHEBI:31941 (oxaliplatin) returns ≥1 candidate."""
    p = OLS4Provider("https://www.ebi.ac.uk/ols4")
    p.fetch.cache_clear()
    candidates = p.fetch("CHEBI:31941")
    assert len(candidates) > 0
    assert all(c.provider == "OLS4" for c in candidates)
    assert all(c.query_curie == "CHEBI:31941" for c in candidates)
    # DrugBank xref is a known stable mapping for oxaliplatin
    assert any(c.target_curie == "DRUGBANK:DB00526" for c in candidates)


@pytest.mark.integration
def test_real_ols4_unknown_curie_returns_empty():
    """A made-up CHEBI ID returns an empty list, not an error."""
    p = OLS4Provider("https://www.ebi.ac.uk/ols4")
    p.fetch.cache_clear()
    candidates = p.fetch("CHEBI:99999999")
    assert candidates == []
