"""
Tests for CLI helper functions.

Unit tests — no network required.
"""

import json
from unittest.mock import MagicMock, patch

import click
import pytest
from click.testing import CliRunner

from babel_explorer.cli import cli, parse_duration
from babel_explorer.core.babel_xrefs import CrossReference, IdentifierRecord
from babel_explorer.core.downloader import MissingBabelFileError
from babel_explorer.core.nodenorm import Identifier

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
            "-5",
            "-5h",
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
        mock_xref.subj = "A:1"
        mock_xref.obj = "B:2"
        mock_xref.pred = "skos:exactMatch"
        mock_xref.filename = "test.parquet"

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
        mock_xref.subj = "A:1"
        mock_xref.obj = "B:2"
        mock_xref.pred = "skos:exactMatch"
        mock_xref.filename = "test.parquet"

        with (
            patch("babel_explorer.cli.BabelDownloader") as mock_dl,
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
            patch("babel_explorer.cli.NodeNorm") as mock_nn,
        ):
            mock_dl.return_value.babel_version = "2026jul22"
            mock_nn.return_value.get_babel_version.return_value = "2026jul22"
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
        mock_bx.return_value.get_curie_ids.assert_called_once_with(
            ("MONDO:0004979",), label_curies=False
        )

    def test_test_concord_happy_path(self):
        runner = CliRunner()
        mock_ident = MagicMock()
        mock_ident.curie = "MONDO:0004979"
        mock_ident.label = "asthma"
        mock_ident.biolink_type = ["biolink:Disease"]

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
        mock_ident.biolink_type = ["biolink:Disease"]

        with patch("babel_explorer.cli.NodeNorm") as mock_nn:
            mock_nn.return_value.get_clique_identifiers.return_value = [mock_ident]
            result = runner.invoke(cli, ["test-concord", "MONDO:0004979"])

        assert result.exit_code == 0
        assert "MONDO:0004979" in result.output
        assert "biolink:Disease" in result.output

    def test_test_concord_unknown_curie_produces_no_output(self):
        """When get_clique_identifiers returns [], no output is produced and exit code is 0."""
        runner = CliRunner()
        with patch("babel_explorer.cli.NodeNorm") as mock_nn:
            mock_nn.return_value.get_clique_identifiers.return_value = []
            result = runner.invoke(cli, ["test-concord", "UNKNOWN:9999"])
        assert result.exit_code == 0
        assert result.output.strip() == ""

    def test_test_concord_multiple_curies(self):
        """Each CURIE is looked up independently."""
        runner = CliRunner()
        mock_a = MagicMock()
        mock_a.curie = "A:1"
        mock_a.label = "Alpha"
        mock_a.biolink_type = ["biolink:Disease"]
        mock_b = MagicMock()
        mock_b.curie = "B:2"
        mock_b.label = "Beta"
        mock_b.biolink_type = ["biolink:Gene"]

        with patch("babel_explorer.cli.NodeNorm") as mock_nn:
            mock_nn.return_value.get_clique_identifiers.side_effect = [
                [mock_a],
                [mock_b],
            ]
            result = runner.invoke(cli, ["test-concord", "A:1", "B:2"])

        assert result.exit_code == 0
        assert mock_nn.return_value.get_clique_identifiers.call_count == 2
        assert "Alpha" in result.output
        assert "Beta" in result.output


