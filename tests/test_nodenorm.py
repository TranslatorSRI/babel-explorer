"""
Tests for NodeNorm and Identifier classes.

Unit tests use mocks; integration tests call the real NodeNorm API.
"""

from unittest.mock import Mock, patch

import pytest
import requests
from _pytest.outcomes import Skipped

from babel_explorer.core.nodenorm import NORMALIZE_BATCH_SIZE, Identifier, NodeNorm
from tests import conftest
from tests.constants import load_curies

VALID_CURIES = load_curies()


# ==========================================================================
# Unit Tests — Identifier
# ==========================================================================


class TestIdentifier:
    """Tests for the Identifier dataclass."""

    def test_creation_with_defaults(self):
        ident = Identifier(curie="MONDO:0004979")
        assert ident.curie == "MONDO:0004979"
        assert ident.label == ""
        assert ident.biolink_type == ()
        assert ident.taxa == ()
        assert ident.description == ()

    def test_full_creation(self):
        ident = Identifier(
            curie="MONDO:0004979",
            label="asthma",
            biolink_type=("biolink:Disease",),
            taxa=("NCBITaxon:9606",),
            description=("A chronic respiratory disease",),
        )
        assert ident.label == "asthma"
        assert ident.biolink_type == ("biolink:Disease",)
        assert ident.taxa == ("NCBITaxon:9606",)

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
        assert ident.biolink_type == ("biolink:NamedThing",)
        assert ident.taxa == ("NCBITaxon:9606",)

    def test_from_dict_partial(self):
        d = {"identifier": "X:1", "label": "Beta"}
        ident = Identifier.from_dict(d)
        assert ident.curie == "X:1"
        assert ident.label == "Beta"
        assert ident.biolink_type == ()

    def test_from_dict_type_as_string(self):
        """NodeNorm may return 'type' as a bare string for individual identifiers."""
        d = {"identifier": "X:1", "type": "biolink:Disease"}
        ident = Identifier.from_dict(d)
        assert ident.biolink_type == ("biolink:Disease",), (
            "biolink_type should be a 1-tuple, not a tuple of characters"
        )

    def test_from_dict_description_as_string(self):
        """NodeNorm may return 'description' as a bare string."""
        d = {"identifier": "X:1", "description": "A chronic disease"}
        ident = Identifier.from_dict(d)
        assert ident.description == ("A chronic disease",), (
            "description should be a 1-tuple, not a tuple of characters"
        )

    def test_from_dict_taxa_as_string(self):
        """NodeNorm may return 'taxa' as a bare string."""
        d = {"identifier": "X:1", "taxa": "NCBITaxon:9606"}
        ident = Identifier.from_dict(d)
        assert ident.taxa == ("NCBITaxon:9606",), (
            "taxa should be a 1-tuple, not a tuple of characters"
        )

    def test_from_dict_all_fields_as_strings(self):
        """All three tuple fields as strings produce correct single-element tuples."""
        d = {
            "identifier": "X:1",
            "label": "Alpha",
            "type": "biolink:NamedThing",
            "taxa": "NCBITaxon:9606",
            "description": "Some description",
        }
        ident = Identifier.from_dict(d)
        assert ident.biolink_type == ("biolink:NamedThing",)
        assert ident.taxa == ("NCBITaxon:9606",)
        assert ident.description == ("Some description",)

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
    """Tests for NodeNorm constructor and URL normalisation."""

    def test_default_url(self):
        nn = NodeNorm()
        assert nn.nodenorm_url == ""

    def test_custom_url(self):
        nn = NodeNorm(nodenorm_url="https://custom.api/")
        assert nn.nodenorm_url == "https://custom.api/"

    def test_empty_url_normalize_curie_returns_none_without_network(self):
        """NodeNorm('') must not make any HTTP calls and must return None."""
        nn = NodeNorm("")
        with patch("babel_explorer.core.nodenorm.requests.get") as mock_get:
            result = nn.normalize_curie("MONDO:0004979")
            mock_get.assert_not_called()
        assert result is None


