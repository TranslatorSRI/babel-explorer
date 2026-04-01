# Babel XRefs is a tool for accessing and querying the intermediate files
# that we make available with Babel builds. This allows you to find out
# why we consider two identifiers to be identical.
import dataclasses
import logging
import duckdb
import functools

from babel_explorer.core.downloader import BabelDownloader
from babel_explorer.core.nodenorm import NodeNorm


@dataclasses.dataclass(frozen=True)
class CrossReference:
    filename: str
    subj: str
    pred: str
    obj: str

    @staticmethod
    def from_tuple(tuple: tuple[str, str, str, str]):
        return CrossReference(
            filename=tuple[0], subj=tuple[1], pred=tuple[2], obj=tuple[3]
        )

    @property
    def curies(self):
        return frozenset([self.subj, self.obj])

    def __lt__(self, other):
        return (self.filename, self.subj, self.obj, self.pred) < (
            other.filename,
            other.subj,
            other.obj,
            other.pred,
        )


@dataclasses.dataclass(frozen=True)
class LabeledCrossReference(CrossReference):
    subj_label: str
    subj_biolink_type: list[str]
    obj_label: str
    obj_biolink_type: list[str]

    def __str__(self):
        return f"""LabeledCrossReference(subj="{self.subj}", pred="{self.pred}", obj="{self.obj}", subj_label="{self.subj_label}", subj_biolink_type="{self.subj_biolink_type}", obj_label="{self.obj_label}", obj_biolink_type="{self.obj_biolink_type}")"""


@dataclasses.dataclass(frozen=True)
class IdentifierRecord:
    """A record from the Identifiers.parquet file."""

    curie: str
    extra_fields: tuple = ()

    @staticmethod
    def from_row(row: tuple, column_names: list[str]):
        """Create an IdentifierRecord from a DuckDB result row and its column names."""
        curie_idx = column_names.index("curie")
        extra = tuple(
            (col, row[i]) for i, col in enumerate(column_names) if i != curie_idx
        )
        return IdentifierRecord(curie=row[curie_idx], extra_fields=extra)

    def __str__(self):
        parts = [f"curie={self.curie!r}"]
        for name, value in self.extra_fields:
            parts.append(f"{name}={value!r}")
        return f"IdentifierRecord({', '.join(parts)})"


class BabelXRefs:
    def __init__(self, downloader: BabelDownloader, nodenorm: NodeNorm = None):
        self.downloader = downloader
        self.nodenorm = nodenorm

    def get_curie_ids(self, curies: list[str]) -> list[IdentifierRecord]:
        """
        Search for all identifiers in the /ids/ files for a particular CURIE.

        :param curies: A list of CURIEs to search for.
        :return: A list of IdentifierRecords containing those CURIEs.
        """

        identifier_parquet = self.downloader.get_downloaded_file(
            "duckdb/Identifiers.parquet"
        )

        # Query the Parquet files using DuckDB (in-memory; nothing is persisted).
        with duckdb.connect() as db:
            identifier_table = db.read_parquet(identifier_parquet)  # noqa: F841 — DuckDB resolves 'identifier_table' by Python variable name in the SQL query
            result = db.execute(
                "SELECT * FROM identifier_table WHERE curie IN $1", [curies]
            )
            column_names = [desc[0] for desc in result.description]
            return [
                IdentifierRecord.from_row(row, column_names)
                for row in result.fetchall()
            ]

    @functools.lru_cache(maxsize=None)
    def get_curie_xref(self, curie: str, label_curies: bool = False):
        if label_curies and self.nodenorm is None:
            raise ValueError(
                "label_curies=True requires a configured NodeNorm instance (nodenorm was None)."
            )

        concord_parquet = self.downloader.get_downloaded_file("duckdb/Concord.parquet")

        with duckdb.connect() as db:
            concord_table = db.read_parquet(concord_parquet)  # noqa: F841 — DuckDB resolves 'concord_table' by Python variable name in the SQL query
            xref_tuples = db.execute(
                "SELECT filename, subj, pred, obj FROM concord_table WHERE subj=$1 OR obj=$1",
                [curie],
            ).fetchall()

        xrefs = [CrossReference.from_tuple(rec) for rec in xref_tuples]
        if label_curies:
            xrefs = [self._to_labeled_xref(xref) for xref in xrefs]
        return xrefs

    def _to_labeled_xref(self, xref: CrossReference) -> LabeledCrossReference:
        """Convert a CrossReference to a LabeledCrossReference using NodeNorm."""
        subj_ident = self.nodenorm.get_identifier(xref.subj)
        obj_ident = self.nodenorm.get_identifier(xref.obj)
        return LabeledCrossReference(
            subj=xref.subj,
            obj=xref.obj,
            filename=xref.filename,
            pred=xref.pred,
            subj_label=subj_ident.label,
            subj_biolink_type=subj_ident.biolink_type,
            obj_label=obj_ident.label,
            obj_biolink_type=obj_ident.biolink_type,
        )

    def _get_curie_xrefs_recursive(self, curies: list[str], label_curies: bool = False):
        """Traverse the cross-reference graph in one DuckDB WITH RECURSIVE query."""
        if label_curies and self.nodenorm is None:
            raise ValueError(
                "label_curies=True requires a configured NodeNorm instance (nodenorm was None)."
            )
        if not curies:
            return []

        concord_parquet = self.downloader.get_downloaded_file("duckdb/Concord.parquet")

        with duckdb.connect() as db:
            concord_table = db.read_parquet(concord_parquet)  # noqa: F841 — DuckDB resolves 'concord_table' by Python variable name in the SQL query
            rows = db.execute(
                """
            WITH RECURSIVE
            edges(a, b) AS (
                SELECT subj, obj FROM concord_table
                UNION ALL
                SELECT obj, subj FROM concord_table
            ),
            frontier(curie) AS (
                SELECT unnest($1::VARCHAR[])
                UNION
                SELECT e.b
                FROM   edges e
                INNER JOIN frontier f ON e.a = f.curie
            )
            SELECT DISTINCT c.filename, c.subj, c.pred, c.obj
            FROM concord_table c
            WHERE c.subj IN (SELECT curie FROM frontier)
               OR c.obj  IN (SELECT curie FROM frontier)
            ORDER BY c.filename, c.subj, c.obj, c.pred
        """,
                [curies],
            ).fetchall()

        xrefs = [CrossReference.from_tuple(row) for row in rows]

        if label_curies:
            xrefs = [self._to_labeled_xref(xref) for xref in xrefs]

        return xrefs

    def get_curie_xrefs(
        self, curies: list[str], recurse: bool = False, label_curies: bool = False
    ):
        """
        Search for all identifiers that are cross-referenced to the given CURIE.

        :param curies: A list of CURIEs to search for.
        :param recurse: Whether to expand the cross-references (i.e. recursively follow all identifiers).
        :param label_curies: Whether to annotate results with labels from NodeNorm.
        :return: A list of cross-references containing those CURIEs.
        """

        if recurse:
            return self._get_curie_xrefs_recursive(curies, label_curies)

        seen = set()
        xrefs = []
        for curie in curies:
            logging.info(f"Searching for cross-references for {curie}")
            for xref in self.get_curie_xref(curie, label_curies):
                key = (xref.filename, xref.subj, xref.pred, xref.obj)
                if key not in seen:
                    seen.add(key)
                    xrefs.append(xref)

        return sorted(xrefs)
