"""Tests for the MyChem.info cross-reference provider.

Unit tests use mocks; integration tests call the real MyChem.info API.
"""

from unittest.mock import Mock, patch, MagicMock

import pytest
import requests

from babel_explorer.core.providers.mychem import (
    MyChemProvider,
    _iter_section_entries,
)


# Captured-style response from /chem/CHEBI:31941 with the canonical-ID fields.
SAMPLE_CHEBI_RESPONSE = {
    "_id": "ZROHGHOFXNOHSO-BNTLRKBRSA-L",
    "_version": 1,
    "chebi": {"id": "CHEBI:31941"},
    "drugbank": {"id": "DB00526"},
    "pubchem": {"cid": 9887054},
    "unii": {"unii": "04ZR38536J"},
}

# /chem/43805 returns pubchem-only (a list of two CIDs).
SAMPLE_PUBCHEM_RESPONSE = {
    "_id": "DWAFYCQODLXJNR-BNTLRKBRSA-L",
    "_version": 1,
    "pubchem": [{"cid": 43805}, {"cid": 11947679}],
}


def _http(status_code, json_body):
    """Build a mock requests.Response with the given status and JSON body."""
    r = Mock()
    r.status_code = status_code
    r.json.return_value = json_body
    if status_code >= 400 and status_code != 404:
        r.raise_for_status.side_effect = requests.HTTPError(f"{status_code}")
    else:
        r.raise_for_status = Mock()
    return r


class TestInit:
    def test_default_url_empty(self):
        assert MyChemProvider().mychem_url == ""

    def test_strips_trailing_slash(self):
        assert MyChemProvider("https://x.org/").mychem_url == "https://x.org"

    def test_empty_url_returns_empty_without_network(self):
        p = MyChemProvider("")
        p.fetch.cache_clear()
        with patch("babel_explorer.core.providers.mychem.requests.get") as mock_get:
            assert p.fetch("CHEBI:31941") == []
            mock_get.assert_not_called()

    def test_non_curie_input_returns_empty(self):
        p = MyChemProvider("https://mychem.info/v1")
        p.fetch.cache_clear()
        with patch("babel_explorer.core.providers.mychem.requests.get") as mock_get:
            assert p.fetch("not-a-curie") == []
            mock_get.assert_not_called()


class TestFetchMocked:
    def _make(self, nodenorm=None):
        p = MyChemProvider("https://mychem.info/v1", nodenorm=nodenorm)
        p.fetch.cache_clear()
        return p

    def test_chebi_lookup_yields_curie_form_id(self):
        """CHEBI input is passed as the full CURIE to MyChem (not just the local ID)."""
        p = self._make()
        with patch(
            "babel_explorer.core.providers.mychem.requests.get",
            return_value=_http(200, SAMPLE_CHEBI_RESPONSE),
        ) as mock_get:
            p.fetch("CHEBI:31941")
            args, kwargs = mock_get.call_args
            assert args[0] == "https://mychem.info/v1/chem/CHEBI:31941"
            assert "fields" in kwargs["params"]

    def test_pubchem_lookup_uses_bare_local_id(self):
        p = self._make()
        with patch(
            "babel_explorer.core.providers.mychem.requests.get",
            return_value=_http(200, SAMPLE_PUBCHEM_RESPONSE),
        ) as mock_get:
            p.fetch("PUBCHEM.COMPOUND:43805")
            args, _ = mock_get.call_args
            assert args[0] == "https://mychem.info/v1/chem/43805"

    def test_extracts_all_canonical_ids(self):
        p = self._make()
        with patch(
            "babel_explorer.core.providers.mychem.requests.get",
            return_value=_http(200, SAMPLE_CHEBI_RESPONSE),
        ):
            candidates = p.fetch("CHEBI:31941")

        targets = {c.target_curie for c in candidates}
        # query CURIE itself is filtered out, but the rest should be present
        assert "INCHIKEY:ZROHGHOFXNOHSO-BNTLRKBRSA-L" in targets
        assert "DRUGBANK:DB00526" in targets
        assert "PUBCHEM.COMPOUND:9887054" in targets
        assert "UNII:04ZR38536J" in targets
        assert "CHEBI:31941" not in targets  # self-loop filtered

        for c in candidates:
            assert c.provider == "MyChem.info"
            assert c.predicate == "skos:exactMatch"
            assert c.confidence == 0.9
            assert c.in_babel is False
            assert c.query_curie == "CHEBI:31941"

    def test_pubchem_list_returns_multiple_cids(self):
        """When MyChem returns a list of pubchem entries, all CIDs are emitted."""
        p = self._make()
        with patch(
            "babel_explorer.core.providers.mychem.requests.get",
            return_value=_http(200, SAMPLE_PUBCHEM_RESPONSE),
        ):
            candidates = p.fetch("PUBCHEM.COMPOUND:43805")

        targets = {c.target_curie for c in candidates}
        # The queried CID is filtered; the second CID and the InChIKey remain.
        assert "PUBCHEM.COMPOUND:11947679" in targets
        assert "INCHIKEY:DWAFYCQODLXJNR-BNTLRKBRSA-L" in targets
        assert "PUBCHEM.COMPOUND:43805" not in targets

    def test_404_returns_empty(self):
        p = self._make()
        with patch(
            "babel_explorer.core.providers.mychem.requests.get",
            return_value=_http(404, {"success": False, "error": "not found"}),
        ):
            assert p.fetch("CHEBI:99999999") == []

    def test_success_false_payload_returns_empty(self):
        p = self._make()
        with patch(
            "babel_explorer.core.providers.mychem.requests.get",
            return_value=_http(200, {"success": False}),
        ):
            assert p.fetch("CHEBI:31941") == []

    def test_500_raises(self):
        p = self._make()
        with patch(
            "babel_explorer.core.providers.mychem.requests.get",
            return_value=_http(500, {}),
        ):
            with pytest.raises(requests.HTTPError):
                p.fetch("CHEBI:31941")

    def test_lru_caching(self):
        p = self._make()
        with patch(
            "babel_explorer.core.providers.mychem.requests.get",
            return_value=_http(200, SAMPLE_CHEBI_RESPONSE),
        ) as mock_get:
            p.fetch("CHEBI:31941")
            p.fetch("CHEBI:31941")
            mock_get.assert_called_once()

    def test_unknown_prefix_without_nodenorm_returns_empty(self):
        """UMLS isn't in the direct-lookup set; with no NodeNorm, we give up."""
        p = self._make(nodenorm=None)
        with patch("babel_explorer.core.providers.mychem.requests.get") as mock_get:
            assert p.fetch("UMLS:C1314429") == []
            mock_get.assert_not_called()


