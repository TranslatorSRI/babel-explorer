"""Output formatting for babel-explorer CLI commands.

Provides write_records() to render any list of dataclass records (or plain
dicts) as text, JSON, TSV, or CSV.
"""

import csv
import dataclasses
import json
import sys
from typing import Any


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
    return {k: "|".join(v) if isinstance(v, (list, tuple)) else v for k, v in row.items()}


def write_records(records, fmt: str, indent: int = 2, file=None):
    """Write an iterable of dataclass records (or dicts) in the requested format.

    :param records: Iterable of dataclass instances or plain dicts.
    :param fmt: One of "text", "json", "tsv", "csv".
    :param indent: JSON indentation depth (ignored for other formats).
    :param file: Output file-like object; defaults to sys.stdout.
    :raises ValueError: If fmt is not a recognised format.
    """
    if file is None:
        file = sys.stdout
    records = list(records)

    if fmt == "text":
        for r in records:
            print(r, file=file)

    elif fmt == "json":
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
