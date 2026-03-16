"""
Tests for NodeNorm and Identifier classes.

Unit tests use mocks; integration tests call the real NodeNorm API.
"""

import pytest
from unittest.mock import Mock, patch

import requests

from babel_explorer.core.nodenorm import NodeNorm, Identifier

from tests.constants import load_curies

VALID_CURIES = load_curies()


# ==========================================================================
# Unit Tests — Identifier
# ==========================================================================


class TestIdentifier:
    def test_creation_with_defaults(self):
        ident = Identifier(curie="MONDO:0004979")
        assert ident.curie == "MONDO:0004979"
        assert ident.label == ""
        assert ident.biolink_type == ""
        assert ident.taxa == []
        assert ident.description == []

    def test_full_creation(self):
        ident = Identifier(
            curie="MONDO:0004979",
            label="asthma",
            biolink_type="biolink:Disease",
            taxa=["NCBITaxon:9606"],
            description=["A chronic respiratory disease"],
        )
        assert ident.label == "asthma"
        assert ident.biolink_type == "biolink:Disease"
        assert ident.taxa == ["NCBITaxon:9606"]

    def test_from_dict_minimal(self):
        d = {"identifier": "X:1"}
        ident = Identifier.from_dict(d)
        assert ident.curie == "X:1"
        assert ident.label == ""

    def test_from_dict_full(self):
        d = {
            "identifier": "X:1",
            "label": "Alpha",
            "type": ["biolink:NamedThing"],
            "taxa": ["NCBITaxon:9606"],
            "description": ["Some thing"],
        }
        ident = Identifier.from_dict(d)
        assert ident.curie == "X:1"
        assert ident.label == "Alpha"
        assert ident.biolink_type == ["biolink:NamedThing"]
        assert ident.taxa == ["NCBITaxon:9606"]

    def test_from_dict_partial(self):
        d = {"identifier": "X:1", "label": "Beta"}
        ident = Identifier.from_dict(d)
        assert ident.curie == "X:1"
        assert ident.label == "Beta"
        assert ident.biolink_type == ""

    def test_lt_ordering(self):
        a = Identifier(curie="A:1")
        b = Identifier(curie="B:2")
        assert a < b

    def test_sorting(self):
        items = [
            Identifier(curie="C:3"),
            Identifier(curie="A:1"),
            Identifier(curie="B:2"),
        ]
        result = sorted(items)
        assert [x.curie for x in result] == ["A:1", "B:2", "C:3"]


# ==========================================================================
# Unit Tests — NodeNorm (mocked)
# ==========================================================================


class TestNodeNormInit:
    def test_default_url(self):
        nn = NodeNorm()
        assert nn.nodenorm_url == ""

    def test_custom_url(self):
        nn = NodeNorm(nodenorm_url="https://custom.api/")
        assert nn.nodenorm_url == "https://custom.api/"


class TestNormalizeCurieMocked:
    def _make_nn(self):
        nn = NodeNorm(nodenorm_url="https://example.com/")
        nn.normalize_curie.cache_clear()
        return nn

    def test_correct_api_endpoint_and_params(self):
        nn = self._make_nn()
        mock_resp = Mock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"X:1": {"id": {"identifier": "X:1"}}}
        mock_resp.raise_for_status = Mock()

        with patch(
            "babel_explorer.core.nodenorm.requests.get", return_value=mock_resp
        ) as mock_get:
            nn.normalize_curie("X:1")
            mock_get.assert_called_once()
            args, kwargs = mock_get.call_args
            assert args[0] == "https://example.com/get_normalized_nodes"
            assert kwargs["params"]["curie"] == "X:1"

    def test_returns_result_for_curie(self):
        nn = self._make_nn()
        expected = {"id": {"identifier": "X:1"}, "equivalent_identifiers": []}
        mock_resp = Mock()
        mock_resp.json.return_value = {"X:1": expected}
        mock_resp.raise_for_status = Mock()

        with patch("babel_explorer.core.nodenorm.requests.get", return_value=mock_resp):
            result = nn.normalize_curie("X:1")
            assert result == expected

    def test_lru_caching(self):
        nn = self._make_nn()
        mock_resp = Mock()
        mock_resp.json.return_value = {"X:1": {"id": "X:1"}}
        mock_resp.raise_for_status = Mock()

        with patch(
            "babel_explorer.core.nodenorm.requests.get", return_value=mock_resp
        ) as mock_get:
            nn.normalize_curie("X:1")
            nn.normalize_curie("X:1")
            mock_get.assert_called_once()

    def test_http_error_raises(self):
        nn = self._make_nn()
        mock_resp = Mock()
        mock_resp.raise_for_status.side_effect = requests.HTTPError("500 Server Error")

        with patch("babel_explorer.core.nodenorm.requests.get", return_value=mock_resp):
            with pytest.raises(requests.HTTPError):
                nn.normalize_curie("BAD:1")