class TestOutputFormats:
    """Tests for --format option on all commands."""

    # Shared real dataclass instances (no mocking needed for formatting logic)
    _xref = CrossReference(
        filename="Concord.parquet", subj="A:1", pred="skos:exactMatch", obj="B:2"
    )
    _id_record = IdentifierRecord(
        curie="A:1", extra_fields=(("type", "gene"), ("label", "Alpha"))
    )
    _identifier = Identifier(
        curie="MONDO:0004979",
        label="asthma",
        biolink_type=("biolink:Disease",),
        taxa=(),
        description=(),
    )

    # -- console format (default) --

    def test_xrefs_default_format_is_console(self):
        """Default format is console — output contains the CURIEs as plain text (no TTY in runner)."""
        runner = CliRunner()
        with (
            patch("babel_explorer.cli.BabelDownloader"),
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
            patch("babel_explorer.cli.NodeNorm"),
        ):
            mock_bx.return_value.get_curie_xrefs.return_value = [self._xref]
            result = runner.invoke(cli, ["xrefs", "A:1"])

        assert result.exit_code == 0
        # Rich strips markup on non-TTY; plain CURIEs and predicate appear
        assert "A:1" in result.output
        assert "B:2" in result.output
        assert "skos:exactMatch" in result.output

    def test_xrefs_console_shows_query_curie(self):
        runner = CliRunner()
        with (
            patch("babel_explorer.cli.BabelDownloader"),
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
            patch("babel_explorer.cli.NodeNorm"),
        ):
            mock_bx.return_value.get_curie_xrefs.return_value = [self._xref]
            result = runner.invoke(cli, ["xrefs", "A:1", "--format", "console"])

        assert result.exit_code == 0
        assert "A:1" in result.output

    def test_test_concord_console_format(self):
        runner = CliRunner()
        with patch("babel_explorer.cli.NodeNorm") as mock_nn:
            mock_nn.return_value.get_clique_identifiers.return_value = [
                self._identifier
            ]
            result = runner.invoke(
                cli, ["test-concord", "MONDO:0004979", "--format", "console"]
            )

        assert result.exit_code == 0
        assert "MONDO:0004979" in result.output
        assert "asthma" in result.output
        assert "biolink:Disease" in result.output

    def test_test_concord_console_no_label_omits_label(self):
        """Identifiers with no label omit the label field entirely in console format."""
        runner = CliRunner()
        mock_ident = MagicMock()
        mock_ident.curie = "MONDO:0004979"
        mock_ident.label = None
        mock_ident.biolink_type = ["biolink:Disease"]

        with patch("babel_explorer.cli.NodeNorm") as mock_nn:
            mock_nn.return_value.get_clique_identifiers.return_value = [mock_ident]
            result = runner.invoke(
                cli, ["test-concord", "MONDO:0004979", "--format", "console"]
            )

        assert result.exit_code == 0
        assert '"' not in result.output

    # -- json format --

    def test_xrefs_format_json(self):
        runner = CliRunner()
        with (
            patch("babel_explorer.cli.BabelDownloader"),
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
            patch("babel_explorer.cli.NodeNorm"),
        ):
            mock_bx.return_value.get_curie_xrefs.return_value = [self._xref]
            result = runner.invoke(cli, ["xrefs", "A:1", "--format", "json"])

        assert result.exit_code == 0
        data = json.loads(result.output)
        assert isinstance(data, list)
        assert data[0]["subj"] == "A:1"
        assert data[0]["obj"] == "B:2"

    def test_xrefs_format_tsv(self):
        runner = CliRunner()
        with (
            patch("babel_explorer.cli.BabelDownloader"),
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
            patch("babel_explorer.cli.NodeNorm"),
        ):
            mock_bx.return_value.get_curie_xrefs.return_value = [self._xref]
            result = runner.invoke(cli, ["xrefs", "A:1", "--format", "tsv"])

        assert result.exit_code == 0
        lines = result.output.splitlines()
        assert lines[0] == "filename\tsubj\tpred\tobj"
        assert "A:1" in lines[1]

    def test_xrefs_format_csv(self):
        runner = CliRunner()
        with (
            patch("babel_explorer.cli.BabelDownloader"),
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
            patch("babel_explorer.cli.NodeNorm"),
        ):
            mock_bx.return_value.get_curie_xrefs.return_value = [self._xref]
            result = runner.invoke(cli, ["xrefs", "A:1", "--format", "csv"])

        assert result.exit_code == 0
        lines = result.output.splitlines()
        assert lines[0] == "filename,subj,pred,obj"
        assert "A:1" in lines[1]

    # -- ids --

    def test_ids_format_json_expands_extra_fields(self):
        runner = CliRunner()
        with (
            patch("babel_explorer.cli.BabelDownloader"),
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
        ):
            mock_bx.return_value.get_curie_ids.return_value = [self._id_record]
            result = runner.invoke(cli, ["ids", "A:1", "--format", "json"])

        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data[0]["curie"] == "A:1"
        assert data[0]["type"] == "gene"
        assert data[0]["label"] == "Alpha"
        assert "extra_fields" not in data[0]

    def test_ids_format_tsv_expands_extra_fields(self):
        runner = CliRunner()
        with (
            patch("babel_explorer.cli.BabelDownloader"),
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
        ):
            mock_bx.return_value.get_curie_ids.return_value = [self._id_record]
            result = runner.invoke(cli, ["ids", "A:1", "--format", "tsv"])

        assert result.exit_code == 0
        lines = result.output.splitlines()
        assert "type" in lines[0]
        assert "label" in lines[0]
        assert "gene" in lines[1]

    # -- test-concord structured formats --

    def test_test_concord_format_json_includes_query_curie(self):
        runner = CliRunner()
        with patch("babel_explorer.cli.NodeNorm") as mock_nn:
            mock_nn.return_value.get_clique_identifiers.return_value = [
                self._identifier
            ]
            result = runner.invoke(
                cli, ["test-concord", "MONDO:0004979", "--format", "json"]
            )

        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data[0]["query_curie"] == "MONDO:0004979"
        assert data[0]["curie"] == "MONDO:0004979"
        assert data[0]["label"] == "asthma"
        assert data[0]["biolink_type"] == ["biolink:Disease"]

    def test_test_concord_format_tsv(self):
        runner = CliRunner()
        with patch("babel_explorer.cli.NodeNorm") as mock_nn:
            mock_nn.return_value.get_clique_identifiers.return_value = [
                self._identifier
            ]
            result = runner.invoke(
                cli, ["test-concord", "MONDO:0004979", "--format", "tsv"]
            )

        assert result.exit_code == 0
        lines = result.output.splitlines()
        assert "query_curie" in lines[0]
        assert "MONDO:0004979" in lines[1]

    # -- format validation --

    def test_invalid_format_rejected_by_click(self):
        runner = CliRunner()
        with (
            patch("babel_explorer.cli.BabelDownloader"),
            patch("babel_explorer.cli.BabelXRefs"),
            patch("babel_explorer.cli.NodeNorm"),
        ):
            result = runner.invoke(cli, ["xrefs", "A:1", "--format", "xml"])

        assert result.exit_code != 0

    def test_text_format_rejected_by_click(self):
        """'text' was removed; it is no longer a valid choice."""
        runner = CliRunner()
        with (
            patch("babel_explorer.cli.BabelDownloader"),
            patch("babel_explorer.cli.BabelXRefs"),
            patch("babel_explorer.cli.NodeNorm"),
        ):
            result = runner.invoke(cli, ["xrefs", "A:1", "--format", "text"])

        assert result.exit_code != 0


