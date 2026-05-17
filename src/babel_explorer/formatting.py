"""Output formatting for babel-explorer CLI commands.

Provides:
- write_records() for machine-readable output (json, tsv, csv)
- make_console() and hl_curie() for rich console output
"""

import csv
import dataclasses
import json
import sys
from typing import Any

from rich.console import Console
from rich.markup import escape


def _record_to_dict(record) -> dict[str, Any]:
    """Convert a dataclass (or plain dict) to a flat dict.

    Handles IdentifierRecord's extra_fields, which asdict() returns as a
    list of [col, val] pairs rather than a nested dict.
    """
    if isinstance(record, dict):
        return record
    d = dataclasses.asdict(record)
    if "extra_fields" in d:
        for col, val in d.pop("extra_fields"):
            d[col] = val
    return d


def _flatten_for_tabular(row: dict) -> dict:
    """Convert list/tuple fields to pipe-joined strings for TSV/CSV output."""
    return {
        k: "|".join(v) if isinstance(v, (list, tuple)) else v for k, v in row.items()
    }


def make_console(file=None) -> Console:
    """Create a rich Console with babel-explorer defaults.

    Auto-detects TTY and NO_COLOR; strips markup when output is piped.
    highlight=False prevents rich from auto-highlighting numbers and strings.
    """
    return Console(file=file, highlight=False)


def hl_curie(curie: str, highlight: bool) -> str:
    """Return rich markup for a CURIE — bold cyan if it is a query CURIE."""
    escaped = escape(curie)
    return f"[bold cyan]{escaped}[/bold cyan]" if highlight else escaped


def write_records(records, fmt: str, indent: int = 2, file=None):
    """Write an iterable of dataclass records (or dicts) in the requested format.

    :param records: Iterable of dataclass instances or plain dicts.
    :param fmt: One of "json", "tsv", "csv". (Console output is handled by
        make_console/hl_curie in the CLI layer.)
    :param indent: JSON indentation depth (ignored for other formats).
    :param file: Output file-like object; defaults to sys.stdout.
    :raises ValueError: If fmt is not a recognised format.
    """
    if file is None:
        file = sys.stdout
    records = list(records)

    if fmt == "json":
        rows = [_record_to_dict(r) for r in records]
        json.dump(rows, file, indent=indent, default=str)
        print(file=file)  # trailing newline

    elif fmt in ("tsv", "csv"):
        if not records:
            return
        rows = [_flatten_for_tabular(_record_to_dict(r)) for r in records]
        delimiter = "\t" if fmt == "tsv" else ","
        writer = csv.DictWriter(
            file,
            fieldnames=list(rows[0].keys()),
            delimiter=delimiter,
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows(rows)

    else:
        raise ValueError(f"Unknown format: {fmt!r}")
