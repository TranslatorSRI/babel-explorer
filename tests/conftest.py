"""
Shared fixtures for babel-explorer tests.

Session-scoped fixtures download Babel files once and share them across all test modules.
Teardown removes the test data directory so the next run starts fresh.
"""

import os
import shutil

import pytest
import requests
from filelock import FileLock

from babel_explorer.core.babel_xrefs import BabelXRefs
from babel_explorer.core.downloader import BabelDownloader
from babel_explorer.core.nodenorm import NodeNorm
from tests.constants import (
    BABEL_URL,
    CONCORD_FILE,
    IDENTIFIERS_FILE,
    METADATA_FILE,
    NODENORM_URL,
    TEST_DATA_DIR,
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


def pytest_sessionfinish(session, exitstatus):
    """Remove the shared test data directory once every worker has finished.

    This runs in the xdist controller, which finishes only after all workers do.
    Workers are identified by having a ``workerinput`` attribute; a plain
    non-parallel run has none either, so cleanup happens there too.

    Cleaning up from a session fixture's teardown instead does not work: with
    ``-n auto`` in ``addopts`` every run is parallel, so each worker would tear
    down at an unpredictable time and gw0 could delete Concord.parquet while gw5
    is still reading it. Guarding that teardown on the worker id, as this used to,
    meant the directory was simply never removed.
    """
    if hasattr(session.config, "workerinput"):
        return
    if os.path.exists(TEST_DATA_DIR):
        shutil.rmtree(TEST_DATA_DIR, ignore_errors=True)


@pytest.fixture(scope="session")
def test_data_dir():
    """Provide a test data directory for the entire session.

    Removed by ``pytest_sessionfinish`` once all workers are done, so the next
    run starts fresh.
    """
    os.makedirs(TEST_DATA_DIR, exist_ok=True)
    return TEST_DATA_DIR


@pytest.fixture(scope="session")
def shared_downloader(test_data_dir) -> BabelDownloader:
    """A BabelDownloader pointed at the test data directory.

    Skips the whole session when BABEL_URL points at a Babel release that does not
    publish the DuckDB Parquet files (as the public releases currently do not).
    """
    probe_url = BABEL_URL + CONCORD_FILE
    try:
        response = requests.head(probe_url, timeout=30)
    except requests.RequestException as e:
        pytest.skip(f"Babel server unreachable at {probe_url}: {e}")
    if response.status_code == 404:
        pytest.skip(f"{BABEL_URL} does not publish {CONCORD_FILE}")
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
def babel_xrefs_with_nodenorm(
    shared_downloader, nodenorm, downloaded_parquet_files
) -> BabelXRefs:
    """A BabelXRefs instance with NodeNorm, Concord + Metadata already downloaded."""
    return BabelXRefs(shared_downloader, nodenorm)
