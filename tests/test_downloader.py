"""
Tests for the BabelDownloader class.

Unit tests use mocks and run without network access.
Integration tests download real files from the Babel server.
"""

import hashlib
import os
import tempfile

import pytest
import requests
from unittest.mock import Mock, patch

from babel_explorer.core.downloader import BabelDownloader

from tests.constants import CONCORD_FILE


# ==========================================================================
# Unit Tests — no network required
# ==========================================================================


class TestBabelDownloaderInit:
    """Tests for BabelDownloader constructor."""

    def test_constructor_stores_url_and_path(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        assert dl.url_base == "https://example.com/"
        assert dl.local_path == str(tmp_path)

    def test_creates_directory_if_missing(self, tmp_path):
        new_dir = str(tmp_path / "nested" / "dir")
        dl = BabelDownloader(url_base="https://example.com/", local_path=new_dir)
        assert os.path.isdir(new_dir)
        assert dl.local_path == new_dir

    def test_custom_retries(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path), retries=3)
        assert dl.retries == 3

    def test_default_retries(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        assert dl.retries == 10

    def test_invalid_path_raises_value_error(self):
        """Using a file path (not a directory) should raise ValueError."""
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"not a directory")
            f.flush()
            try:
                with pytest.raises(ValueError, match="Invalid local_path"):
                    BabelDownloader(url_base="https://example.com/", local_path=f.name)
            finally:
                os.unlink(f.name)


