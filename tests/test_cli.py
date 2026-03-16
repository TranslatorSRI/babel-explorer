"""
Tests for CLI helper functions.

Unit tests — no network required.
"""

import pytest
import click

from babel_explorer.cli import parse_duration


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
