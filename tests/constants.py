"""Shared constants for babel-explorer tests."""

import pathlib

BABEL_URL = "https://stars.renci.org/var/babel/2025nov19/"
NODENORM_URL = "https://nodenormalization-sri.renci.org/"
TEST_DATA_DIR = "data/test"

# Parquet file paths (relative to the Babel server / local data dir)
CONCORD_FILE = "duckdb/Concord.parquet"
METADATA_FILE = "duckdb/Metadata.parquet"
IDENTIFIERS_FILE = "duckdb/Identifiers.parquet"

# Path to the valid CURIEs file
VALID_CURIES_PATH = pathlib.Path(__file__).parent / "data" / "valid_curies.txt"


def load_curies(path: pathlib.Path = VALID_CURIES_PATH) -> list[str]:
    """Read CURIEs from a text file, skipping comments and blank lines."""
    curies = []
    with open(path) as f:
        for line in f:
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                curies.append(stripped)
    return curies
