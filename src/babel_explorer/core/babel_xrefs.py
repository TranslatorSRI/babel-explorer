"""Query engine for Babel cross-reference intermediate files.

Provides access to Concord.parquet and Identifiers.parquet via DuckDB,
allowing callers to discover why two biological/chemical identifiers are
considered identical in a Babel build.
"""

import dataclasses
import logging
from collections import deque
import duckdb

from babel_explorer.core.downloader import BabelDownloader
from babel_explorer.core.nodenorm import NodeNorm


@dataclasses.dataclass(frozen=True)
class CrossReference:
    """A single cross-reference edge read from Concord.parquet."""

    filename: str
    subj: str
    pred: str
    obj: str

    @staticmethod
    def from_tuple(row: tuple[str, str, str, str]):
        """Construct from a ``(filename, subj, pred, obj)`` database row tuple."""
        return CrossReference(filename=row[0], subj=row[1], pred=row[2], obj=row[3])

    @property
    def curies(self):
        """The frozenset of both CURIEs in this edge (subject and object)."""
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
    """A CrossReference enriched with human-readable labels and Biolink types from NodeNorm."""

    subj_label: str
    subj_biolink_type: tuple[str, ...]
    obj_label: str
    obj_biolink_type: tuple[str, ...]


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
        """Return a ``key=value`` string of the CURIE and all extra fields."""
        parts = [f"curie={self.curie!r}"]
        for name, value in self.extra_fields:
            parts.append(f"{name}={value!r}")
        return f"IdentifierRecord({', '.join(parts)})"


def build_depth_map(query_curies: list[str], xrefs: list) -> dict[str, int]:
    """BFS from query_curies over xref edges; returns {curie: depth_from_nearest_query}."""
    adj: dict[str, list[str]] = {}
    for xref in xrefs:
        adj.setdefault(xref.subj, []).append(xref.obj)
        adj.setdefault(xref.obj, []).append(xref.subj)

    depths: dict[str, int] = {c: 0 for c in query_curies}
    frontier = list(query_curies)
    while frontier:
        next_frontier = []
        for node in frontier:
            for neighbor in adj.get(node, []):
                if neighbor not in depths:
                    depths[neighbor] = depths[node] + 1
                    next_frontier.append(neighbor)
        frontier = next_frontier
    return depths


def find_shortest_path(
    from_curie: str, to_curie: str, xrefs: list
) -> list | None:
    """Return the shortest list of CrossReference edges from from_curie to to_curie.

    Returns ``[]`` if from_curie == to_curie, or ``None`` if no path exists.
    The returned edges may be stored in either direction; callers should check
    ``edge.subj`` / ``edge.obj`` against the expected traversal direction.
    """
    if from_curie == to_curie:
        return []

    adj: dict[str, list] = {}
    for xref in xrefs:
        adj.setdefault(xref.subj, []).append((xref.obj, xref))
        adj.setdefault(xref.obj, []).append((xref.subj, xref))

    visited = {from_curie}
    queue: deque = deque([(from_curie, [])])
    while queue:
        current, path = queue.popleft()
        for neighbor, xref in adj.get(current, []):
            if neighbor == to_curie:
                return path + [xref]
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append((neighbor, path + [xref]))
    return None


class BabelXRefs:
    """Query engine for Babel cross-reference and identifier Parquet files.

    Uses DuckDB for in-memory SQL queries against Concord.parquet and
    Identifiers.parquet. NodeNorm is optional and only required when
    ``label_curies=True`` is passed to enrichment-aware methods.
    """

    def __init__(self, downloader: BabelDownloader, nodenorm: NodeNorm = None):
        """
        :param downloader: A configured ``BabelDownloader`` that provides local paths
            to the required Parquet files, downloading them on first access.
        :param nodenorm: Optional ``NodeNorm`` client. Required only when callers pass
            ``label_curies=True``; may be ``None`` for label-free queries.
        """
        self.downloader = downloader
        self.nodenorm = nodenorm
        self._xref_cache: dict = {}

    def _require_nodenorm(self):
        if self.nodenorm is None:
            raise ValueError(
                "label_curies=True requires a configured NodeNorm instance (nodenorm was None)."
            )

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
            result = db.execute(
                "SELECT * FROM read_parquet($1) WHERE curie IN (SELECT unnest($2::VARCHAR[]))",
                [identifier_parquet, list(curies)],
            )
            column_names = [desc[0] for desc in result.description]
            return [
                IdentifierRecord.from_row(row, column_names)
                for row in result.fetchall()
            ]

    def get_curie_xref(self, curie: str, label_curies: bool = False):
        """Return all cross-references in Concord.parquet where *curie* is the subject or object.

        Results are cached per ``(curie, label_curies)`` pair on this instance.

        :param curie: The CURIE to look up.
        :param label_curies: If ``True``, annotate each result with NodeNorm labels and
            Biolink types. Requires a NodeNorm instance to have been passed to ``__init__``.
        :raises ValueError: If ``label_curies=True`` but no NodeNorm instance is available.
        :return: A list of ``CrossReference`` (or ``LabeledCrossReference``) objects.
        """
        cache_key = (curie, label_curies)
        if cache_key in self._xref_cache:
            return self._xref_cache[cache_key]

        if label_curies:
            self._require_nodenorm()

        concord_parquet = self.downloader.get_downloaded_file("duckdb/Concord.parquet")

        with duckdb.connect() as db:
            xref_tuples = db.execute(
                "SELECT filename, subj, pred, obj FROM read_parquet($1) WHERE subj=$2 OR obj=$2",
                [concord_parquet, curie],
            ).fetchall()

        xrefs = [CrossReference.from_tuple(rec) for rec in xref_tuples]
        if label_curies:
            xrefs = [self._to_labeled_xref(xref) for xref in xrefs]
        self._xref_cache[cache_key] = xrefs
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
        if label_curies:
            self._require_nodenorm()
        if not curies:
            return []

        concord_parquet = self.downloader.get_downloaded_file("duckdb/Concord.parquet")

        with duckdb.connect() as db:
            rows = db.execute(
                """
            WITH RECURSIVE
            concord AS MATERIALIZED (
                SELECT filename, subj, pred, obj FROM read_parquet($1)
            ),
            edges(a, b) AS (
                SELECT subj, obj FROM concord
                UNION ALL
                SELECT obj, subj FROM concord
            ),
            frontier(curie) AS (
                SELECT unnest($2::VARCHAR[])
                UNION
                SELECT e.b
                FROM   edges e
                INNER JOIN frontier f ON e.a = f.curie
            )
            SELECT DISTINCT c.filename, c.subj, c.pred, c.obj
            FROM concord c
            WHERE c.subj IN (SELECT curie FROM frontier)
               OR c.obj  IN (SELECT curie FROM frontier)
            ORDER BY c.filename, c.subj, c.obj, c.pred
        """,
                [concord_parquet, curies],
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

        xrefs = set()
        for curie in curies:
            logging.info(f"Searching for cross-references for {curie}")
            xrefs.update(self.get_curie_xref(curie, label_curies))

        return sorted(xrefs)
