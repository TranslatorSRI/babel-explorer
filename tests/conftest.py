"""
Shared fixtures for babel-explorer tests.

Session-scoped fixtures download Babel files once and share them across all test modules.
Teardown removes the test data directory so the next run starts fresh.
"""

import os
import shutil

import pytest
from filelock import FileLock

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
def test_data_dir(request):
    """
    Provide a test data directory for the entire session.

    Creates the directory before tests, removes it after all tests complete.
    When running under pytest-xdist, cleanup is skipped: worker sessions end at
    unpredictable times and deleting the shared directory from one worker while
    others are still reading the same files causes flaky IO errors.  The files
    are re-used (or re-validated) on the next run via the freshness-window logic
    in BabelDownloader.get_downloaded_file.
    """
    worker_id = getattr(request.config, "workerinput", {}).get("workerid", "master")
    os.makedirs(TEST_DATA_DIR, exist_ok=True)

    yield TEST_DATA_DIR

    # Only clean up when running without xdist (sequential run).  In a parallel
    # run each worker session may finish at a different time; gw0 cleaning up
    # while gw5 is still reading Concord.parquet causes spurious failures.
    if worker_id == "master":
        if os.path.exists(TEST_DATA_DIR):
            shutil.rmtree(TEST_DATA_DIR)


@pytest.fixture(scope="session")
def shared_downloader(test_data_dir) -> BabelDownloader:
    """A BabelDownloader pointed at the test data directory."""
    return BabelDownloader(url_base=BABEL_URL, local_path=test_data_dir)


@pytest.fixture(scope="session")
def downloaded_concord(shared_downloader, test_data_dir) -> str:
    """Download duckdb/Concord.parquet (~626 MB). Returns the local path."""
    lock_path = os.path.join(test_data_dir, "concord.lock")
    with FileLock(lock_path):
        return shared_downloader.get_downloaded_file(CONCORD_FILE)


@pytest.fixture(scope="session")
def downloaded_metadata(shared_downloader, test_data_dir) -> str:
    """Download duckdb/Metadata.parquet (small). Returns the local path."""
    lock_path = os.path.join(test_data_dir, "metadata.lock")
    with FileLock(lock_path):
        return shared_downloader.get_downloaded_file(METADATA_FILE)


@pytest.fixture(scope="session")
def downloaded_parquet_files(downloaded_concord, downloaded_metadata) -> dict[str, str]:
    """Dict of {relative_name: local_path} for Concord and Metadata files."""
    return {
        CONCORD_FILE: downloaded_concord,
        METADATA_FILE: downloaded_metadata,
    }


@pytest.fixture(scope="session")
def downloaded_identifiers(shared_downloader, test_data_dir) -> str:
    """Download duckdb/Identifiers.parquet (2 GB+). Returns the local path."""
    lock_path = os.path.join(test_data_dir, "identifiers.lock")
    with FileLock(lock_path):
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