class TestGetIdentifierMocked:
    def _make_nn(self):
        nn = NodeNorm(nodenorm_url="https://example.com/")
        nn.normalize_curie.cache_clear()
        nn.get_identifier.cache_clear()
        return nn

    def test_exact_match_found(self):
        nn = self._make_nn()
        api_result = {
            "equivalent_identifiers": [
                {"identifier": "X:1", "label": "Alpha", "type": ["biolink:Disease"]},
                {"identifier": "X:2", "label": "Beta"},
            ],
        }
        with patch.object(nn, "normalize_curie", return_value=api_result):
            ident = nn.get_identifier("X:1")
            assert ident.curie == "X:1"
            assert ident.label == "Alpha"

    def test_no_match_returns_bare_identifier(self):
        nn = self._make_nn()
        api_result = {
            "equivalent_identifiers": [
                {"identifier": "X:2", "label": "Beta"},
            ],
        }
        with patch.object(nn, "normalize_curie", return_value=api_result):
            ident = nn.get_identifier("X:1")
            assert ident.curie == "X:1"
            assert ident.label == ""

    def test_falsy_result_returns_bare_identifier(self):
        nn = self._make_nn()
        with patch.object(nn, "normalize_curie", return_value=None):
            ident = nn.get_identifier("X:1")
            assert ident.curie == "X:1"
            assert ident.label == ""

    def test_caching(self):
        nn = self._make_nn()
        api_result = {
            "equivalent_identifiers": [
                {"identifier": "X:1", "label": "Alpha"},
            ],
        }
        with patch.object(nn, "normalize_curie", return_value=api_result) as mock_norm:
            nn.get_identifier("X:1")
            nn.get_identifier("X:1")
            mock_norm.assert_called_once()


class TestGetCliqueIdentifiersMocked:
    def _make_nn(self):
        nn = NodeNorm(nodenorm_url="https://example.com/")
        nn.normalize_curie.cache_clear()
        nn.get_clique_identifiers.cache_clear()
        return nn

    def test_success_returns_list(self):
        nn = self._make_nn()
        api_result = {
            "equivalent_identifiers": [
                {"identifier": "X:1", "label": "Alpha"},
                {"identifier": "X:2", "label": "Beta"},
            ],
        }
        with patch.object(nn, "normalize_curie", return_value=api_result):
            result = nn.get_clique_identifiers("X:1")
            assert len(result) == 2
            assert all(isinstance(x, Identifier) for x in result)

    def test_missing_key_returns_none(self):
        nn = self._make_nn()
        api_result = {"id": {"identifier": "X:1"}}  # no equivalent_identifiers
        with patch.object(nn, "normalize_curie", return_value=api_result):
            result = nn.get_clique_identifiers("X:1")
            assert result is None

    def test_caching(self):
        nn = self._make_nn()
        api_result = {
            "equivalent_identifiers": [{"identifier": "X:1"}],
        }
        with patch.object(nn, "normalize_curie", return_value=api_result) as mock_norm:
            nn.get_clique_identifiers("X:1")
            nn.get_clique_identifiers("X:1")
            mock_norm.assert_called_once()


# ==========================================================================
# Integration Tests — require real NodeNorm API
# ==========================================================================


@pytest.mark.integration
@pytest.mark.parametrize("curie", VALID_CURIES)
def test_normalize_curie_real_api(nodenorm, curie):
    """normalize_curie returns a dict with expected keys."""
    nodenorm.normalize_curie.cache_clear()
    result = nodenorm.normalize_curie(curie)
    assert isinstance(result, dict)
    assert "id" in result
    assert "equivalent_identifiers" in result
    assert "type" in result


@pytest.mark.integration
@pytest.mark.parametrize("curie", VALID_CURIES)
def test_get_identifier_real_api(nodenorm, curie):
    """get_identifier returns an Identifier with non-empty label and biolink_type."""
    nodenorm.normalize_curie.cache_clear()
    nodenorm.get_identifier.cache_clear()
    ident = nodenorm.get_identifier(curie)
    assert isinstance(ident, Identifier)
    assert ident.curie == curie
    assert ident.label != ""


@pytest.mark.integration
@pytest.mark.parametrize("curie", VALID_CURIES)
def test_get_clique_identifiers_real_api(nodenorm, curie):
    """get_clique_identifiers returns a non-empty list of Identifiers."""
    nodenorm.normalize_curie.cache_clear()
    nodenorm.get_clique_identifiers.cache_clear()
    result = nodenorm.get_clique_identifiers(curie)
    assert result is not None
    assert len(result) > 0
    assert all(isinstance(x, Identifier) for x in result)


@pytest.mark.integration
@pytest.mark.parametrize("curie", VALID_CURIES)
def test_get_clique_identifiers_has_known_ids(nodenorm, curie):
    """At least one equivalent identifier is returned."""
    nodenorm.normalize_curie.cache_clear()
    nodenorm.get_clique_identifiers.cache_clear()
    result = nodenorm.get_clique_identifiers(curie)
    assert len(result) >= 1


@pytest.mark.integration
def test_normalize_curie_nonexistent(nodenorm):
    """A made-up CURIE returns None."""
    nodenorm.normalize_curie.cache_clear()
    result = nodenorm.normalize_curie("FAKENS:9999999999")
    assert result is None
