"""Unit tests for babel_explorer.core.curie_utils."""

import pytest

from babel_explorer.core.curie_utils import (
    DEFAULT_PREFIX_MAP,
    split_curie,
    to_iri,
    from_iri,
)


class TestSplitCurie:
    def test_basic(self):
        assert split_curie("CHEBI:31941") == ("CHEBI", "31941")

    def test_compound_prefix(self):
        assert split_curie("PUBCHEM.COMPOUND:43805") == ("PUBCHEM.COMPOUND", "43805")

    def test_only_splits_on_first_colon(self):
        assert split_curie("UMLS:C1314429:extra") == ("UMLS", "C1314429:extra")

    @pytest.mark.parametrize(
        "bad", ["", "no_colon_here", ":missing_prefix", "missing_local:"]
    )
    def test_rejects_invalid(self, bad):
        with pytest.raises(ValueError):
            split_curie(bad)


class TestToIri:
    def test_obo_purl(self):
        assert to_iri("CHEBI:31941") == "http://purl.obolibrary.org/obo/CHEBI_31941"

    def test_pubchem(self):
        assert (
            to_iri("PUBCHEM.COMPOUND:43805")
            == "http://identifiers.org/pubchem.compound/43805"
        )

    def test_umls(self):
        assert (
            to_iri("UMLS:C1314429")
            == "http://linkedlifedata.com/resource/umls/id/C1314429"
        )

    def test_unknown_prefix_raises(self):
        with pytest.raises(KeyError):
            to_iri("WIBBLE:123")

    def test_custom_prefix_map(self):
        custom = {"FOO": "http://example.com/foo/"}
        assert to_iri("FOO:bar", custom) == "http://example.com/foo/bar"


class TestFromIri:
    def test_obo_purl(self):
        assert from_iri("http://purl.obolibrary.org/obo/CHEBI_31941") == "CHEBI:31941"

    def test_pubchem(self):
        assert (
            from_iri("http://identifiers.org/pubchem.compound/43805")
            == "PUBCHEM.COMPOUND:43805"
        )

    def test_unknown_iri_raises(self):
        with pytest.raises(ValueError):
            from_iri("http://example.com/wibble/123")

    def test_longest_match_wins(self):
        """If two prefixes share an IRI base, the longer one is preferred."""
        m = {
            "SHORT": "http://x.org/",
            "LONG": "http://x.org/sub/",
        }
        assert from_iri("http://x.org/sub/42", m) == "LONG:42"


class TestRoundTrip:
    @pytest.mark.parametrize(
        "curie",
        [
            "CHEBI:31941",
            "MONDO:0004979",
            "HP:0000001",
            "PUBCHEM.COMPOUND:43805",
            "UMLS:C1314429",
            "CHEMBL.COMPOUND:CHEMBL25",
            "DRUGBANK:DB00945",
            "KEGG.COMPOUND:C00031",
            "UNII:R16CO5Y76E",
            "INCHIKEY:BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
        ],
    )
    def test_curie_iri_roundtrip(self, curie):
        assert from_iri(to_iri(curie)) == curie


class TestDefaultPrefixMap:
    def test_has_issue_715_prefixes(self):
        for prefix in ("CHEBI", "PUBCHEM.COMPOUND", "UMLS"):
            assert prefix in DEFAULT_PREFIX_MAP

    def test_all_iri_prefixes_end_with_separator(self):
        """Each IRI prefix must end with '_' or '/' so naive concat works."""
        for prefix, iri in DEFAULT_PREFIX_MAP.items():
            assert iri.endswith(("_", "/")), f"{prefix}: {iri!r}"
