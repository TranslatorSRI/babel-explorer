"""
Tests for the BabelDownloader class.

These tests verify that the downloader can successfully fetch large Parquet files
from the Babel server using wget and properly manage local file caching.
"""

import os
import shutil
import pytest
from babel_xrefs.core.downloader import BabelDownloader


# Constants for test configuration
BABEL_URL = "https://stars.renci.org/var/babel/2025nov19/"
TEST_DATA_DIR = "data/test"
IDENTIFIERS_FILE = "duckdb/Identifiers.parquet"
MINIMUM_FILE_SIZE_GB = 2
MINIMUM_FILE_SIZE_BYTES = MINIMUM_FILE_SIZE_GB * 1024 * 1024 * 1024  # 2GB in bytes


@pytest.fixture(scope="module")
def test_data_dir():
    """
    Fixture that provides a clean test data directory.

    This fixture:
    - Creates the test data directory before tests run
    - Yields the directory path to tests
    - Cleans up (removes) the directory after all tests complete

    Scope is 'module' so the directory persists across all tests in this file,
    allowing downloaded files to be reused by multiple tests.
    """
    # Setup: ensure clean test directory
    if os.path.exists(TEST_DATA_DIR):
        shutil.rmtree(TEST_DATA_DIR)
    os.makedirs(TEST_DATA_DIR, exist_ok=True)

    yield TEST_DATA_DIR

    # Teardown: remove test directory and all contents
    if os.path.exists(TEST_DATA_DIR):
        shutil.rmtree(TEST_DATA_DIR)


@pytest.fixture(scope="module")
def downloader(test_data_dir):
    """
    Fixture that provides a BabelDownloader instance configured for testing.

    Args:
        test_data_dir: The test data directory fixture

    Returns:
        BabelDownloader: Configured downloader instance
    """
    return BabelDownloader(url_base=BABEL_URL, local_path=test_data_dir)


def test_downloader_initialization(test_data_dir):
    """
    Test that BabelDownloader initializes correctly with custom parameters.

    Verifies:
    - Downloader accepts URL and local path
    - Local path is stored correctly
    - Directory is created if it doesn't exist
    """
    downloader = BabelDownloader(url_base=BABEL_URL, local_path=test_data_dir)

    assert downloader.url_base == BABEL_URL
    assert downloader.local_path == test_data_dir
    assert os.path.exists(test_data_dir)
    assert os.path.isdir(test_data_dir)


def test_download_large_parquet_file(downloader):
    """
    Test downloading a large Parquet file from the Babel server.

    This test:
    1. Downloads the Identifiers.parquet file (2GB+) from the real Babel server
    2. Verifies the file was downloaded successfully
    3. Confirms the file size is at least 2GB

    Note: This test takes several minutes to complete due to the large file size.

    Args:
        downloader: BabelDownloader fixture
    """
    # Download the Identifiers.parquet file
    downloaded_path = downloader.get_downloaded_file(IDENTIFIERS_FILE)

    # Verify the file exists
    assert os.path.exists(downloaded_path), \
        f"Downloaded file does not exist at {downloaded_path}"

    # Verify it's a file, not a directory
    assert os.path.isfile(downloaded_path), \
        f"Downloaded path is not a file: {downloaded_path}"

    # Get the file size in bytes
    file_size_bytes = os.path.getsize(downloaded_path)
    file_size_gb = file_size_bytes / (1024 * 1024 * 1024)

    # Verify the file is at least 2GB
    assert file_size_bytes >= MINIMUM_FILE_SIZE_BYTES, \
        f"Downloaded file is too small: {file_size_gb:.2f}GB (expected at least {MINIMUM_FILE_SIZE_GB}GB)"

    print(f"\n✓ Successfully downloaded {IDENTIFIERS_FILE}")
    print(f"  Size: {file_size_gb:.2f}GB ({file_size_bytes:,} bytes)")
    print(f"  Path: {downloaded_path}")


def test_download_caching(downloader):
    """
    Test that the downloader uses LRU caching to avoid re-downloading files.

    This test:
    1. Downloads the same file twice
    2. Verifies both calls return the same path
    3. Confirms the file is only downloaded once (via caching)

    Args:
        downloader: BabelDownloader fixture
    """
    # First download
    path1 = downloader.get_downloaded_file(IDENTIFIERS_FILE)
    initial_mtime = os.path.getmtime(path1)

    # Second download - should use cache
    path2 = downloader.get_downloaded_file(IDENTIFIERS_FILE)
    second_mtime = os.path.getmtime(path2)

    # Verify same path returned
    assert path1 == path2, "Cached download returned different path"

    # Verify file wasn't modified (i.e., wasn't re-downloaded)
    assert initial_mtime == second_mtime, \
        "File was modified, suggesting it was re-downloaded instead of cached"

    print(f"\n✓ Caching works correctly - file not re-downloaded")


def test_get_output_file(downloader):
    """
    Test the get_output_file method for creating output file paths.

    This test:
    1. Creates an output file path
    2. Verifies the directory structure is created
    3. Confirms the path is in the correct location

    Args:
        downloader: BabelDownloader fixture
    """
    output_filename = "output/duckdbs/test.duckdb"
    output_path = downloader.get_output_file(output_filename)

    # Verify the path is correct
    expected_path = os.path.join(TEST_DATA_DIR, output_filename)
    assert output_path == expected_path, \
        f"Output path mismatch: expected {expected_path}, got {output_path}"

    # Verify the parent directory was created
    assert os.path.exists(os.path.dirname(output_path)), \
        "Parent directory for output file was not created"

    print(f"\n✓ Output file path created correctly: {output_path}")


def test_invalid_local_path():
    """
    Test that BabelDownloader raises an error for invalid local paths.

    This test verifies error handling when attempting to use a file path
    as the local directory (should be a directory, not a file).
    """
    # Create a temporary file
    invalid_path = "/tmp/test_babel_invalid_file.txt"
    with open(invalid_path, 'w') as f:
        f.write("test")

    try:
        # Attempt to create downloader with a file path instead of directory
        with pytest.raises(ValueError, match="Invalid local_path"):
            BabelDownloader(url_base=BABEL_URL, local_path=invalid_path)

        print("\n✓ Correctly raised ValueError for invalid local path")
    finally:
        # Clean up
        if os.path.exists(invalid_path):
            os.remove(invalid_path)