class TestVersionChecking:
    """The Babel release behind --babel-url must match the one NodeNorm was built from."""

    @staticmethod
    def _run(args, babel_version="2026jul22", nodenorm_version="2026jul22", env=None):
        runner = CliRunner()
        with (
            patch("babel_explorer.cli.BabelDownloader") as mock_dl,
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
            patch("babel_explorer.cli.NodeNorm") as mock_nn,
        ):
            mock_dl.return_value.babel_version = babel_version
            mock_nn.return_value.get_babel_version.return_value = nodenorm_version
            mock_bx.return_value.get_curie_xrefs.return_value = []
            mock_bx.return_value.get_curie_ids.return_value = []
            result = runner.invoke(cli, args, env=env)
        return result, mock_dl, mock_nn

    def test_mismatch_fails(self):
        result, _, _ = self._run(
            ["xrefs", "A:1", "--labels"], nodenorm_version="2025sep1"
        )
        assert result.exit_code != 0
        assert "2025sep1" in result.output and "2026jul22" in result.output

    def test_mismatch_allowed_with_flag(self):
        result, _, _ = self._run(
            ["xrefs", "A:1", "--labels", "--allow-version-mismatch"],
            nodenorm_version="2025sep1",
        )
        assert result.exit_code == 0

    def test_mismatch_allowed_via_env(self):
        result, _, _ = self._run(
            ["xrefs", "A:1", "--labels"],
            nodenorm_version="2025sep1",
            env={"BABEL_ALLOW_VERSION_MISMATCH": "1"},
        )
        assert result.exit_code == 0

    def test_unknown_version_skips_check(self):
        """Nothing to compare means nothing to complain about."""
        result, _, _ = self._run(["xrefs", "A:1", "--labels"], babel_version=None)
        assert result.exit_code == 0

    def test_plain_xrefs_skips_check(self):
        """Plain xrefs builds a NodeNorm but never queries it, so skew is irrelevant."""
        result, _, mock_nn = self._run(["xrefs", "A:1"], nodenorm_version="2025sep1")
        assert result.exit_code == 0
        mock_nn.return_value.get_babel_version.assert_not_called()

    def test_ids_skips_check(self):
        """ids uses no NodeNorm at all."""
        result, _, mock_nn = self._run(["ids", "A:1"], nodenorm_version="2025sep1")
        assert result.exit_code == 0
        mock_nn.return_value.get_babel_version.assert_not_called()

    def test_cache_is_synced_to_the_babel_release(self):
        _, mock_dl, _ = self._run(["ids", "A:1"])
        mock_dl.return_value.sync_cache_version.assert_called_once()


