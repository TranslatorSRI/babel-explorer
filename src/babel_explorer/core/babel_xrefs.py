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
        return CrossReference(filename=tuple[0], subj=tuple[1], pred=tuple[2], obj=tuple[3])

    @property
    def curies(self):
        return frozenset([self.subj, self.obj])

    def __lt__(self, other):
        return (self.filename, self.subj, self.obj, self.pred) < (other.filename, other.subj, other.obj, other.pred)

class LabeledCrossReference(CrossReference):
    subj_label: str
    subj_biolink_type: str
    obj_label: str
    obj_biolink_type: str

    def __init__(self, subj: str, pred: str, obj: str, filename: str, subj_label: str, subj_biolink_type: str, obj_label: str, obj_biolink_type: str):
        super().__init__(subj=subj, obj=obj, filename=filename, pred=pred)
        self.subj_label = subj_label
        self.subj_biolink_type = subj_biolink_type
        self.obj_label = obj_label
        self.obj_biolink_type = obj_biolink_type

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
        curie_idx = column_names.index('curie')
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

        identifier_parquet = self.downloader.get_downloaded_file('duckdb/Identifiers.parquet')
        concord_metadata_parquet = self.downloader.get_downloaded_file('duckdb/Metadata.parquet')

        # Query the Parquet files using DuckDB.
        duckdb_path = self.downloader.get_output_file('output/duckdbs/xrefs.duckdb')
        db = duckdb.connect(duckdb_path)
        identifier_table = db.read_parquet(identifier_parquet)
        result = db.execute(f"SELECT * FROM identifier_table WHERE curie IN $1", [curies])

        column_names = [desc[0] for desc in result.description]
        return [IdentifierRecord.from_row(row, column_names) for row in result.fetchall()]

    @functools.lru_cache(maxsize=None)
    def get_curie_xref(self, curie: str, label_curies: bool = False):
        concord_parquet = self.downloader.get_downloaded_file('duckdb/Concord.parquet')
        concord_metadata_parquet = self.downloader.get_downloaded_file('duckdb/Metadata.parquet')

        duckdb_path = self.downloader.get_output_file('output/duckdbs/xrefs.duckdb')
        db = duckdb.connect(duckdb_path)
        concord_table = db.read_parquet(concord_parquet)
        xref_tuples = db.execute(f"SELECT filename, subj, pred, obj FROM concord_table WHERE subj=$1 OR obj=$1", [curie]).fetchall()
        xrefs = list(map(lambda rec: CrossReference.from_tuple(rec), xref_tuples))

        if label_curies:
            xrefs = map(lambda xref: LabeledCrossReference(
                subj=xref.subj,
                obj=xref.obj,
                filename=xref.filename,
                pred=xref.pred,
                subj_label=self.nodenorm.get_identifier(xref.subj).label,
                subj_biolink_type=self.nodenorm.get_identifier(xref.subj).biolink_type,
                obj_label=self.nodenorm.get_identifier(xref.obj).label,
                obj_biolink_type=self.nodenorm.get_identifier(xref.obj).biolink_type,
            ), xrefs)

        return xrefs

    def get_curie_xrefs(self, curies: list[str], recurse: bool = False, ignore_curies_in_expansion: set = set(), label_curies: bool = False):
        """
        Search for all identifiers that are cross-referenced to the given CURIE.

        :param curie: A CURIE to search for.
        :param recurse: Whether to expand the cross-references (i.e. recursively follow all identifiers).
        :return: A list of cross-references containing that CURIE.
        """

        if ignore_curies_in_expansion:
            logging.info(f"Ignoring {len(ignore_curies_in_expansion)}: {ignore_curies_in_expansion}")

        xrefs = set()
        for curie in curies:
            logging.info(f"Searching for cross-references for {curie}")
            xrefs.update(self.get_curie_xref(curie, label_curies))

        if recurse:
            # Get a unique set of referenced curies, not including the ones currently queried.
            new_curies = list(set([curie for xref in xrefs for curie in xref.curies]) - set(curies) - ignore_curies_in_expansion)
            if new_curies:
                logging.info(f"Expanding cross-references to {new_curies}")
                xrefs.update(self.get_curie_xrefs(new_curies, recurse=True, ignore_curies_in_expansion=ignore_curies_in_expansion | set(curies) | set(new_curies), label_curies=label_curies))

        return sorted(xrefs)