class TestNodeNormFallback:
    def test_uses_inchikey_from_nodenorm_clique(self):
        """UMLS input falls back to NodeNorm to find an InChIKey, then MyChem-looks-up that."""
        # Build a NodeNorm mock whose clique includes an INCHIKEY entry.
        nn = MagicMock()
        inchikey_ident = MagicMock()
        inchikey_ident.curie = "INCHIKEY:ZROHGHOFXNOHSO-BNTLRKBRSA-L"
        nn.get_clique_identifiers.return_value = [inchikey_ident]

        p = MyChemProvider("https://mychem.info/v1", nodenorm=nn)
        p.fetch.cache_clear()
        with patch(
            "babel_explorer.core.providers.mychem.requests.get",
            return_value=_http(200, SAMPLE_CHEBI_RESPONSE),
        ) as mock_get:
            candidates = p.fetch("UMLS:C1314429")

        args, _ = mock_get.call_args
        assert args[0] == "https://mychem.info/v1/chem/ZROHGHOFXNOHSO-BNTLRKBRSA-L"
        assert len(candidates) > 0
        for c in candidates:
            assert c.query_curie == "UMLS:C1314429"

    def test_no_inchikey_in_clique_returns_empty(self):
        nn = MagicMock()
        nn.get_clique_identifiers.return_value = []  # no InChIKey available
        p = MyChemProvider("https://mychem.info/v1", nodenorm=nn)
        p.fetch.cache_clear()
        with patch("babel_explorer.core.providers.mychem.requests.get") as mock_get:
            assert p.fetch("UMLS:C1314429") == []
            mock_get.assert_not_called()

    def test_direct_lookup_404_falls_back_to_nodenorm(self):
        """If direct CHEBI lookup 404s, try the InChIKey from NodeNorm."""
        nn = MagicMock()
        inchikey_ident = MagicMock()
        inchikey_ident.curie = "INCHIKEY:Z-FAKE"
        nn.get_clique_identifiers.return_value = [inchikey_ident]

        p = MyChemProvider("https://mychem.info/v1", nodenorm=nn)
        p.fetch.cache_clear()

        responses = [
            _http(404, {"success": False}),
            _http(200, {"_id": "Z-FAKE", "drugbank": {"id": "DB1"}}),
        ]
        with patch(
            "babel_explorer.core.providers.mychem.requests.get",
            side_effect=responses,
        ) as mock_get:
            candidates = p.fetch("CHEBI:99999999")

        assert mock_get.call_count == 2
        targets = {c.target_curie for c in candidates}
        assert "DRUGBANK:DB1" in targets


class TestIterSectionEntries:
    def test_none(self):
        assert list(_iter_section_entries(None)) == []

    def test_dict(self):
        assert list(_iter_section_entries({"id": "x"})) == [{"id": "x"}]

    def test_list_of_dicts(self):
        result = list(_iter_section_entries([{"a": 1}, {"a": 2}]))
        assert result == [{"a": 1}, {"a": 2}]

    def test_list_with_non_dicts_filtered(self):
        result = list(_iter_section_entries([{"a": 1}, "garbage", None, {"a": 2}]))
        assert result == [{"a": 1}, {"a": 2}]

    def test_unexpected_type(self):
        assert list(_iter_section_entries("string-not-a-section")) == []


# ==========================================================================
# Integration Tests — require real MyChem.info API
# ==========================================================================


@pytest.mark.integration
def test_real_mychem_returns_candidates_for_chebi():
    """Real MyChem call for CHEBI:31941 (oxaliplatin) returns ≥1 candidate."""
    p = MyChemProvider("https://mychem.info/v1")
    p.fetch.cache_clear()
    candidates = p.fetch("CHEBI:31941")
    assert len(candidates) > 0
    assert all(c.provider == "MyChem.info" for c in candidates)
    targets = {c.target_curie for c in candidates}
    # DrugBank ID for oxaliplatin is a stable equivalence
    assert "DRUGBANK:DB00526" in targets


@pytest.mark.integration
def test_real_mychem_returns_candidates_for_pubchem():
    """Real MyChem call for PUBCHEM.COMPOUND:43805 returns at least an InChIKey."""
    p = MyChemProvider("https://mychem.info/v1")
    p.fetch.cache_clear()
    candidates = p.fetch("PUBCHEM.COMPOUND:43805")
    assert len(candidates) > 0
    targets = {c.target_curie for c in candidates}
    assert any(t.startswith("INCHIKEY:") for t in targets)


@pytest.mark.integration
def test_real_mychem_unknown_curie_returns_empty():
    """A made-up CHEBI ID returns an empty list, not an error."""
    p = MyChemProvider("https://mychem.info/v1")
    p.fetch.cache_clear()
    assert p.fetch("CHEBI:9999999999") == []
