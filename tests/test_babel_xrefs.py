"""
Tests for BabelXRefs, CrossReference, LabeledCrossReference, and IdentifierRecord.

Unit tests use mocks; integration tests query real Parquet files via DuckDB.
"""

import pytest
from unittest.mock import patch, MagicMock

from babel_explorer.core.babel_xrefs import (
    BabelXRefs,
    CrossReference,
    LabeledCrossReference,
    IdentifierRecord,
)
from babel_explorer.core.downloader import BabelDownloader
from babel_explorer.core.nodenorm import NodeNorm

from tests.constants import load_curies

VALID_CURIES = load_curies()


# ==========================================================================
# Unit Tests — CrossReference
# ==========================================================================


class TestCrossReference:
    def test_creation(self):
        xr = CrossReference(filename="f.txt", subj="A:1", pred="skos:exactMatch", obj="B:2")
        assert xr.filename == "f.txt"
        assert xr.subj == "A:1"
        assert xr.pred == "skos:exactMatch"
        assert xr.obj == "B:2"

    def test_from_tuple(self):
        t = ("file.tsv", "MONDO:1", "owl:sameAs", "HP:2")
        xr = CrossReference.from_tuple(t)
        assert xr.filename == "file.tsv"
        assert xr.subj == "MONDO:1"
        assert xr.pred == "owl:sameAs"
        assert xr.obj == "HP:2"

    def test_curies_property(self):
        xr = CrossReference(filename="f", subj="A:1", pred="p", obj="B:2")
        assert xr.curies == frozenset({"A:1", "B:2"})

    def test_frozen_immutability(self):
        xr = CrossReference(filename="f", subj="A:1", pred="p", obj="B:2")
        with pytest.raises(AttributeError):
            xr.subj = "changed"

    def test_equality(self):
        a = CrossReference(filename="f", subj="A:1", pred="p", obj="B:2")
        b = CrossReference(filename="f", subj="A:1", pred="p", obj="B:2")
        assert a == b

    def test_hashability(self):
        a = CrossReference(filename="f", subj="A:1", pred="p", obj="B:2")
        b = CrossReference(filename="f", subj="A:1", pred="p", obj="B:2")
        assert hash(a) == hash(b)
        assert len({a, b}) == 1

    def test_lt_ordering(self):
        a = CrossReference(filename="a.tsv", subj="A:1", pred="p", obj="B:2")
        b = CrossReference(filename="b.tsv", subj="A:1", pred="p", obj="B:2")
        assert a < b

    def test_sorting(self):
        items = [
            CrossReference(filename="c", subj="C:1", pred="p", obj="D:1"),
            CrossReference(filename="a", subj="A:1", pred="p", obj="B:1"),
            CrossReference(filename="b", subj="B:1", pred="p", obj="C:1"),
        ]
        result = sorted(items)
        assert [x.filename for x in result] == ["a", "b", "c"]


# ==========================================================================
# Unit Tests — LabeledCrossReference
# ==========================================================================


class TestLabeledCrossReference:
    def test_creation(self):
        lxr = LabeledCrossReference(
            subj="A:1", pred="p", obj="B:2", filename="f",
            subj_label="Alpha", subj_biolink_type="biolink:Disease",
            obj_label="Beta", obj_biolink_type="biolink:Gene",
        )
        assert lxr.subj == "A:1"
        assert lxr.subj_label == "Alpha"
        assert lxr.obj_biolink_type == "biolink:Gene"

    def test_inherits_from_cross_reference(self):
        lxr = LabeledCrossReference(
            subj="A:1", pred="p", obj="B:2", filename="f",
            subj_label="", subj_biolink_type="", obj_label="", obj_biolink_type="",
        )
        assert isinstance(lxr, CrossReference)

    def test_curies_property(self):
        lxr = LabeledCrossReference(
            subj="A:1", pred="p", obj="B:2", filename="f",
            subj_label="", subj_biolink_type="", obj_label="", obj_biolink_type="",
        )
        assert lxr.curies == frozenset({"A:1", "B:2"})

    def test_str(self):
        lxr = LabeledCrossReference(
            subj="A:1", pred="p", obj="B:2", filename="f",
            subj_label="Alpha", subj_biolink_type="biolink:Disease",
            obj_label="Beta", obj_biolink_type="biolink:Gene",
        )
        s = str(lxr)
        assert "A:1" in s
        assert "B:2" in s
        assert "Alpha" in s


