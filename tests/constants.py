"""Shared constants for babel-explorer tests."""

import os
import pathlib

from dotenv import load_dotenv

from babel_explorer.core.downloader import compose_babel_url

# Integration tests run against whatever BABEL_RELEASES_URL and BABEL_VERSION compose to,
# so a Translator developer with a .env exercises them while public contributors and CI
# fall back to the public release (which does not yet publish the DuckDB Parquet files,
# so those tests skip).
load_dotenv()

BABEL_RELEASES_URL = os.environ.get(
    "BABEL_RELEASES_URL", "https://stars.renci.org/var/babel/"
)
BABEL_VERSION = os.environ.get("BABEL_VERSION", "latest")

# Composed exactly the way the CLI composes it, so tests that join paths onto it directly
# agree with the downloader instead of quietly requesting ".../latestduckdb/".
BABEL_URL = compose_babel_url(BABEL_RELEASES_URL, BABEL_VERSION)
NODENORM_URL = os.environ.get(
    "NODENORM_URL", "https://nodenormalization-sri.renci.org/"
)
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
