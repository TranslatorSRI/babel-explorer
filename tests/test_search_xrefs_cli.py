"""Tests for the `babel-explorer search-xrefs` CLI command.

Unit tests — providers and Babel layer are mocked at the CLI import boundary.
"""

import json

from click.testing import CliRunner
from unittest.mock import patch, MagicMock

from babel_explorer.cli import cli
from babel_explorer.core.babel_xrefs import CrossReference
from babel_explorer.core.providers import CandidateXRef


def _mock_provider(name: str, candidates: list[CandidateXRef]) -> MagicMock:
    """A MagicMock that imitates an XRefProvider returning ``candidates``."""
    p = MagicMock()
    p.name = name
    p.fetch.return_value = list(candidates)
    return p


def _patch_cli_layer(provider_map: dict[str, MagicMock], babel_xrefs: list = ()):
    """Context manager-like helper: returns a list of patches to use with ExitStack.

    But for brevity we inline the patches in each test instead.
    """
    raise NotImplementedError  # placeholder; tests inline their patches.


# A canonical candidate the provider mock will return.
_CAND = CandidateXRef(
    query_curie="CHEBI:31941",
    target_curie="DRUGBANK:DB00526",
    provider="OLS4",
    predicate="oboInOwl:hasDbXref",
    confidence=None,
    evidence="http://purl.obolibrary.org/obo/CHEBI_31941",
    in_babel=False,
)


class TestSmoke:
    def test_help_exit_zero(self):
        runner = CliRunner()
        result = runner.invoke(cli, ["search-xrefs", "--help"])
        assert result.exit_code == 0
        assert "search-xrefs" in result.output

    def test_missing_curie_exits_nonzero(self):
        runner = CliRunner()
        result = runner.invoke(cli, ["search-xrefs"])
        assert result.exit_code != 0

    def test_unknown_provider_rejected(self):
        runner = CliRunner()
        with (
            patch("babel_explorer.cli.BabelDownloader"),
            patch("babel_explorer.cli.BabelXRefs"),
            patch("babel_explorer.cli.NodeNorm"),
        ):
            result = runner.invoke(
                cli, ["search-xrefs", "CHEBI:31941", "--providers", "wibble"]
            )
        assert result.exit_code != 0
        assert "wibble" in result.output.lower() or "unknown" in result.output.lower()


class TestHappyPath:
    def _run(self, args, candidates=None, babel_xrefs=None, label_ident=None):
        runner = CliRunner()
        mock_provider = _mock_provider("OLS4", candidates or [_CAND])
        with (
            patch("babel_explorer.cli.BabelDownloader"),
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
            patch("babel_explorer.cli.NodeNorm") as mock_nn,
            patch.dict(
                "babel_explorer.cli.PROVIDERS",
                {"ols": lambda **kw: mock_provider},
                clear=True,
            ),
        ):
            mock_bx.return_value.get_curie_xref.return_value = babel_xrefs or []
            if label_ident is not None:
                mock_nn.return_value.get_identifier.return_value = label_ident
            result = runner.invoke(cli, ["search-xrefs", *args])
        return result, mock_provider, mock_bx, mock_nn

    def test_basic_invocation(self):
        result, mock_provider, _, _ = self._run(["CHEBI:31941"])
        assert result.exit_code == 0, result.output
        mock_provider.fetch.assert_called_once_with("CHEBI:31941")
        assert "DRUGBANK:DB00526" in result.output

    def test_in_babel_annotation_when_edge_known(self):
        babel_edge = CrossReference(
            filename="Concord.parquet",
            subj="CHEBI:31941",
            pred="skos:exactMatch",
            obj="DRUGBANK:DB00526",
        )
        result, _, _, _ = self._run(["CHEBI:31941"], babel_xrefs=[babel_edge])
        assert result.exit_code == 0
        # Console output contains the "known" marker
        assert "known" in result.output

    def test_new_annotation_when_edge_unknown(self):
        result, _, _, _ = self._run(["CHEBI:31941"], babel_xrefs=[])
        assert result.exit_code == 0
        assert "NEW" in result.output

    def test_ignore_known_filters_out_known(self):
        babel_edge = CrossReference(
            filename="Concord.parquet",
            subj="CHEBI:31941",
            pred="skos:exactMatch",
            obj="DRUGBANK:DB00526",
        )
        result, _, _, _ = self._run(
            ["CHEBI:31941", "--ignore-known"],
            babel_xrefs=[babel_edge],
        )
        assert result.exit_code == 0
        # No candidates remain — output is empty (no header, no rows).
        assert "DRUGBANK:DB00526" not in result.output

    def test_ignore_known_keeps_new(self):
        result, _, _, _ = self._run(["CHEBI:31941", "--ignore-known"], babel_xrefs=[])
        assert result.exit_code == 0
        assert "DRUGBANK:DB00526" in result.output

    def test_labels_flag_fetches_target_label(self):
        ident = MagicMock()
        ident.label = "oxaliplatin"
        ident.biolink_type = ("biolink:ChemicalEntity",)
        result, _, _, mock_nn = self._run(
            ["CHEBI:31941", "--labels"], label_ident=ident
        )
        assert result.exit_code == 0
        mock_nn.return_value.get_identifier.assert_called()
        assert "oxaliplatin" in result.output


