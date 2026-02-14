"""
Tests for the BabelDownloader class.

These tests verify that the downloader can successfully fetch large Parquet files
from the Babel server and properly manage local file caching with MD5 validation.
"""

import os
import shutil
import hashlib
import pytest
from unittest.mock import Mock, patch, MagicMock
from babel_xrefs.core.downloader import BabelDownloader


# Constants for test configuration
BABEL_URL = "https://stars.renci.org/var/babel_outputs/2025nov19/"
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


def test_md5_validation_matching_checksum(test_data_dir):
    """
    Test that MD5 validation skips download when checksums match.

    This test:
    1. Creates a local file with known content
    2. Mocks the .md5 file to return the correct checksum
    3. Verifies the download is skipped (no actual HTTP download occurs)
    """
    downloader = BabelDownloader(url_base=BABEL_URL, local_path=test_data_dir)

    # Create a test file with known content
    test_file = "test_file.txt"
    local_path = os.path.join(test_data_dir, test_file)
    os.makedirs(os.path.dirname(local_path), exist_ok=True)

    test_content = b"This is test content for MD5 validation"
    with open(local_path, 'wb') as f:
        f.write(test_content)

    # Calculate the expected MD5
    expected_md5 = hashlib.md5(test_content).hexdigest()

    # Mock the _fetch_remote_md5 to return the matching checksum
    with patch.object(downloader, '_fetch_remote_md5', return_value=expected_md5):
        # Mock _download_with_retry to ensure it's NOT called
        with patch.object(downloader, '_download_with_retry') as mock_download:
            # Clear the cache before testing
            downloader.get_downloaded_file.cache_clear()

            result_path = downloader.get_downloaded_file(test_file)

            # Verify the download was skipped
            mock_download.assert_not_called()
            assert result_path == local_path
            assert os.path.exists(result_path)

    print(f"\n✓ MD5 validation correctly skipped download for matching checksum: {expected_md5}")


def test_md5_validation_mismatched_checksum(test_data_dir):
    """
    Test that MD5 validation deletes and re-downloads file when checksums don't match.

    This test:
    1. Creates a local file with wrong content
    2. Mocks the .md5 file to return a different checksum
    3. Verifies the file is deleted and re-downloaded
    """
    downloader = BabelDownloader(url_base=BABEL_URL, local_path=test_data_dir)

    # Create a test file with incorrect content
    test_file = "test_file_mismatch.txt"
    local_path = os.path.join(test_data_dir, test_file)
    os.makedirs(os.path.dirname(local_path), exist_ok=True)

    wrong_content = b"This is WRONG content"
    with open(local_path, 'wb') as f:
        f.write(wrong_content)

    # Use a different MD5 (this is MD5 of "correct content")
    correct_content = b"This is CORRECT content"
    expected_md5 = hashlib.md5(correct_content).hexdigest()

    # Track whether file was deleted
    original_exists = os.path.exists(local_path)

    # Mock the _fetch_remote_md5 to return the mismatched checksum
    with patch.object(downloader, '_fetch_remote_md5', return_value=expected_md5):
        # Mock _download_with_retry to create the "correct" file
        def mock_download(url, path, chunk_size):
            with open(path, 'wb') as f:
                f.write(correct_content)

        with patch.object(downloader, '_download_with_retry', side_effect=mock_download):
            # Clear the cache before testing
            downloader.get_downloaded_file.cache_clear()

            result_path = downloader.get_downloaded_file(test_file)

            # Verify the file exists and has correct content
            assert os.path.exists(result_path)
            with open(result_path, 'rb') as f:
                assert f.read() == correct_content

    print(f"\n✓ MD5 validation correctly deleted and re-downloaded file with mismatched checksum")