# ==========================================================================
# Unit Tests — IdentifierRecord
# ==========================================================================


class TestIdentifierRecord:
    def test_creation(self):
        rec = IdentifierRecord(curie="MONDO:0004979")
        assert rec.curie == "MONDO:0004979"
        assert rec.extra_fields == ()

    def test_from_row(self):
        row = ("MONDO:0004979", "Disease", "asthma")
        cols = ["curie", "category", "label"]
        rec = IdentifierRecord.from_row(row, cols)
        assert rec.curie == "MONDO:0004979"
        assert ("category", "Disease") in rec.extra_fields
        assert ("label", "asthma") in rec.extra_fields

    def test_frozen(self):
        rec = IdentifierRecord(curie="X:1")
        with pytest.raises(AttributeError):
            rec.curie = "changed"

    def test_str(self):
        rec = IdentifierRecord(curie="X:1", extra_fields=(("type", "Gene"),))
        s = str(rec)
        assert "X:1" in s
        assert "type" in s
        assert "Gene" in s


# ==========================================================================
# Unit Tests — BabelXRefs (mocked)
# ==========================================================================


class TestBabelXRefsInit:
    def test_init_without_nodenorm(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        bx = BabelXRefs(dl)
        assert bx.downloader is dl
        assert bx.nodenorm is None

    def test_init_with_nodenorm(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        nn = NodeNorm("https://example.com/")
        bx = BabelXRefs(dl, nn)
        assert bx.nodenorm is nn


class TestBabelXRefsMocked:
    """Mocked query tests — no DuckDB or Parquet files needed."""

    def _make_bx(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        return BabelXRefs(dl)

    def test_get_curie_xref_calls_downloader(self, tmp_path):
        bx = self._make_bx(tmp_path)
        mock_result = MagicMock()
        mock_result.fetchall.return_value = [
            ("concord.tsv", "A:1", "skos:exactMatch", "B:2"),
        ]
        mock_db = MagicMock()
        mock_db.read_parquet.return_value = "table"
        mock_db.execute.return_value = mock_result

        with patch.object(bx.downloader, 'get_downloaded_file', return_value="/fake/path") as mock_dl:
            with patch.object(bx.downloader, 'get_output_file', return_value="/fake/db"):
                with patch("babel_explorer.core.babel_xrefs.duckdb.connect", return_value=mock_db):
                    bx.get_curie_xref.cache_clear()
                    result = bx.get_curie_xref("A:1")
                    # Downloader should be called for Concord and Metadata
                    assert mock_dl.call_count == 2
                    result_list = list(result)
                    assert len(result_list) == 1
                    assert isinstance(result_list[0], CrossReference)

    def test_get_curie_xrefs_no_expand(self, tmp_path):
        bx = self._make_bx(tmp_path)
        xr = CrossReference(filename="f", subj="A:1", pred="p", obj="B:2")
        with patch.object(bx, 'get_curie_xref', return_value=[xr]):
            bx.get_curie_xref.cache_clear()
            result = bx.get_curie_xrefs(["A:1"], recurse=False)
            assert len(result) == 1
            assert result[0] == xr

    def test_get_curie_xrefs_with_expand(self, tmp_path):
        bx = self._make_bx(tmp_path)
        xr1 = CrossReference(filename="f", subj="A:1", pred="p", obj="B:2")
        xr2 = CrossReference(filename="f", subj="B:2", pred="p", obj="C:3")

        def mock_get_curie_xref(curie, label_curies=False):
            if curie == "A:1":
                return [xr1]
            elif curie == "B:2":
                return [xr2]
            return []

        with patch.object(bx, 'get_curie_xref', side_effect=mock_get_curie_xref):
            result = bx.get_curie_xrefs(["A:1"], recurse=True)
            assert xr1 in result
            assert xr2 in result

    def test_results_are_sorted(self, tmp_path):
        bx = self._make_bx(tmp_path)
        xr_b = CrossReference(filename="b", subj="B:1", pred="p", obj="C:1")
        xr_a = CrossReference(filename="a", subj="A:1", pred="p", obj="B:1")

        with patch.object(bx, 'get_curie_xref', return_value=[xr_b, xr_a]):
            result = bx.get_curie_xrefs(["X:1"], recurse=False)
            assert result == [xr_a, xr_b]


# ==========================================================================
# Integration Tests — require downloaded Parquet files
# ==========================================================================


@pytest.mark.integration
@pytest.mark.parametrize("curie", VALID_CURIES)
def test_get_curie_xref(babel_xrefs, curie):
    """get_curie_xref returns non-empty CrossReferences with the queried CURIE."""
    babel_xrefs.get_curie_xref.cache_clear()
    results = list(babel_xrefs.get_curie_xref(curie))
    assert len(results) > 0, f"No cross-references found for {curie}"
    for xr in results:
        assert isinstance(xr, CrossReference)
        assert curie in (xr.subj, xr.obj)


@pytest.mark.integration
@pytest.mark.parametrize("curie", VALID_CURIES)
def test_get_curie_xref_returns_known_xrefs(babel_xrefs, curie):
    """At least one cross-reference is found."""
    babel_xrefs.get_curie_xref.cache_clear()
    results = list(babel_xrefs.get_curie_xref(curie))
    assert len(results) >= 1


@pytest.mark.integration
@pytest.mark.parametrize("curie", VALID_CURIES)
def test_get_curie_xrefs_single_no_expand(babel_xrefs, curie):
    """get_curie_xrefs without expansion returns sorted, non-empty results."""
    babel_xrefs.get_curie_xref.cache_clear()
    results = babel_xrefs.get_curie_xrefs([curie], recurse=False)
    assert len(results) > 0
    assert results == sorted(results)


@pytest.mark.integration
@pytest.mark.parametrize("curie", VALID_CURIES)
def test_get_curie_xrefs_expansion_finds_more(babel_xrefs, curie):
    """Expanded results are at least as many as non-expanded."""
    babel_xrefs.get_curie_xref.cache_clear()
    non_expanded = babel_xrefs.get_curie_xrefs([curie], recurse=False)
    babel_xrefs.get_curie_xref.cache_clear()
    expanded = babel_xrefs.get_curie_xrefs([curie], recurse=True)
    assert len(expanded) >= len(non_expanded)


@pytest.mark.integration
@pytest.mark.parametrize("curie", VALID_CURIES)
def test_get_curie_xrefs_expanded_includes_original(babel_xrefs, curie):
    """Non-expanded results are a subset of expanded results."""
    babel_xrefs.get_curie_xref.cache_clear()
    non_expanded = set(babel_xrefs.get_curie_xrefs([curie], recurse=False))
    babel_xrefs.get_curie_xref.cache_clear()
    expanded = set(babel_xrefs.get_curie_xrefs([curie], recurse=True))
    assert non_expanded.issubset(expanded)


@pytest.mark.integration
def test_get_curie_xref_caching(babel_xrefs):
    """Cached calls return the same object."""
    curie = VALID_CURIES[0]
    babel_xrefs.get_curie_xref.cache_clear()
    r1 = babel_xrefs.get_curie_xref(curie)
    r2 = babel_xrefs.get_curie_xref(curie)
    assert r1 is r2


@pytest.mark.integration
@pytest.mark.parametrize("curie", VALID_CURIES)
def test_get_curie_xref_with_labels(babel_xrefs_with_nodenorm, curie):
    """With labels, returns LabeledCrossReference objects."""
    babel_xrefs_with_nodenorm.get_curie_xref.cache_clear()
    results = list(babel_xrefs_with_nodenorm.get_curie_xref(curie, label_curies=True))
    assert len(results) > 0
    for xr in results:
        assert isinstance(xr, LabeledCrossReference)


@pytest.mark.integration
def test_get_curie_xref_nonexistent_curie(babel_xrefs):
    """A made-up CURIE returns an empty list."""
    babel_xrefs.get_curie_xref.cache_clear()
    results = list(babel_xrefs.get_curie_xref("FAKE:9999999999"))
    assert results == []


@pytest.mark.integration
@pytest.mark.slow
@pytest.mark.parametrize("curie", VALID_CURIES)
def test_get_curie_ids(babel_xrefs, downloaded_identifiers, curie):
    """get_curie_ids returns non-empty IdentifierRecord objects."""
    results = babel_xrefs.get_curie_ids([curie])
    assert len(results) > 0
    for rec in results:
        assert isinstance(rec, IdentifierRecord)
        assert rec.curie == curie
