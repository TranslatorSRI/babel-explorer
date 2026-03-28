"""Unit tests for the web frontend. All core objects are mocked — no network or Parquet files needed."""

import pytest
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from babel_explorer.core.nodenorm import Identifier
from babel_explorer.core.babel_xrefs import CrossReference, IdentifierRecord
from babel_explorer.web import create_app


@pytest.fixture()
def mock_nodenorm():
    nn = MagicMock()
    nn.get_identifier.return_value = Identifier(
        curie="MONDO:0004979",
        label="asthma",
        biolink_type="biolink:Disease",
        taxa=[],
        description=["A chronic respiratory disease"],
    )
    nn.get_clique_identifiers.return_value = [
        Identifier(
            curie="MONDO:0004979", label="asthma", biolink_type="biolink:Disease"
        ),
        Identifier(curie="DOID:2841", label="asthma", biolink_type="biolink:Disease"),
    ]
    return nn


@pytest.fixture()
def mock_bxref():
    bx = MagicMock()
    bx.get_curie_xrefs.return_value = [
        CrossReference(
            filename="compendia/diseases.txt",
            subj="MONDO:0004979",
            pred="skos:exactMatch",
            obj="DOID:2841",
        ),
    ]
    bx.get_curie_ids.return_value = [
        IdentifierRecord(
            curie="MONDO:0004979",
            extra_fields=(("label", "asthma"), ("type", "biolink:Disease")),
        ),
    ]
    return bx


@pytest.fixture()
def client(mock_nodenorm, mock_bxref):
    app = create_app()
    # Replace real core objects with mocks
    app.state.nodenorm = mock_nodenorm
    app.state.bxref = mock_bxref
    return TestClient(app)


# ---------------------------------------------------------------------------
# HTML pages load
# ---------------------------------------------------------------------------


class TestHTMLPages:
    def test_index(self, client):
        r = client.get("/")
        assert r.status_code == 200
        assert "Babel Explorer" in r.text

    def test_nodenorm_page(self, client):
        r = client.get("/nodenorm")
        assert r.status_code == 200
        assert "NodeNorm" in r.text

    def test_xrefs_page(self, client):
        r = client.get("/xrefs")
        assert r.status_code == 200
        assert "XRefs" in r.text

    def test_ids_page(self, client):
        r = client.get("/ids")
        assert r.status_code == 200
        assert "IDs" in r.text

    def test_test_concord_page(self, client):
        r = client.get("/test-concord")
        assert r.status_code == 200
        assert "Test Concordance" in r.text


# ---------------------------------------------------------------------------
# htmx partials
# ---------------------------------------------------------------------------


class TestHtmxPartials:
    def test_nodenorm(self, client, mock_nodenorm):
        r = client.post(
            "/htmx/nodenorm", data={"curies": "MONDO:0004979", "nodenorm_url": ""}
        )
        assert r.status_code == 200
        assert "asthma" in r.text
        mock_nodenorm.get_identifier.assert_called_once_with("MONDO:0004979")

    def test_nodenorm_empty(self, client):
        r = client.post("/htmx/nodenorm", data={"curies": "", "nodenorm_url": ""})
        assert r.status_code == 200
        assert "No CURIEs provided" in r.text

    def test_xrefs(self, client, mock_bxref):
        r = client.post("/htmx/xrefs", data={"curies": "MONDO:0004979"})
        assert r.status_code == 200
        assert "DOID:2841" in r.text
        mock_bxref.get_curie_xrefs.assert_called_once()

    def test_xrefs_empty(self, client):
        r = client.post("/htmx/xrefs", data={"curies": ""})
        assert r.status_code == 200
        assert "No CURIEs provided" in r.text

    def test_ids(self, client, mock_bxref):
        r = client.post("/htmx/ids", data={"curies": "MONDO:0004979"})
        assert r.status_code == 200
        assert "MONDO:0004979" in r.text
        mock_bxref.get_curie_ids.assert_called_once()

    def test_ids_empty(self, client):
        r = client.post("/htmx/ids", data={"curies": ""})
        assert r.status_code == 200
        assert "No CURIEs provided" in r.text

    def test_test_concord(self, client, mock_nodenorm):
        r = client.post(
            "/htmx/test-concord", data={"curies": "MONDO:0004979", "nodenorm_url": ""}
        )
        assert r.status_code == 200
        assert "DOID:2841" in r.text
        mock_nodenorm.get_clique_identifiers.assert_called_once_with("MONDO:0004979")

    def test_test_concord_empty(self, client):
        r = client.post("/htmx/test-concord", data={"curies": "", "nodenorm_url": ""})
        assert r.status_code == 200
        assert "No CURIEs provided" in r.text


# ---------------------------------------------------------------------------
# JSON API
# ---------------------------------------------------------------------------


class TestAPI:
    def test_nodenorm(self, client, mock_nodenorm):
        r = client.get("/api/nodenorm", params={"curie": "MONDO:0004979"})
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 1
        assert data[0]["label"] == "asthma"

    def test_xrefs(self, client, mock_bxref):
        r = client.get("/api/xrefs", params={"curie": "MONDO:0004979"})
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 1
        assert data[0]["obj"] == "DOID:2841"

    def test_ids(self, client, mock_bxref):
        r = client.get("/api/ids", params={"curie": "MONDO:0004979"})
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 1
        assert data[0]["curie"] == "MONDO:0004979"

    def test_test_concord(self, client, mock_nodenorm):
        r = client.get("/api/test-concord", params={"curie": "MONDO:0004979"})
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 2


# ---------------------------------------------------------------------------
# CSV downloads
# ---------------------------------------------------------------------------


class TestCSV:
    def test_nodenorm_csv(self, client):
        r = client.get("/api/nodenorm/csv", params={"curie": "MONDO:0004979"})
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        assert "asthma" in r.text

    def test_xrefs_csv(self, client):
        r = client.get("/api/xrefs/csv", params={"curie": "MONDO:0004979"})
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        assert "DOID:2841" in r.text

    def test_ids_csv(self, client):
        r = client.get("/api/ids/csv", params={"curie": "MONDO:0004979"})
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        assert "MONDO:0004979" in r.text

    def test_test_concord_csv(self, client):
        r = client.get("/api/test-concord/csv", params={"curie": "MONDO:0004979"})
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        assert "DOID:2841" in r.text


# ---------------------------------------------------------------------------
# _parse_curies helper
# ---------------------------------------------------------------------------


class TestParseCuries:
    def test_basic(self):
        from babel_explorer.web.routes import _parse_curies

        assert _parse_curies("A\nB\nC") == ["A", "B", "C"]

    def test_dedup(self):
        from babel_explorer.web.routes import _parse_curies

        assert _parse_curies("A\nA\nB") == ["A", "B"]

    def test_comments_and_blanks(self):
        from babel_explorer.web.routes import _parse_curies

        assert _parse_curies("# comment\n\nA\n  \nB") == ["A", "B"]

    def test_strips_whitespace(self):
        from babel_explorer.web.routes import _parse_curies

        assert _parse_curies("  A  \n  B  ") == ["A", "B"]