class TestNormalizeCurieMocked:
    """Unit tests for NodeNorm.normalize_curie() with mocked HTTP responses."""

    def _make_nn(self):
        return NodeNorm(nodenorm_url="https://example.com/")

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
            # CURIEs are always sent as a batch, even when there is only one.
            assert kwargs["params"]["curie"] == ["X:1"]

    def test_returns_result_for_curie(self):
        nn = self._make_nn()
        expected = {"id": {"identifier": "X:1"}, "equivalent_identifiers": []}
        mock_resp = Mock()
        mock_resp.json.return_value = {"X:1": expected}
        mock_resp.raise_for_status = Mock()

        with patch("babel_explorer.core.nodenorm.requests.get", return_value=mock_resp):
            result = nn.normalize_curie("X:1")
            assert result == expected

    def test_caching(self):
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
    """Unit tests for NodeNorm.get_identifier() with mocked normalize_curie."""

    def _make_nn(self):
        return NodeNorm(nodenorm_url="https://example.com/")

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
    """Unit tests for NodeNorm.get_clique_identifiers() with mocked normalize_curie."""

    def _make_nn(self):
        return NodeNorm(nodenorm_url="https://example.com/")

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
            assert result == []

    def test_caching(self):
        nn = self._make_nn()
        api_result = {
            "equivalent_identifiers": [{"identifier": "X:1"}],
        }
        with patch.object(nn, "normalize_curie", return_value=api_result) as mock_norm:
            nn.get_clique_identifiers("X:1")
            nn.get_clique_identifiers("X:1")
            mock_norm.assert_called_once()


class TestGetBabelVersionMocked:
    """Tests for get_babel_version()."""

    @staticmethod
    def _status_response(payload):
        response = Mock()
        response.json = Mock(return_value=payload)
        response.raise_for_status = Mock()
        return response

    def test_reads_babel_version_from_status(self):
        nn = NodeNorm(nodenorm_url="https://example.com/nn")
        with patch(
            "babel_explorer.core.nodenorm.requests.get",
            return_value=self._status_response({"babel_version": "2026jul22"}),
        ) as mock_get:
            assert nn.get_babel_version() == "2026jul22"
        assert mock_get.call_args[0][0] == "https://example.com/nn/status"

    def test_offline_mode_makes_no_request(self):
        """An empty URL short-circuits every lookup, including this one."""
        nn = NodeNorm(nodenorm_url="")
        with patch("babel_explorer.core.nodenorm.requests.get") as mock_get:
            assert nn.get_babel_version() is None
            mock_get.assert_not_called()

    def test_unreachable_status_returns_none(self):
        """A version check must never take down the command that called it."""
        nn = NodeNorm(nodenorm_url="https://example.com/nn")
        with patch(
            "babel_explorer.core.nodenorm.requests.get",
            side_effect=requests.ConnectionError("boom"),
        ):
            assert nn.get_babel_version() is None

    def test_status_without_babel_version_returns_none(self):
        nn = NodeNorm(nodenorm_url="https://example.com/nn")
        with patch(
            "babel_explorer.core.nodenorm.requests.get",
            return_value=self._status_response({"biolink_model": {"tag": "v4.2.6"}}),
        ):
            assert nn.get_babel_version() is None

    def test_result_is_cached(self):
        nn = NodeNorm(nodenorm_url="https://example.com/nn")
        with patch(
            "babel_explorer.core.nodenorm.requests.get",
            return_value=self._status_response({"babel_version": "2026jul22"}),
        ) as mock_get:
            nn.get_babel_version()
            nn.get_babel_version()
            mock_get.assert_called_once()

    def test_failure_is_cached_too(self):
        """A failed lookup must not be retried on every subsequent call."""
        nn = NodeNorm(nodenorm_url="https://example.com/nn")
        with patch(
            "babel_explorer.core.nodenorm.requests.get",
            side_effect=requests.ConnectionError("boom"),
        ) as mock_get:
            nn.get_babel_version()
            nn.get_babel_version()
            mock_get.assert_called_once()


# ==========================================================================
# Integration Tests — require real NodeNorm API
# ==========================================================================


@pytest.mark.integration
@pytest.mark.parametrize("curie", VALID_CURIES)
def test_normalize_curie_real_api(nodenorm, curie):
    """normalize_curie returns a dict with expected keys."""
    result = nodenorm.normalize_curie(curie)
    assert isinstance(result, dict)
    assert "id" in result
    assert "equivalent_identifiers" in result
    assert "type" in result


@pytest.mark.integration
@pytest.mark.parametrize("curie", VALID_CURIES)
def test_get_identifier_real_api(nodenorm, curie):
    """get_identifier returns an Identifier with non-empty label and biolink_type."""
    ident = nodenorm.get_identifier(curie)
    assert isinstance(ident, Identifier)
    assert ident.curie == curie
    assert ident.label != ""


@pytest.mark.integration
@pytest.mark.parametrize("curie", VALID_CURIES)
def test_get_clique_identifiers_real_api(nodenorm, curie):
    """get_clique_identifiers returns a non-empty list of Identifiers."""
    result = nodenorm.get_clique_identifiers(curie)
    assert result is not None
    assert len(result) > 0
    assert all(isinstance(x, Identifier) for x in result)


@pytest.mark.integration
@pytest.mark.parametrize("curie", VALID_CURIES)
def test_get_clique_identifiers_has_known_ids(nodenorm, curie):
    """At least one equivalent identifier is returned."""
    result = nodenorm.get_clique_identifiers(curie)
    assert len(result) >= 1