class TestUrlConfiguration:
    """URLs come from the environment (and hence .env), overridable per-run."""

    @staticmethod
    def _invoke(args, env):
        runner = CliRunner()
        with (
            patch("babel_explorer.cli.BabelDownloader") as mock_dl,
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
            patch("babel_explorer.cli.NodeNorm") as mock_nn,
        ):
            mock_bx.return_value.get_curie_xrefs.return_value = []
            result = runner.invoke(cli, args, env=env)
        assert result.exit_code == 0, result.output
        return mock_dl, mock_nn

    def test_defaults_are_public(self):
        mock_dl, mock_nn = self._invoke(
            ["xrefs", "A:1"], env={"BABEL_URL": None, "NODENORM_URL": None}
        )
        assert mock_dl.call_args[0][0] == "https://stars.renci.org/var/babel/latest/"
        assert mock_nn.call_args[0][0] == "https://nodenormalization-sri.renci.org/"

    def test_env_overrides_defaults(self):
        mock_dl, mock_nn = self._invoke(
            ["xrefs", "A:1"],
            env={
                "BABEL_URL": "https://example.com/babel/",
                "BABEL_LOCAL_DIR": "/tmp/babel-cache",
                "NODENORM_URL": "https://example.com/nn/",
            },
        )
        assert mock_dl.call_args[0][0] == "https://example.com/babel/"
        assert mock_dl.call_args.kwargs["local_path"] == "/tmp/babel-cache"
        assert mock_nn.call_args[0][0] == "https://example.com/nn/"

    def test_flag_beats_env(self):
        mock_dl, _ = self._invoke(
            ["xrefs", "A:1", "--babel-url", "https://flag.example.com/"],
            env={"BABEL_URL": "https://env.example.com/"},
        )
        assert mock_dl.call_args[0][0] == "https://flag.example.com/"


