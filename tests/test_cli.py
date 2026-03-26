"""
Tests for CLI helper functions.

Unit tests — no network required.
"""

import pytest
import click
from click.testing import CliRunner
from unittest.mock import patch, MagicMock

from babel_explorer.cli import parse_duration, cli


# ==========================================================================
# Unit Tests — no network required
# ==========================================================================


class TestParseDuration:
    """Tests for parse_duration()."""

    @pytest.mark.parametrize(
        "value, expected",
        [
            ("never", float("inf")),
            ("NEVER", float("inf")),
            ("3h", 10800),
            ("3H", 10800),
            ("30m", 1800),
            ("1d", 86400),
            ("7200s", 7200),
            ("7200", 7200),
            ("0", 0),
            ("  3h  ", 10800),
        ],
    )
    def test_valid_inputs(self, value, expected):
        assert parse_duration(value) == expected

    @pytest.mark.parametrize(
        "value",
        [
            "",
            None,
            "abc",
            "3.5h",
            "1.5",
            "3x",
        ],
    )
    def test_invalid_inputs_raise_bad_parameter(self, value):
        with pytest.raises(click.BadParameter):
            parse_duration(value)


class TestCliCommands:
    """Tests for CLI commands using CliRunner — no network required."""

    def test_xrefs_happy_path(self):
        runner = CliRunner()
        mock_xref = MagicMock()
        mock_xref.__str__ = lambda self: "A:1 skos:exactMatch B:2"

        with (
            patch("babel_explorer.cli.BabelDownloader"),
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
            patch("babel_explorer.cli.NodeNorm"),
        ):
            mock_bx.return_value.get_curie_xrefs.return_value = [mock_xref]
            result = runner.invoke(cli, ["xrefs", "MONDO:0004979"])

        assert result.exit_code == 0
        mock_bx.return_value.get_curie_xrefs.assert_called_once_with(
            ("MONDO:0004979",), False, label_curies=False
        )

    def test_xrefs_recurse_and_labels_flags(self):
        runner = CliRunner()
        mock_xref = MagicMock()
        mock_xref.__str__ = lambda self: "A:1 skos:exactMatch B:2"

        with (
            patch("babel_explorer.cli.BabelDownloader"),
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
            patch("babel_explorer.cli.NodeNorm"),
        ):
            mock_bx.return_value.get_curie_xrefs.return_value = [mock_xref]
            result = runner.invoke(
                cli, ["xrefs", "MONDO:0004979", "--recurse", "--labels"]
            )

        assert result.exit_code == 0
        mock_bx.return_value.get_curie_xrefs.assert_called_once_with(
            ("MONDO:0004979",), True, label_curies=True
        )

    def test_xrefs_check_download_option(self):
        runner = CliRunner()

        with (
            patch("babel_explorer.cli.BabelDownloader") as mock_dl,
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
            patch("babel_explorer.cli.NodeNorm"),
        ):
            mock_bx.return_value.get_curie_xrefs.return_value = []
            result = runner.invoke(
                cli, ["xrefs", "MONDO:0004979", "--check-download", "1h"]
            )

        assert result.exit_code == 0
        _, kwargs = mock_dl.call_args
        assert kwargs.get("freshness_seconds") == 3600

    def test_ids_happy_path(self):
        runner = CliRunner()
        mock_id = MagicMock()
        mock_id.__str__ = lambda self: "MONDO:0004979 record"

        with (
            patch("babel_explorer.cli.BabelDownloader"),
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
        ):
            mock_bx.return_value.get_curie_ids.return_value = [mock_id]
            result = runner.invoke(cli, ["ids", "MONDO:0004979"])

        assert result.exit_code == 0
        mock_bx.return_value.get_curie_ids.assert_called_once_with(("MONDO:0004979",))

    def test_test_concord_happy_path(self):
        runner = CliRunner()
        mock_ident = MagicMock()
        mock_ident.curie = "MONDO:0004979"
        mock_ident.label = "asthma"
        mock_ident.biolink_type = "biolink:Disease"

        with patch("babel_explorer.cli.NodeNorm") as mock_nn:
            mock_nn.return_value.get_clique_identifiers.return_value = [mock_ident]
            result = runner.invoke(cli, ["test-concord", "MONDO:0004979"])

        assert result.exit_code == 0
        assert "asthma" in result.output
        mock_nn.return_value.get_clique_identifiers.assert_called_once_with(
            "MONDO:0004979"
        )

    def test_test_concord_no_label(self):
        runner = CliRunner()
        mock_ident = MagicMock()
        mock_ident.curie = "MONDO:0004979"
        mock_ident.label = None
        mock_ident.biolink_type = "biolink:Disease"

        with patch("babel_explorer.cli.NodeNorm") as mock_nn:
            mock_nn.return_value.get_clique_identifiers.return_value = [mock_ident]
            result = runner.invoke(cli, ["test-concord", "MONDO:0004979"])

        assert result.exit_code == 0
        assert "MONDO:0004979" in result.output
        assert "biolink:Disease" in result.output