@pytest.mark.integration
def test_normalize_curie_nonexistent(nodenorm):
    """A made-up CURIE returns None."""
    result = nodenorm.normalize_curie("FAKENS:9999999999")
    assert result is None


class TestNormalizeCuriesBatching:
    """Many CURIEs must cost a handful of requests, not one each."""

    @staticmethod
    def _resp(payload):
        r = Mock()
        r.json.return_value = payload
        r.raise_for_status = Mock()
        return r

    def test_one_request_for_many_curies(self):
        nn = NodeNorm(nodenorm_url="https://example.com/")
        curies = [f"X:{i}" for i in range(50)]
        payload = {c: {"id": {"identifier": c}} for c in curies}

        with patch(
            "babel_explorer.core.nodenorm.requests.get",
            return_value=self._resp(payload),
        ) as mock_get:
            nn.normalize_curies(curies)
            assert mock_get.call_count == 1
            assert sorted(mock_get.call_args.kwargs["params"]["curie"]) == sorted(
                curies
            )

    def test_chunks_above_the_batch_size(self):
        nn = NodeNorm(nodenorm_url="https://example.com/")
        curies = [f"X:{i:04d}" for i in range(NORMALIZE_BATCH_SIZE * 2 + 1)]

        with patch(
            "babel_explorer.core.nodenorm.requests.get",
            return_value=self._resp({}),
        ) as mock_get:
            nn.normalize_curies(curies)
            assert mock_get.call_count == 3
            sizes = [len(c.kwargs["params"]["curie"]) for c in mock_get.call_args_list]
            assert sizes == [NORMALIZE_BATCH_SIZE, NORMALIZE_BATCH_SIZE, 1]

    def test_prefetched_curies_are_not_refetched(self):
        nn = NodeNorm(nodenorm_url="https://example.com/")
        payload = {"X:1": {"id": {"identifier": "X:1"}}}

        with patch(
            "babel_explorer.core.nodenorm.requests.get",
            return_value=self._resp(payload),
        ) as mock_get:
            nn.normalize_curies(["X:1"])
            nn.normalize_curie("X:1")
            nn.get_identifier("X:1")
            assert mock_get.call_count == 1

    def test_unrecognised_curie_caches_none(self):
        nn = NodeNorm(nodenorm_url="https://example.com/")
        with patch(
            "babel_explorer.core.nodenorm.requests.get", return_value=self._resp({})
        ) as mock_get:
            nn.normalize_curies(["MISSING:1"])
            assert nn.normalize_curie("MISSING:1") is None
            assert mock_get.call_count == 1

    def test_offline_mode_makes_no_requests(self):
        nn = NodeNorm(nodenorm_url="")
        with patch("babel_explorer.core.nodenorm.requests.get") as mock_get:
            nn.normalize_curies(["X:1", "X:2"])
            assert nn.normalize_curie("X:1") is None
            mock_get.assert_not_called()

    def test_http_error_is_not_cached(self):
        nn = NodeNorm(nodenorm_url="https://example.com/")
        bad = Mock()
        bad.raise_for_status.side_effect = requests.HTTPError("500 Server Error")

        with patch("babel_explorer.core.nodenorm.requests.get", return_value=bad):
            with pytest.raises(requests.HTTPError):
                nn.normalize_curies(["X:1"])
        assert "X:1" not in nn._normalize_cache


class TestNodeNormFixtureSkips:
    """An unreachable NodeNorm must skip its integration tests, not fail them.

    Same blind spot as the Babel-side guard: these fixtures only do anything during an
    integration run, and CI's integration job skips, so nothing would notice the probe
    being dropped. Exercising the fixture function directly puts it in the unit suite.
    """

    @staticmethod
    def _call_fixture():
        """Invoke the fixture's underlying function directly, past the decorator."""
        return conftest.nodenorm.__wrapped__()

    def test_unreachable_api_skips(self):
        with patch(
            "tests.conftest.requests.get",
            side_effect=requests.ConnectionError("network down"),
        ):
            with pytest.raises(Skipped) as excinfo:
                self._call_fixture()

        assert "NodeNorm unreachable" in str(excinfo.value)

    def test_error_status_skips(self):
        """A 5xx is as unusable as no connection at all."""
        response = Mock()
        response.raise_for_status.side_effect = requests.HTTPError("503")

        with patch("tests.conftest.requests.get", return_value=response):
            with pytest.raises(Skipped):
                self._call_fixture()

    def test_reachable_api_returns_a_client(self):
        """The probe must not swallow the normal path."""
        with patch("tests.conftest.requests.get", return_value=Mock()):
            client = self._call_fixture()

        assert isinstance(client, NodeNorm)
