"""Output formatting for babel-explorer CLI commands.

Provides:
- write_records() for machine-readable output (json, tsv, csv)
- make_console(), hl_curie() and curie_with_label() for rich console output
"""

import csv
import dataclasses
import json
import sys
from typing import Any

from rich.console import Console
from rich.markup import escape


def record_to_dict(record) -> dict[str, Any]:
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
    # An absent label is omitted rather than emitted as "", matching the console
    # convention and keeping TSV/CSV columns stable when labels were not requested.
    # Keyed on the concept, not one field name: LabeledCrossReference spells it
    # subj_label/obj_label, and those must follow the same rule.
    for key in [k for k, v in d.items() if k.endswith("label") and not v]:
        del d[key]
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


# Styles indexed by BFS depth from the nearest query CURIE.
# Depth 0 = the query term itself; higher = further away.
_DEPTH_STYLES = [
    "bold cyan",  # 0: query CURIE
    "bold yellow",  # 1: one hop away
    "yellow",  # 2: two hops
    "green",  # 3: three hops
    "dim",  # 4+: further
]


def hl_curie(curie: str, depth: int | None) -> str:
    """Return rich markup for a CURIE colored by its BFS depth from the nearest query CURIE.

    Depth 0 is a query CURIE itself. Pass ``depth=None`` for CURIEs whose depth is
    unknown or irrelevant (rendered unstyled).
    """
    escaped = escape(curie)
    if depth is None:
        return escaped
    style = _DEPTH_STYLES[min(depth, len(_DEPTH_STYLES) - 1)]
    return f"[{style}]{escaped}[/{style}]"


def escape_label(label: str) -> str:
    """Escape a label for display inside double quotes: backslashes first, then quotes.

    Downstream tools can parse the result with the regex ``"([^"\\\\]|\\\\.)*"``.
    """
    return label.replace("\\", "\\\\").replace('"', '\\"')


def curie_with_label(curie: str, depth: int | None, label: str | None = None) -> str:
    """Render a CURIE as rich markup, followed by its label in double quotes.

    The sole implementation of the console label convention: the label sits
    immediately after the CURIE in double quotes, and is omitted entirely when
    absent rather than rendered as a placeholder.
    """
    markup = hl_curie(curie, depth)
    if label:
        markup += f' "{escape(escape_label(label))}"'
    return markup


def format_identifier_record(record) -> str:
    """Render an IdentifierRecord as a ``key=value`` line of rich markup.

    The label sits immediately after the CURIE in double quotes and is omitted
    entirely when absent, per the console convention.
    """
    parts = [f"curie={record.curie!r}"]
    if record.label:
        parts.append(f'label="{escape_label(record.label)}"')
    parts.extend(f"{name}={value!r}" for name, value in record.extra_fields)
    # Parquet values are arbitrary text; escape so they are not read as markup.
    return escape(f"IdentifierRecord({', '.join(parts)})")


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
        rows = [record_to_dict(r) for r in records]
        json.dump(rows, file, indent=indent, default=str)
        print(file=file)  # trailing newline

    elif fmt in ("tsv", "csv"):
        if not records:
            return
        rows = [_flatten_for_tabular(record_to_dict(r)) for r in records]
        # Union of keys, in first-seen order: records that omit an absent label have
        # fewer keys than their neighbours, and DictWriter rejects any key not declared.
        fieldnames = list(dict.fromkeys(k for row in rows for k in row))
        delimiter = "\t" if fmt == "tsv" else ","
        writer = csv.DictWriter(
            file,
            fieldnames=fieldnames,
            restval="",
            delimiter=delimiter,
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows(rows)

    else:
        raise ValueError(f"Unknown format: {fmt!r}")