def test_md5_validation_no_md5_file(test_data_dir):
    """
    Test that download proceeds normally when no .md5 file exists.

    This test:
    1. Mocks the .md5 file fetch to return None (404)
    2. Verifies the download proceeds normally
    """
    downloader = BabelDownloader(url_base=BABEL_URL, local_path=test_data_dir)

    test_file = "test_file_no_md5.txt"
    local_path = os.path.join(test_data_dir, test_file)

    test_content = b"Test content without MD5 file"

    # Mock the _fetch_remote_md5 to return None (no .md5 file)
    with patch.object(downloader, '_fetch_remote_md5', return_value=None):
        # Mock _download_with_retry to create the file
        def mock_download(url, path, chunk_size):
            with open(path, 'wb') as f:
                f.write(test_content)

        with patch.object(downloader, '_download_with_retry', side_effect=mock_download) as mock_download_method:
            # Clear the cache before testing
            downloader.get_downloaded_file.cache_clear()

            result_path = downloader.get_downloaded_file(test_file)

            # Verify download was called (normal download path)
            mock_download_method.assert_called_once()
            assert os.path.exists(result_path)
            with open(result_path, 'rb') as f:
                assert f.read() == test_content

    print(f"\n✓ Download proceeded normally when no .md5 file exists")


def test_md5_validation_malformed_md5_file(test_data_dir):
    """
    Test that download proceeds normally when .md5 file is malformed.

    This test:
    1. Mocks the .md5 file fetch to return None (malformed content)
    2. Verifies the download proceeds normally with a warning
    """
    downloader = BabelDownloader(url_base=BABEL_URL, local_path=test_data_dir)

    test_file = "test_file_malformed_md5.txt"
    local_path = os.path.join(test_data_dir, test_file)

    test_content = b"Test content with malformed MD5 file"

    # Mock the _fetch_remote_md5 to return None (malformed .md5 file)
    with patch.object(downloader, '_fetch_remote_md5', return_value=None):
        # Mock _download_with_retry to create the file
        def mock_download(url, path, chunk_size):
            with open(path, 'wb') as f:
                f.write(test_content)

        with patch.object(downloader, '_download_with_retry', side_effect=mock_download) as mock_download_method:
            # Clear the cache before testing
            downloader.get_downloaded_file.cache_clear()

            result_path = downloader.get_downloaded_file(test_file)

            # Verify download was called (normal download path)
            mock_download_method.assert_called_once()
            assert os.path.exists(result_path)

    print(f"\n✓ Download proceeded normally when .md5 file is malformed")


def test_md5_post_download_validation(test_data_dir):
    """
    Test that MD5 validation occurs after download and fails if checksum is wrong.

    This test:
    1. Downloads a new file
    2. Mocks the .md5 file to return a checksum
    3. Mocks the download to create a file with WRONG content
    4. Verifies a RuntimeError is raised for checksum mismatch
    """
    downloader = BabelDownloader(url_base=BABEL_URL, local_path=test_data_dir)

    test_file = "test_file_post_validation.txt"
    local_path = os.path.join(test_data_dir, test_file)

    # Expected content and MD5
    correct_content = b"Expected content"
    expected_md5 = hashlib.md5(correct_content).hexdigest()

    # Wrong content that will be downloaded
    wrong_content = b"Wrong content downloaded"

    # Mock the _fetch_remote_md5 to return the expected checksum
    with patch.object(downloader, '_fetch_remote_md5', return_value=expected_md5):
        # Mock _download_with_retry to create a file with WRONG content
        def mock_download(url, path, chunk_size):
            with open(path, 'wb') as f:
                f.write(wrong_content)

        with patch.object(downloader, '_download_with_retry', side_effect=mock_download):
            # Clear the cache before testing
            downloader.get_downloaded_file.cache_clear()

            # Should raise RuntimeError due to post-download MD5 mismatch
            with pytest.raises(RuntimeError, match="incorrect MD5 checksum"):
                downloader.get_downloaded_file(test_file)

    print(f"\n✓ Post-download MD5 validation correctly detected checksum mismatch")
