"""
Shared fixtures for babel-explorer tests.

Session-scoped fixtures download Babel files once and share them across all test modules.
Teardown removes the test data directory so the next run starts fresh.
"""

import os
import shutil

import pytest

from babel_explorer.core.downloader import BabelDownloader
from babel_explorer.core.babel_xrefs import BabelXRefs
from babel_explorer.core.nodenorm import NodeNorm

from tests.constants import (
    BABEL_URL,
    NODENORM_URL,
    TEST_DATA_DIR,
    CONCORD_FILE,
    METADATA_FILE,
    IDENTIFIERS_FILE,
    load_curies,
)


# ---------------------------------------------------------------------------
# Session-scoped fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def valid_curies() -> list[str]:
    """Load test CURIEs from tests/data/valid_curies.txt."""
    curies = load_curies()
    assert len(curies) > 0, "No CURIEs found in valid_curies.txt"
    return curies


@pytest.fixture(scope="session")
def test_data_dir():
    """
    Provide a clean test data directory for the entire session.

    Creates the directory before tests, removes it after all tests complete.
    """
    if os.path.exists(TEST_DATA_DIR):
        shutil.rmtree(TEST_DATA_DIR)
    os.makedirs(TEST_DATA_DIR, exist_ok=True)

    yield TEST_DATA_DIR

    if os.path.exists(TEST_DATA_DIR):
        shutil.rmtree(TEST_DATA_DIR)


@pytest.fixture(scope="session")
def shared_downloader(test_data_dir) -> BabelDownloader:
    """A BabelDownloader pointed at the test data directory."""
    return BabelDownloader(url_base=BABEL_URL, local_path=test_data_dir)


@pytest.fixture(scope="session")
def downloaded_concord(shared_downloader) -> str:
    """Download duckdb/Concord.parquet (~626 MB). Returns the local path."""
    return shared_downloader.get_downloaded_file(CONCORD_FILE)


@pytest.fixture(scope="session")
def downloaded_metadata(shared_downloader) -> str:
    """Download duckdb/Metadata.parquet (small). Returns the local path."""
    return shared_downloader.get_downloaded_file(METADATA_FILE)


@pytest.fixture(scope="session")
def downloaded_parquet_files(downloaded_concord, downloaded_metadata) -> dict[str, str]:
    """Dict of {relative_name: local_path} for Concord and Metadata files."""
    return {
        CONCORD_FILE: downloaded_concord,
        METADATA_FILE: downloaded_metadata,
    }


@pytest.fixture(scope="session")
def downloaded_identifiers(shared_downloader) -> str:
    """Download duckdb/Identifiers.parquet (2 GB+). Returns the local path."""
    return shared_downloader.get_downloaded_file(IDENTIFIERS_FILE)


@pytest.fixture(scope="session")
def nodenorm() -> NodeNorm:
    """A NodeNorm client pointed at the public API."""
    return NodeNorm(nodenorm_url=NODENORM_URL)


@pytest.fixture(scope="session")
def babel_xrefs(shared_downloader, downloaded_parquet_files) -> BabelXRefs:
    """A BabelXRefs instance (no NodeNorm) with Concord + Metadata already downloaded."""
    return BabelXRefs(shared_downloader)


@pytest.fixture(scope="session")
def babel_xrefs_with_nodenorm(shared_downloader, nodenorm, downloaded_parquet_files) -> BabelXRefs:
    """A BabelXRefs instance with NodeNorm, Concord + Metadata already downloaded."""
    return BabelXRefs(shared_downloader, nodenorm)