class TestGetOutputFile:
    """Tests for get_output_file."""

    def test_returns_correct_path(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        result = dl.get_output_file("output/duckdbs/test.duckdb")
        assert result == os.path.join(str(tmp_path), "output/duckdbs/test.duckdb")

    def test_creates_parent_directories(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        result = dl.get_output_file("deep/nested/dir/file.txt")
        assert os.path.isdir(os.path.dirname(result))

    def test_lru_caching(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        result1 = dl.get_output_file("some/file.txt")
        result2 = dl.get_output_file("some/file.txt")
        assert result1 is result2  # identity check — same cached object


class TestCalculateMd5:
    """Tests for _calculate_md5."""

    def test_correct_hash(self, tmp_path):
        content = b"Hello, world!"
        expected = hashlib.md5(content).hexdigest()
        file_path = tmp_path / "test.bin"
        file_path.write_bytes(content)

        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        assert dl._calculate_md5(str(file_path)) == expected

    def test_different_chunk_sizes_same_result(self, tmp_path):
        content = b"A" * 5000
        expected = hashlib.md5(content).hexdigest()
        file_path = tmp_path / "chunks.bin"
        file_path.write_bytes(content)

        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        assert dl._calculate_md5(str(file_path), chunk_size=100) == expected
        assert dl._calculate_md5(str(file_path), chunk_size=4096) == expected


class TestFetchRemoteMd5:
    """Tests for _fetch_remote_md5."""

    def _make_dl(self, tmp_path):
        return BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))

    def test_valid_md5_response(self, tmp_path):
        dl = self._make_dl(tmp_path)
        mock_resp = Mock()
        mock_resp.status_code = 200
        mock_resp.text = "d41d8cd98f00b204e9800998ecf8427e  filename.parquet\n"
        mock_resp.raise_for_status = Mock()
        with patch("babel_explorer.core.downloader.requests.get", return_value=mock_resp):
            result = dl._fetch_remote_md5("https://example.com/file.md5")
        assert result == "d41d8cd98f00b204e9800998ecf8427e"

    def test_hash_only_format(self, tmp_path):
        dl = self._make_dl(tmp_path)
        mock_resp = Mock()
        mock_resp.status_code = 200
        mock_resp.text = "d41d8cd98f00b204e9800998ecf8427e\n"
        mock_resp.raise_for_status = Mock()
        with patch("babel_explorer.core.downloader.requests.get", return_value=mock_resp):
            result = dl._fetch_remote_md5("https://example.com/file.md5")
        assert result == "d41d8cd98f00b204e9800998ecf8427e"

    def test_404_returns_none(self, tmp_path):
        dl = self._make_dl(tmp_path)
        mock_resp = Mock()
        mock_resp.status_code = 404
        with patch("babel_explorer.core.downloader.requests.get", return_value=mock_resp):
            assert dl._fetch_remote_md5("https://example.com/missing.md5") is None

    def test_malformed_returns_none(self, tmp_path):
        dl = self._make_dl(tmp_path)
        mock_resp = Mock()
        mock_resp.status_code = 200
        mock_resp.text = "not-a-valid-md5-hash\n"
        mock_resp.raise_for_status = Mock()
        with patch("babel_explorer.core.downloader.requests.get", return_value=mock_resp):
            assert dl._fetch_remote_md5("https://example.com/bad.md5") is None

    def test_network_error_returns_none(self, tmp_path):
        dl = self._make_dl(tmp_path)
        with patch("babel_explorer.core.downloader.requests.get", side_effect=requests.ConnectionError("fail")):
            assert dl._fetch_remote_md5("https://example.com/err.md5") is None


class TestMd5ValidationFlow:
    """Tests for the MD5 validation logic inside get_downloaded_file."""

    def test_matching_checksum_skips_download(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        test_file = "test.txt"
        content = b"test content"
        local_path = tmp_path / test_file
        local_path.write_bytes(content)
        expected_md5 = hashlib.md5(content).hexdigest()

        with patch.object(dl, '_fetch_remote_md5', return_value=expected_md5):
            with patch.object(dl, '_download_with_retry') as mock_dl:
                dl.get_downloaded_file.cache_clear()
                result = dl.get_downloaded_file(test_file)
                mock_dl.assert_not_called()
                assert result == str(local_path)

    def test_mismatched_checksum_triggers_redownload(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        test_file = "mismatch.txt"
        local_path = tmp_path / test_file
        local_path.write_bytes(b"wrong content")
        correct_content = b"correct content"
        expected_md5 = hashlib.md5(correct_content).hexdigest()

        def fake_download(url, path, chunk_size):
            with open(path, 'wb') as f:
                f.write(correct_content)

        with patch.object(dl, '_fetch_remote_md5', return_value=expected_md5):
            with patch.object(dl, '_download_with_retry', side_effect=fake_download):
                dl.get_downloaded_file.cache_clear()
                result = dl.get_downloaded_file(test_file)
                assert os.path.exists(result)
                with open(result, 'rb') as f:
                    assert f.read() == correct_content

    def test_no_md5_proceeds_normally(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        test_file = "no_md5.txt"
        content = b"downloaded content"

        def fake_download(url, path, chunk_size):
            with open(path, 'wb') as f:
                f.write(content)

        with patch.object(dl, '_fetch_remote_md5', return_value=None):
            with patch.object(dl, '_download_with_retry', side_effect=fake_download) as mock_dl:
                dl.get_downloaded_file.cache_clear()
                result = dl.get_downloaded_file(test_file)
                mock_dl.assert_called_once()
                assert os.path.exists(result)

    def test_post_download_validation_fail_raises(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        test_file = "post_fail.txt"
        correct_md5 = hashlib.md5(b"expected").hexdigest()

        def fake_download(url, path, chunk_size):
            with open(path, 'wb') as f:
                f.write(b"wrong data after download")

        with patch.object(dl, '_fetch_remote_md5', return_value=correct_md5):
            with patch.object(dl, '_download_with_retry', side_effect=fake_download):
                dl.get_downloaded_file.cache_clear()
                with pytest.raises(RuntimeError, match="incorrect MD5 checksum"):
                    dl.get_downloaded_file(test_file)

    def test_post_download_validation_pass(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        test_file = "post_pass.txt"
        content = b"correct content"
        expected_md5 = hashlib.md5(content).hexdigest()

        def fake_download(url, path, chunk_size):
            with open(path, 'wb') as f:
                f.write(content)

        with patch.object(dl, '_fetch_remote_md5', return_value=expected_md5):
            with patch.object(dl, '_download_with_retry', side_effect=fake_download):
                dl.get_downloaded_file.cache_clear()
                result = dl.get_downloaded_file(test_file)
                assert os.path.exists(result)


class TestDownloadWithRetry:
    """Tests for _download_with_retry."""

    def test_retries_exhausted_raises_runtime_error(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path), retries=2)
        with patch("babel_explorer.core.downloader.requests.get", side_effect=requests.ConnectionError("fail")):
            with patch("babel_explorer.core.downloader.time.sleep"):  # skip waiting
                with pytest.raises(RuntimeError, match="Failed to download"):
                    dl._download_with_retry("https://example.com/file", str(tmp_path / "f"), 1024)

    def test_succeeds_on_second_attempt(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path), retries=3)
        out_path = str(tmp_path / "retry_success.bin")

        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.headers = {'Content-Length': '5'}
        mock_response.iter_content = Mock(return_value=[b"hello"])

        side_effects = [requests.ConnectionError("first fail"), mock_response]

        with patch("babel_explorer.core.downloader.requests.get", side_effect=side_effects):
            with patch("babel_explorer.core.downloader.time.sleep"):
                dl._download_with_retry("https://example.com/file", out_path, 1024)
        assert os.path.exists(out_path)

    def test_resume_sends_range_header(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        out_path = tmp_path / "partial.bin"
        out_path.write_bytes(b"partial")  # 7 bytes

        mock_response = Mock()
        mock_response.status_code = 206
        mock_response.headers = {'Content-Length': '3'}
        mock_response.iter_content = Mock(return_value=[b"end"])

        with patch("babel_explorer.core.downloader.requests.get", return_value=mock_response) as mock_get:
            dl._download_with_retry("https://example.com/file", str(out_path), 1024)
            _, kwargs = mock_get.call_args
            assert kwargs['headers'] == {'Range': 'bytes=7-'}

    def test_http_416_file_already_complete(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        out_path = tmp_path / "complete.bin"
        out_path.write_bytes(b"full file")

        mock_response = Mock()
        mock_response.status_code = 416

        with patch("babel_explorer.core.downloader.requests.get", return_value=mock_response):
            dl._download_with_retry("https://example.com/file", str(out_path), 1024)
        # Should return without error
        assert out_path.read_bytes() == b"full file"

    def test_server_no_resume_restarts_download(self, tmp_path):
        """When server responds 200 (instead of 206), partial file is removed and download restarts."""
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        out_path = tmp_path / "no_resume.bin"
        out_path.write_bytes(b"partial")

        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.headers = {'Content-Length': '12'}
        mock_response.iter_content = Mock(return_value=[b"full content"])

        with patch("babel_explorer.core.downloader.requests.get", return_value=mock_response):
            dl._download_with_retry("https://example.com/file", str(out_path), 1024)
        assert out_path.read_bytes() == b"full content"


class TestStreamDownload:
    """Tests for _stream_download."""

    def test_writes_chunks(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        out_path = str(tmp_path / "stream.bin")

        mock_response = Mock()
        mock_response.headers = {'Content-Length': '10'}
        mock_response.iter_content = Mock(return_value=[b"hello", b"world"])

        dl._stream_download(mock_response, out_path, resume_byte_pos=0, chunk_size=1024)
        with open(out_path, 'rb') as f:
            assert f.read() == b"helloworld"

    def test_append_mode_on_resume(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        out_path = tmp_path / "append.bin"
        out_path.write_bytes(b"start")

        mock_response = Mock()
        mock_response.headers = {'Content-Length': '3'}
        mock_response.iter_content = Mock(return_value=[b"end"])

        dl._stream_download(mock_response, str(out_path), resume_byte_pos=5, chunk_size=1024)
        assert out_path.read_bytes() == b"startend"


class TestGetDownloadedFileCaching:
    """Tests for get_downloaded_file LRU caching."""

    def test_cache_returns_same_result(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        content = b"cached content"

        def fake_download(url, path, chunk_size):
            with open(path, 'wb') as f:
                f.write(content)

        with patch.object(dl, '_fetch_remote_md5', return_value=None):
            with patch.object(dl, '_download_with_retry', side_effect=fake_download) as mock_dl:
                dl.get_downloaded_file.cache_clear()
                r1 = dl.get_downloaded_file("cached.txt")
                r2 = dl.get_downloaded_file("cached.txt")
                assert r1 == r2
                mock_dl.assert_called_once()  # only one actual download


class TestGetDownloadedDir:
    """Tests for get_downloaded_dir."""

    def test_raises_not_implemented(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        dl.get_downloaded_dir.cache_clear()
        with pytest.raises(NotImplementedError):
            dl.get_downloaded_dir("some/dir")


# ==========================================================================
# Integration Tests — require network access
# ==========================================================================


@pytest.mark.integration
def test_download_concord_parquet(downloaded_concord):
    """Verify Concord.parquet downloads and is > 100 MB."""
    assert os.path.isfile(downloaded_concord)
    size = os.path.getsize(downloaded_concord)
    assert size > 100 * 1024 * 1024, f"Concord.parquet too small: {size} bytes"


@pytest.mark.integration
def test_download_metadata_parquet(downloaded_metadata):
    """Verify Metadata.parquet downloads and is non-empty."""
    assert os.path.isfile(downloaded_metadata)
    assert os.path.getsize(downloaded_metadata) > 0


@pytest.mark.integration
def test_download_caching_real_files(shared_downloader, downloaded_concord):
    """Second call returns same path and file is not re-downloaded."""
    path2 = shared_downloader.get_downloaded_file(CONCORD_FILE)
    assert path2 == downloaded_concord
    assert os.path.getmtime(downloaded_concord) == os.path.getmtime(path2)


@pytest.mark.integration
@pytest.mark.slow
def test_download_identifiers_parquet(downloaded_identifiers):
    """Verify Identifiers.parquet downloads and is > 2 GB."""
    assert os.path.isfile(downloaded_identifiers)
    size = os.path.getsize(downloaded_identifiers)
    assert size > 2 * 1024 * 1024 * 1024, f"Identifiers.parquet too small: {size} bytes"