class TestMissingBabelFileReporting:
    """A missing Parquet file should read as an error, not a traceback."""

    def test_reported_without_traceback(self):
        runner = CliRunner()
        message = (
            "This Babel release (2025dec11) does not publish duckdb/Concord.parquet."
        )
        with (
            patch("babel_explorer.cli.BabelDownloader"),
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
            patch("babel_explorer.cli.NodeNorm"),
        ):
            mock_bx.return_value.get_curie_xrefs.side_effect = MissingBabelFileError(
                message
            )
            result = runner.invoke(cli, ["xrefs", "A:1"])

        assert result.exit_code == 1
        assert message in result.output
        assert "Traceback" not in result.output
        assert isinstance(result.exception, SystemExit)

    def test_also_wrapped_for_ids(self):
        """The conversion lives on the group, so every command inherits it."""
        runner = CliRunner()
        with (
            patch("babel_explorer.cli.BabelDownloader"),
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
        ):
            mock_bx.return_value.get_curie_ids.side_effect = MissingBabelFileError(
                "nope"
            )
            result = runner.invoke(cli, ["ids", "A:1"])

        assert result.exit_code == 1
        assert "nope" in result.output
        assert "Traceback" not in result.output


class TestPathsFormatGuard:
    """--paths only has a renderer for the console format."""

    @pytest.mark.parametrize("fmt", ["json", "tsv", "csv"])
    def test_rejected_for_non_console_formats(self, fmt):
        runner = CliRunner()
        with (
            patch("babel_explorer.cli.BabelDownloader") as mock_dl,
            patch("babel_explorer.cli.BabelXRefs"),
            patch("babel_explorer.cli.NodeNorm"),
        ):
            result = runner.invoke(
                cli, ["xrefs", "A:1", "B:2", "--paths", "--format", fmt]
            )

        assert result.exit_code != 0
        assert "--paths is only supported with --format console" in result.output
        # Rejected before anything is downloaded.
        mock_dl.assert_not_called()

    def test_allowed_for_console(self):
        runner = CliRunner()
        with (
            patch("babel_explorer.cli.BabelDownloader") as mock_dl,
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
            patch("babel_explorer.cli.NodeNorm") as mock_nn,
        ):
            mock_dl.return_value.babel_version = "2026jul22"
            mock_nn.return_value.get_babel_version.return_value = "2026jul22"
            mock_bx.return_value.get_curie_xrefs.return_value = []
            result = runner.invoke(cli, ["xrefs", "A:1", "B:2", "--paths"])

        assert result.exit_code == 0


class TestIdsLabels:
    """`ids --labels` enriches records via NodeNorm."""

    @staticmethod
    def _run(args, babel_version="2026jul22", nodenorm_version="2026jul22"):
        runner = CliRunner()
        with (
            patch("babel_explorer.cli.BabelDownloader") as mock_dl,
            patch("babel_explorer.cli.BabelXRefs") as mock_bx,
            patch("babel_explorer.cli.NodeNorm") as mock_nn,
        ):
            mock_dl.return_value.babel_version = babel_version
            mock_nn.return_value.get_babel_version.return_value = nodenorm_version
            mock_bx.return_value.get_curie_ids.return_value = [
                IdentifierRecord(curie="MONDO:0004979", label="asthma")
            ]
            result = runner.invoke(cli, args)
        return result, mock_bx, mock_nn

    def test_labels_flag_is_passed_through(self):
        result, mock_bx, _ = self._run(["ids", "MONDO:0004979", "--labels"])
        assert result.exit_code == 0
        mock_bx.return_value.get_curie_ids.assert_called_once_with(
            ("MONDO:0004979",), label_curies=True
        )

    def test_label_rendered_in_double_quotes(self):
        result, _, _ = self._run(["ids", "MONDO:0004979", "--labels"])
        assert '"asthma"' in result.output

    def test_version_checked_only_with_labels(self):
        _, _, mock_nn = self._run(["ids", "MONDO:0004979"], nodenorm_version="2025sep1")
        mock_nn.return_value.get_babel_version.assert_not_called()

    def test_version_mismatch_fails_with_labels(self):
        result, _, _ = self._run(
            ["ids", "MONDO:0004979", "--labels"], nodenorm_version="2025sep1"
        )
        assert result.exit_code != 0
        assert "2025sep1" in result.output
