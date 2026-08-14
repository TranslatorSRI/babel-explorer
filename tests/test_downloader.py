"""
Tests for the BabelDownloader class.

Unit tests use mocks and run without network access.
Integration tests download real files from the Babel server.
"""

import json
import os
import tempfile
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, Mock, patch

import pytest
import requests

from babel_explorer.core.downloader import (
    VERSION_MARKER,
    BabelDownloader,
    MissingBabelFileError,
    resolve_babel_version,
)
from tests.constants import CONCORD_FILE


def _version_response(text):
    """A mock requests response serving *text* as the body of VERSION.txt."""
    response = Mock()
    response.text = text
    response.raise_for_status = Mock()
    return response


class TestResolveBabelVersion:
    """Unit tests for resolve_babel_version()."""

    def test_reads_version_txt(self):
        with patch(
            "babel_explorer.core.downloader.requests.get",
            return_value=_version_response(
                "Babel 2026jul22\nhttps://github.com/NCATSTranslator/Babel\n"
            ),
        ) as mock_get:
            assert (
                resolve_babel_version("https://example.com/babel/latest/")
                == "2026jul22"
            )
        assert (
            mock_get.call_args[0][0] == "https://example.com/babel/latest/VERSION.txt"
        )

    def test_version_txt_wins_over_path_segment(self):
        """VERSION.txt is authoritative even when the URL names a version."""
        with patch(
            "babel_explorer.core.downloader.requests.get",
            return_value=_version_response("Babel 2026jul22\n"),
        ):
            assert (
                resolve_babel_version("https://example.com/babel/2025nov19/")
                == "2026jul22"
            )

    def test_falls_back_to_path_segment(self):
        """Trees predating VERSION.txt fall back to the final path segment."""
        with patch(
            "babel_explorer.core.downloader.requests.get",
            side_effect=requests.HTTPError("404"),
        ):
            assert (
                resolve_babel_version("https://example.com/babel/2025nov19/")
                == "2025nov19"
            )

    def test_unresolvable_latest_returns_none(self):
        """'latest' is not a version, so an unreachable VERSION.txt means unknown."""
        with patch(
            "babel_explorer.core.downloader.requests.get",
            side_effect=requests.ConnectionError("boom"),
        ):
            assert resolve_babel_version("https://example.com/babel/latest/") is None

    def test_unparseable_version_txt_falls_back(self):
        with patch(
            "babel_explorer.core.downloader.requests.get",
            return_value=_version_response("something else entirely"),
        ):
            assert (
                resolve_babel_version("https://example.com/babel/2025nov19/")
                == "2025nov19"
            )


class TestSyncCacheVersion:
    """Unit tests for BabelDownloader.sync_cache_version()."""

    @staticmethod
    def _downloader(tmp_path, version):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        dl.babel_version = version
        return dl

    @staticmethod
    def _seed_cache(tmp_path):
        """Create a cached parquet file with its .meta sidecar."""
        duckdb_dir = tmp_path / "duckdb"
        duckdb_dir.mkdir()
        parquet = duckdb_dir / "Concord.parquet"
        parquet.write_text("data")
        meta = duckdb_dir / "Concord.parquet.meta"
        meta.write_text("{}")
        return parquet, meta

    def test_writes_marker_when_absent(self, tmp_path):
        self._downloader(tmp_path, "2026jul22").sync_cache_version()
        assert (tmp_path / VERSION_MARKER).read_text().strip() == "2026jul22"

    def test_matching_version_keeps_meta(self, tmp_path):
        _, meta = self._seed_cache(tmp_path)
        (tmp_path / VERSION_MARKER).write_text("2026jul22\n")

        self._downloader(tmp_path, "2026jul22").sync_cache_version()

        assert meta.exists()

    def test_changed_version_removes_meta_but_keeps_parquet(self, tmp_path):
        parquet, meta = self._seed_cache(tmp_path)
        (tmp_path / VERSION_MARKER).write_text("2025nov19\n")

        self._downloader(tmp_path, "2026jul22").sync_cache_version()

        assert not meta.exists(), "stale .meta sidecar should be removed"
        assert parquet.exists(), "the Parquet file itself must never be deleted"
        assert (tmp_path / VERSION_MARKER).read_text().strip() == "2026jul22"

    def test_refresh_does_not_reach_into_sibling_directories(self, tmp_path):
        """local_path may hold other Babel releases; only our own duckdb/ is cleared."""
        self._seed_cache(tmp_path)
        sibling = tmp_path / "2025nov19" / "duckdb"
        sibling.mkdir(parents=True)
        sibling_meta = sibling / "Concord.parquet.meta"
        sibling_meta.write_text("{}")
        (tmp_path / VERSION_MARKER).write_text("2025nov19\n")

        self._downloader(tmp_path, "2026jul22").sync_cache_version()

        assert sibling_meta.exists(), (
            "a nested release directory must not be swept up in the refresh"
        )

    def test_unknown_version_leaves_cache_untouched(self, tmp_path):
        """An unresolvable version must not trigger a multi-gigabyte re-download."""
        _, meta = self._seed_cache(tmp_path)
        (tmp_path / VERSION_MARKER).write_text("2025nov19\n")

        self._downloader(tmp_path, None).sync_cache_version()

        assert meta.exists()
        assert (tmp_path / VERSION_MARKER).read_text().strip() == "2025nov19"