class TestFormats:
    """The four --format options all produce parseable output."""

    def _run(self, args, candidates=None, babel_xrefs=None):
        runner = CliRunner()
        mock_provider = _mock_provider("OLS4", candidates or [_CAND])
        with (
            patch("babel_explorer.cli.BabelDownloader"),
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
            patch("babel_explorer.cli.NodeNorm"),
            patch.dict(
                "babel_explorer.cli.PROVIDERS",
                {"ols": lambda **kw: mock_provider},
                clear=True,
            ),
        ):
            mock_bx.return_value.get_curie_xref.return_value = babel_xrefs or []
            return runner.invoke(cli, ["search-xrefs", *args])

    def test_format_console(self):
        result = self._run(["CHEBI:31941", "--format", "console"])
        assert result.exit_code == 0
        assert "DRUGBANK:DB00526" in result.output

    def test_format_json(self):
        result = self._run(["CHEBI:31941", "--format", "json"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert len(data) == 1
        assert data[0]["query_curie"] == "CHEBI:31941"
        assert data[0]["target_curie"] == "DRUGBANK:DB00526"
        assert data[0]["provider"] == "OLS4"
        assert data[0]["in_babel"] is False

    def test_format_tsv(self):
        result = self._run(["CHEBI:31941", "--format", "tsv"])
        assert result.exit_code == 0
        lines = result.output.splitlines()
        assert "query_curie" in lines[0]
        assert "target_curie" in lines[0]
        assert "CHEBI:31941" in lines[1]
        assert "DRUGBANK:DB00526" in lines[1]

    def test_format_csv(self):
        result = self._run(["CHEBI:31941", "--format", "csv"])
        assert result.exit_code == 0
        lines = result.output.splitlines()
        assert "query_curie,target_curie" in lines[0].replace(" ", "")
        assert "CHEBI:31941" in lines[1]


class TestMultipleProviders:
    def test_providers_arg_selects_subset(self):
        """--providers ols selects only the OLS provider."""
        runner = CliRunner()
        ols_mock = _mock_provider("OLS4", [_CAND])
        other_mock = _mock_provider("OTHER", [])
        with (
            patch("babel_explorer.cli.BabelDownloader"),
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
            patch("babel_explorer.cli.NodeNorm"),
            patch.dict(
                "babel_explorer.cli.PROVIDERS",
                {"ols": lambda **kw: ols_mock, "other": lambda **kw: other_mock},
                clear=True,
            ),
        ):
            mock_bx.return_value.get_curie_xref.return_value = []
            result = runner.invoke(
                cli, ["search-xrefs", "CHEBI:31941", "--providers", "ols"]
            )

        assert result.exit_code == 0
        ols_mock.fetch.assert_called_once()
        other_mock.fetch.assert_not_called()

    def test_default_uses_all_providers(self):
        runner = CliRunner()
        a = _mock_provider("A", [])
        b = _mock_provider("B", [])
        with (
            patch("babel_explorer.cli.BabelDownloader"),
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
            patch("babel_explorer.cli.NodeNorm"),
            patch.dict(
                "babel_explorer.cli.PROVIDERS",
                {"a": lambda **kw: a, "b": lambda **kw: b},
                clear=True,
            ),
        ):
            mock_bx.return_value.get_curie_xref.return_value = []
            result = runner.invoke(cli, ["search-xrefs", "CHEBI:31941"])

        assert result.exit_code == 0
        a.fetch.assert_called_once()
        b.fetch.assert_called_once()