class TestMissingBabelFile:
    """A 404 should explain itself and not be retried."""

    def test_404_raises_immediately(self, tmp_path):
        dl = BabelDownloader(
            url_base="https://example.com/", local_path=str(tmp_path), retries=10
        )
        dl.babel_version = "2025dec11"

        response = MagicMock()
        response.status_code = 404
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)

        with patch(
            "babel_explorer.core.downloader.requests.get", return_value=response
        ) as mock_get:
            with pytest.raises(MissingBabelFileError, match="2025dec11"):
                dl.get_downloaded_file(CONCORD_FILE)

        assert mock_get.call_count == 1, "a 404 must not be retried"


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
        dl = BabelDownloader(
            url_base="https://example.com/", local_path=str(tmp_path), retries=3
        )
        assert dl.retries == 3

    def test_default_retries(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        assert dl.retries == 10

    def test_default_freshness_seconds(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        assert dl.freshness_seconds == 3 * 3600

    def test_custom_freshness_seconds(self, tmp_path):
        dl = BabelDownloader(
            url_base="https://example.com/",
            local_path=str(tmp_path),
            freshness_seconds=0,
        )
        assert dl.freshness_seconds == 0

    def test_url_base_trailing_slash_added(self, tmp_path):
        """url_base without trailing slash gets one appended automatically."""
        dl = BabelDownloader(
            url_base="https://example.com/path", local_path=str(tmp_path)
        )
        assert dl.url_base == "https://example.com/path/"

    def test_url_base_with_trailing_slash_unchanged(self, tmp_path):
        dl = BabelDownloader(
            url_base="https://example.com/path/", local_path=str(tmp_path)
        )
        assert dl.url_base == "https://example.com/path/"

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


class TestSaveMeta:
    """Tests for _save_meta."""

    def _make_dl(self, tmp_path):
        return BabelDownloader(
            url_base="https://example.com/", local_path=str(tmp_path)
        )

    def test_writes_all_fields(self, tmp_path):
        dl = self._make_dl(tmp_path)
        file_path = str(tmp_path / "test.parquet")
        # Create the file so the path is valid
        open(file_path, "wb").close()

        headers = {
            "ETag": '"abc123"',
            "Last-Modified": "Wed, 03 Dec 2025 15:54:19 GMT",
            "Content-Length": "12345",
        }
        dl._save_meta(file_path, headers)

        meta_path = file_path + ".meta"
        assert os.path.exists(meta_path)
        with open(meta_path) as f:
            meta = json.load(f)

        assert meta["etag"] == '"abc123"'
        assert meta["last_modified"] == "Wed, 03 Dec 2025 15:54:19 GMT"
        assert meta["content_length"] == 12345
        assert "last_checked" in meta

    def test_last_checked_is_recent_utc(self, tmp_path):
        dl = self._make_dl(tmp_path)
        file_path = str(tmp_path / "f.parquet")
        open(file_path, "wb").close()

        dl._save_meta(file_path, {"ETag": '"x"'})

        with open(file_path + ".meta") as f:
            meta = json.load(f)

        last_checked = datetime.fromisoformat(meta["last_checked"])
        age = (datetime.now(UTC) - last_checked).total_seconds()
        assert age < 5  # written less than 5 seconds ago

    def test_missing_headers_not_written(self, tmp_path):
        """Headers not present in the response should not appear in .meta."""
        dl = self._make_dl(tmp_path)
        file_path = str(tmp_path / "sparse.parquet")
        open(file_path, "wb").close()

        dl._save_meta(file_path, {})

        with open(file_path + ".meta") as f:
            meta = json.load(f)

        assert "etag" not in meta
        assert "last_modified" not in meta
        assert "content_length" not in meta
        assert "last_checked" in meta


class TestLoadMeta:
    """Tests for _load_meta."""

    def _make_dl(self, tmp_path):
        return BabelDownloader(
            url_base="https://example.com/", local_path=str(tmp_path)
        )

    def test_returns_none_if_no_meta_file(self, tmp_path):
        dl = self._make_dl(tmp_path)
        assert dl._load_meta(str(tmp_path / "nonexistent.parquet")) is None

    def test_returns_dict_for_valid_meta(self, tmp_path):
        dl = self._make_dl(tmp_path)
        file_path = str(tmp_path / "f.parquet")
        open(file_path, "wb").close()
        meta_data = {"etag": '"abc"', "last_checked": "2026-01-01T00:00:00+00:00"}
        with open(file_path + ".meta", "w") as f:
            json.dump(meta_data, f)

        result = dl._load_meta(file_path)
        assert result == meta_data

    def test_returns_none_for_corrupt_meta(self, tmp_path):
        dl = self._make_dl(tmp_path)
        file_path = str(tmp_path / "corrupt.parquet")
        open(file_path, "wb").close()
        with open(file_path + ".meta", "w") as f:
            f.write("not valid json {{{")

        assert dl._load_meta(file_path) is None


class TestIsWithinFreshness:
    """Tests for _is_within_freshness."""

    def _make_dl(self, tmp_path):
        return BabelDownloader(
            url_base="https://example.com/", local_path=str(tmp_path)
        )

    def test_returns_true_when_recent(self, tmp_path):
        dl = self._make_dl(tmp_path)
        recent = datetime.now(UTC).isoformat()
        meta = {"last_checked": recent}
        assert dl._is_within_freshness(meta, 3600) is True

    def test_returns_false_when_stale(self, tmp_path):
        dl = self._make_dl(tmp_path)
        old = (datetime.now(UTC) - timedelta(hours=5)).isoformat()
        meta = {"last_checked": old}
        assert dl._is_within_freshness(meta, 3600) is False

    def test_returns_false_when_missing_last_checked(self, tmp_path):
        dl = self._make_dl(tmp_path)
        assert dl._is_within_freshness({}, 3600) is False

    def test_returns_true_when_freshness_is_inf(self, tmp_path):
        dl = self._make_dl(tmp_path)
        old = (datetime.now(UTC) - timedelta(days=365)).isoformat()
        meta = {"last_checked": old}
        assert dl._is_within_freshness(meta, float("inf")) is True

    def test_returns_false_when_freshness_is_zero(self, tmp_path):
        dl = self._make_dl(tmp_path)
        just_now = datetime.now(UTC).isoformat()
        meta = {"last_checked": just_now}
        # Even with freshness=0, age >= 0 so it's not < 0
        assert dl._is_within_freshness(meta, 0) is False


class TestEtagMatches:
    """Tests for _etag_matches."""

    def _make_dl(self, tmp_path):
        return BabelDownloader(
            url_base="https://example.com/", local_path=str(tmp_path)
        )

    def test_returns_true_on_matching_etag(self, tmp_path):
        dl = self._make_dl(tmp_path)
        meta = {"etag": '"abc123"'}
        mock_resp = Mock()
        mock_resp.headers = {"ETag": '"abc123"'}
        mock_resp.raise_for_status = Mock()
        with patch(
            "babel_explorer.core.downloader.requests.head", return_value=mock_resp
        ):
            assert dl._etag_matches("https://example.com/f.parquet", meta) is True

    def test_returns_false_on_different_etag(self, tmp_path):
        dl = self._make_dl(tmp_path)
        meta = {"etag": '"old"'}
        mock_resp = Mock()
        mock_resp.headers = {"ETag": '"new"'}
        mock_resp.raise_for_status = Mock()
        with patch(
            "babel_explorer.core.downloader.requests.head", return_value=mock_resp
        ):
            assert dl._etag_matches("https://example.com/f.parquet", meta) is False

    def test_fallback_last_modified_match(self, tmp_path):
        dl = self._make_dl(tmp_path)
        lm = "Wed, 03 Dec 2025 15:54:19 GMT"
        meta = {"last_modified": lm, "content_length": 100}
        mock_resp = Mock()
        mock_resp.headers = {"Last-Modified": lm, "Content-Length": "100"}
        mock_resp.raise_for_status = Mock()
        with patch(
            "babel_explorer.core.downloader.requests.head", return_value=mock_resp
        ):
            assert dl._etag_matches("https://example.com/f.parquet", meta) is True

    def test_returns_true_on_request_error(self, tmp_path):
        """Network errors are treated as 'assume still fresh' to avoid triggering large re-downloads."""
        dl = self._make_dl(tmp_path)
        meta = {"etag": '"abc"'}
        with patch(
            "babel_explorer.core.downloader.requests.head",
            side_effect=requests.ConnectionError("fail"),
        ):
            assert dl._etag_matches("https://example.com/f.parquet", meta) is True


class TestGetDownloadedFileTiers:
    """Tests for the three-tier logic in get_downloaded_file."""

    def _make_dl(self, tmp_path, freshness=3600):
        return BabelDownloader(
            url_base="https://example.com/",
            local_path=str(tmp_path),
            freshness_seconds=freshness,
        )

    # --- Tier 1: within freshness window ---

    def test_tier1_returns_immediately_no_http(self, tmp_path):
        """File + fresh .meta → no network calls at all."""
        dl = self._make_dl(tmp_path, freshness=3600)
        test_file = "duckdb/test.parquet"
        local = tmp_path / "duckdb" / "test.parquet"
        local.parent.mkdir(parents=True)
        local.write_bytes(b"data")

        meta = {"etag": '"abc"', "last_checked": datetime.now(UTC).isoformat()}
        with open(str(local) + ".meta", "w") as f:
            json.dump(meta, f)

        with patch("babel_explorer.core.downloader.requests.head") as mock_head:
            with patch("babel_explorer.core.downloader.requests.get") as mock_get:
                result = dl.get_downloaded_file(test_file)
                mock_head.assert_not_called()
                mock_get.assert_not_called()
        assert result == str(local)

    # --- Tier 2: stale .meta, ETag matches ---

    def test_tier2_head_check_no_redownload(self, tmp_path):
        """Stale .meta + matching ETag → HEAD only, no GET."""
        dl = self._make_dl(tmp_path, freshness=0)
        test_file = "duckdb/test.parquet"
        local = tmp_path / "duckdb" / "test.parquet"
        local.parent.mkdir(parents=True)
        local.write_bytes(b"data")

        old_ts = (datetime.now(UTC) - timedelta(hours=5)).isoformat()
        meta = {"etag": '"abc"', "last_checked": old_ts}
        with open(str(local) + ".meta", "w") as f:
            json.dump(meta, f)

        mock_head_resp = Mock()
        mock_head_resp.headers = {"ETag": '"abc"'}
        mock_head_resp.raise_for_status = Mock()

        with patch(
            "babel_explorer.core.downloader.requests.head", return_value=mock_head_resp
        ):
            with patch("babel_explorer.core.downloader.requests.get") as mock_get:
                result = dl.get_downloaded_file(test_file)
                mock_get.assert_not_called()
        assert result == str(local)

    def test_tier2_updates_last_checked_after_head(self, tmp_path):
        """After successful HEAD match, last_checked in .meta is updated."""
        dl = self._make_dl(tmp_path, freshness=0)
        test_file = "duckdb/upd.parquet"
        local = tmp_path / "duckdb" / "upd.parquet"
        local.parent.mkdir(parents=True)
        local.write_bytes(b"data")

        old_ts = (datetime.now(UTC) - timedelta(hours=5)).isoformat()
        meta = {"etag": '"abc"', "last_checked": old_ts}
        with open(str(local) + ".meta", "w") as f:
            json.dump(meta, f)

        mock_head_resp = Mock()
        mock_head_resp.headers = {"ETag": '"abc"'}
        mock_head_resp.raise_for_status = Mock()

        with patch(
            "babel_explorer.core.downloader.requests.head", return_value=mock_head_resp
        ):
            dl.get_downloaded_file(test_file)

        with open(str(local) + ".meta") as f:
            updated_meta = json.load(f)
        updated_ts = datetime.fromisoformat(updated_meta["last_checked"])
        assert (datetime.now(UTC) - updated_ts).total_seconds() < 5

    # --- Tier 3: ETag changed, re-download ---

    def test_tier3_redownloads_when_etag_changed(self, tmp_path):
        """Changed ETag → file deleted and re-downloaded."""
        dl = self._make_dl(tmp_path, freshness=0)
        test_file = "duckdb/changed.parquet"
        local = tmp_path / "duckdb" / "changed.parquet"
        local.parent.mkdir(parents=True)
        local.write_bytes(b"old data")

        old_ts = (datetime.now(UTC) - timedelta(hours=5)).isoformat()
        meta = {"etag": '"old"', "last_checked": old_ts}
        with open(str(local) + ".meta", "w") as f:
            json.dump(meta, f)

        mock_head_resp = Mock()
        mock_head_resp.headers = {"ETag": '"new"'}
        mock_head_resp.raise_for_status = Mock()

        new_content = b"new data"

        def fake_download(url, path, chunk_size):
            with open(path, "wb") as f:
                f.write(new_content)
            return {"ETag": '"new"', "Content-Length": str(len(new_content))}

        with patch(
            "babel_explorer.core.downloader.requests.head", return_value=mock_head_resp
        ):
            with patch.object(dl, "_download_with_retry", side_effect=fake_download):
                result = dl.get_downloaded_file(test_file)

        assert open(result, "rb").read() == new_content

    # --- No .meta: fresh download ---

    def test_downloads_when_no_meta(self, tmp_path):
        """No file and no .meta → download happens, .meta is saved."""
        dl = self._make_dl(tmp_path)
        test_file = "duckdb/new.parquet"
        content = b"fresh download"

        def fake_download(url, path, chunk_size):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(content)
            return {"ETag": '"fresh"', "Content-Length": str(len(content))}

        with patch.object(
            dl, "_download_with_retry", side_effect=fake_download
        ) as mock_dl:
            result = dl.get_downloaded_file(test_file)
            mock_dl.assert_called_once()

        assert os.path.exists(result)
        assert open(result, "rb").read() == content
        # .meta should be saved
        meta_path = result + ".meta"
        assert os.path.exists(meta_path)
        with open(meta_path) as f:
            saved_meta = json.load(f)
        assert saved_meta["etag"] == '"fresh"'

    def test_downloads_when_file_exists_but_no_meta(self, tmp_path):
        """File exists but no .meta → treats as unknown, triggers full download flow."""
        dl = self._make_dl(tmp_path, freshness=3600)
        test_file = "duckdb/nometa.parquet"
        local = tmp_path / "duckdb" / "nometa.parquet"
        local.parent.mkdir(parents=True)
        local.write_bytes(b"old content")
        # No .meta file

        new_content = b"refreshed"

        def fake_download(url, path, chunk_size):
            with open(path, "wb") as f:
                f.write(new_content)
            return {"ETag": '"new"'}

        with patch.object(
            dl, "_download_with_retry", side_effect=fake_download
        ) as mock_dl:
            result = dl.get_downloaded_file(test_file)
            mock_dl.assert_called_once()

        assert open(result, "rb").read() == new_content


class TestGetDownloadedFileCaching:
    """Tests that repeated calls within the freshness window avoid redundant downloads."""

    def test_second_call_within_freshness_skips_download(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        content = b"cached content"

        def fake_download(url, path, chunk_size):
            with open(path, "wb") as f:
                f.write(content)
            return {}

        with patch.object(
            dl, "_download_with_retry", side_effect=fake_download
        ) as mock_dl:
            r1 = dl.get_downloaded_file("cached.txt")
            r2 = dl.get_downloaded_file("cached.txt")
            assert r1 == r2
            mock_dl.assert_called_once()  # freshness window prevents second download


class TestDownloadWithRetry:
    """Tests for _download_with_retry."""

    @staticmethod
    def _make_response(status_code, headers=None, content=None):
        m = MagicMock()
        m.__enter__.return_value = m
        m.status_code = status_code
        m.headers = headers or {}
        if content is not None:
            m.iter_content = Mock(return_value=content)
        return m

    def test_retries_exhausted_raises_runtime_error(self, tmp_path):
        dl = BabelDownloader(
            url_base="https://example.com/", local_path=str(tmp_path), retries=2
        )
        with patch(
            "babel_explorer.core.downloader.requests.get",
            side_effect=requests.ConnectionError("fail"),
        ):
            with patch("babel_explorer.core.downloader.time.sleep"):  # skip waiting
                with pytest.raises(RuntimeError, match="Failed to download"):
                    dl._download_with_retry(
                        "https://example.com/file", str(tmp_path / "f"), 1024
                    )

    def test_succeeds_on_second_attempt(self, tmp_path):
        dl = BabelDownloader(
            url_base="https://example.com/", local_path=str(tmp_path), retries=3
        )
        out_path = str(tmp_path / "retry_success.bin")

        mock_response = self._make_response(200, {"Content-Length": "5"}, [b"hello"])
        side_effects = [requests.ConnectionError("first fail"), mock_response]

        with patch(
            "babel_explorer.core.downloader.requests.get", side_effect=side_effects
        ):
            with patch("babel_explorer.core.downloader.time.sleep"):
                dl._download_with_retry("https://example.com/file", out_path, 1024)
        assert os.path.exists(out_path)

    def test_resume_sends_range_header(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        out_path = tmp_path / "partial.bin"
        out_path.write_bytes(b"partial")  # 7 bytes

        mock_response = self._make_response(206, {"Content-Length": "3"}, [b"end"])
        with patch(
            "babel_explorer.core.downloader.requests.get", return_value=mock_response
        ) as mock_get:
            dl._download_with_retry("https://example.com/file", str(out_path), 1024)
            _, kwargs = mock_get.call_args
            assert kwargs["headers"] == {"Range": "bytes=7-"}

    def test_http_416_file_already_complete(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        out_path = tmp_path / "complete.bin"
        out_path.write_bytes(b"full file")

        mock_response = self._make_response(416)
        with patch(
            "babel_explorer.core.downloader.requests.get", return_value=mock_response
        ):
            dl._download_with_retry("https://example.com/file", str(out_path), 1024)
        # Should return without error
        assert out_path.read_bytes() == b"full file"

    def test_server_no_resume_restarts_download(self, tmp_path):
        """When server responds 200 (instead of 206), partial file is removed and download restarts."""
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        out_path = tmp_path / "no_resume.bin"
        out_path.write_bytes(b"partial")

        mock_response = self._make_response(
            200, {"Content-Length": "12"}, [b"full content"]
        )
        with patch(
            "babel_explorer.core.downloader.requests.get", return_value=mock_response
        ):
            dl._download_with_retry("https://example.com/file", str(out_path), 1024)
        assert out_path.read_bytes() == b"full content"

    def test_returns_response_headers(self, tmp_path):
        """_download_with_retry should return response headers."""
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        out_path = str(tmp_path / "headers.bin")

        mock_response = self._make_response(
            200, {"Content-Length": "5", "ETag": '"abc"'}, [b"hello"]
        )
        with patch(
            "babel_explorer.core.downloader.requests.get", return_value=mock_response
        ):
            headers = dl._download_with_retry(
                "https://example.com/file", out_path, 1024
            )
        assert headers["ETag"] == '"abc"'


class TestStreamDownload:
    """Tests for _stream_download."""

    def test_writes_chunks(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        out_path = str(tmp_path / "stream.bin")

        mock_response = Mock()
        mock_response.headers = {"Content-Length": "10"}
        mock_response.iter_content = Mock(return_value=[b"hello", b"world"])

        dl._stream_download(mock_response, out_path, resume_byte_pos=0, chunk_size=1024)
        with open(out_path, "rb") as f:
            assert f.read() == b"helloworld"

    def test_append_mode_on_resume(self, tmp_path):
        dl = BabelDownloader(url_base="https://example.com/", local_path=str(tmp_path))
        out_path = tmp_path / "append.bin"
        out_path.write_bytes(b"start")

        mock_response = Mock()
        mock_response.headers = {"Content-Length": "3"}
        mock_response.iter_content = Mock(return_value=[b"end"])

        dl._stream_download(
            mock_response, str(out_path), resume_byte_pos=5, chunk_size=1024
        )
        assert out_path.read_bytes() == b"startend"


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
def test_download_creates_meta_file(downloaded_concord):
    """After download, a .meta sidecar file should exist."""
    meta_path = downloaded_concord + ".meta"
    assert os.path.isfile(meta_path), f"Missing .meta file: {meta_path}"
    with open(meta_path) as f:
        meta = json.load(f)
    assert "last_checked" in meta


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
