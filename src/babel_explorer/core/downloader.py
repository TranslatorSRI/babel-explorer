"""HTTP downloader for Babel Parquet files with ETag-based freshness checking."""

import functools
import glob
import json
import logging
import os
import re
import tempfile
import time
from datetime import UTC, datetime

import requests
from tqdm import tqdm

#: Name of the file recording which Babel release the local cache holds.
VERSION_MARKER = ".babel-version"


class MissingBabelFileError(RuntimeError):
    """Raised when a Babel release does not publish a file this tool needs."""


class IncompleteDownloadError(RuntimeError):
    """Raised when a download ends before the whole advertised file arrived.

    A stream that stops early without raising (a proxy or CDN closing the
    connection cleanly, say) would otherwise be promoted to the final path and
    stamped with the correct ETag, leaving a truncated Parquet that passes every
    later freshness check. Raising instead lets the retry loop resume it.
    """


def resolve_babel_version(url_base: str, timeout: int = 30) -> str | None:
    """
    Resolve the Babel version behind a Babel base URL.

    Reads ``VERSION.txt`` (present on all full Babel releases, e.g. ``Babel 2026jul22``),
    falling back to the final path segment for older trees that predate it.

    :return: The version string, or ``None`` if it cannot be determined.
    """
    try:
        response = requests.get(url_base + "VERSION.txt", timeout=timeout)
        response.raise_for_status()
        match = re.search(r"Babel\s+(\S+)", response.text)
        if match:
            return match.group(1)
    except requests.RequestException:
        pass

    # Legacy trees (e.g. the 2025nov19 development directory) have no VERSION.txt.
    segment = url_base.rstrip("/").rsplit("/", 1)[-1]
    return None if segment == "latest" else segment


class BabelDownloader:
    """
    Class for downloading Babel cross-reference files to a local directory as needed.
    """

    def __init__(
        self,
        url_base,
        local_path=None,
        retries=10,
        freshness_seconds=3 * 3600,
        timeout: int = 30,
    ):
        """
        :param url_base: Base URL of the Babel server (must end with ``/``).
        :param local_path: Directory for cached downloads. Defaults to
            ``tempfile.gettempdir()`` if ``None``; created automatically if it
            does not exist.
        :param retries: Maximum number of download retry attempts on failure.
        :param freshness_seconds: How long a local file is considered fresh without
            re-checking the server. Use ``float('inf')`` to never re-check, or ``0``
            to always issue a HEAD request. Defaults to 3 hours.
        :param timeout: HTTP request timeout in seconds.
        """
        if not url_base.endswith("/"):
            url_base += "/"
        self.url_base = url_base
        self.retries = retries
        self.freshness_seconds = freshness_seconds
        self.timeout = timeout
        self.logger = logging.getLogger(BabelDownloader.__name__)

        if local_path is None:
            local_path = tempfile.gettempdir()

        if not os.path.exists(local_path):
            os.makedirs(local_path, exist_ok=True)
            self.local_path = local_path
        elif os.path.isdir(local_path):
            self.local_path = local_path
        else:
            raise ValueError(
                f"Invalid local_path (must be an existing directory): '{local_path}'"
            )

    @functools.cached_property
    def babel_version(self) -> str | None:
        """The Babel release behind ``url_base``, resolved once and cached.

        ``cached_property`` caches a ``None`` result too, so a tree without a
        readable version is not re-fetched on every access.
        """
        return resolve_babel_version(self.url_base, self.timeout)

    def sync_cache_version(self):
        """
        Point the local cache at the Babel release behind ``url_base``.

        The cache holds one release at a time. When the release changes, ``last_checked``
        is cleared from every ``.meta`` sidecar so the existing ETag path re-checks each
        cached file on next use — whatever actually changed is re-downloaded, and files
        that are unchanged cost one HEAD instead of a fresh multi-gigabyte download. The
        ETag itself is deliberately kept: deleting the sidecar outright would skip the
        HEAD entirely and force an unconditional re-download of every file.

        Editing the sidecars rather than the Parquet files also means nothing large is
        destroyed if the version cannot be trusted, and an interrupted refresh self-heals:
        a ``.meta`` file is only written after a successful download.

        Partial ``.tmp`` downloads are removed, because they are resumed by byte offset
        and the bytes already on disk belong to the previous release. ``get_downloaded_file``
        also discards any ``.tmp`` it finds before starting a download, which covers the
        cases this sweep cannot see (a content change within one release, or a file that is
        never re-downloaded); clearing them here keeps stale gigabytes off disk as well.
        """
        version = self.babel_version
        if version is None:
            self.logger.warning(
                f"Could not determine the Babel version at {self.url_base}; "
                f"using cached files in {self.local_path} as-is"
            )
            return

        marker_path = os.path.join(self.local_path, VERSION_MARKER)
        try:
            with open(marker_path) as f:
                cached_version = f.read().strip()
        except OSError:
            cached_version = None

        if cached_version and cached_version != version:
            self.logger.warning(
                f"Babel version changed: {cached_version} → {version}; "
                f"refreshing cached files in {self.local_path}"
            )
            # Only ever touch files this downloader wrote. Not recursive: local_path
            # may be a directory the user pointed us at (or one holding other Babel
            # releases in sibling subdirectories), and must not be cleared wholesale.
            duckdb_dir = os.path.join(self.local_path, "duckdb")
            for meta_path in glob.glob(os.path.join(duckdb_dir, "*.meta")):
                meta = self._load_meta(meta_path.removesuffix(".meta"))
                if meta is None:
                    os.remove(meta_path)
                    continue
                meta.pop("last_checked", None)
                with open(meta_path, "w") as f:
                    json.dump(meta, f, indent=2)
            for tmp_path in glob.glob(os.path.join(duckdb_dir, "*.tmp")):
                os.remove(tmp_path)

        if cached_version != version:
            with open(marker_path, "w") as f:
                f.write(version + "\n")

    def _get_meta_path(self, local_path):
        """Return the sidecar metadata file path for a given local file."""
        return local_path + ".meta"

    def _load_meta(self, local_path):
        """Load sidecar metadata JSON, or return None if not found/invalid."""
        meta_path = self._get_meta_path(local_path)
        if not os.path.exists(meta_path):
            return None
        try:
            with open(meta_path) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return None

    def _write_meta(self, local_path, meta):
        """Write the sidecar .meta JSON file for local_path, stamping last_checked as now."""
        meta = meta | {"last_checked": datetime.now(UTC).isoformat()}
        with open(self._get_meta_path(local_path), "w") as f:
            json.dump(meta, f, indent=2)

    @staticmethod
    def _full_content_length(headers, local_path):
        """
        Return the length of the *whole* remote file, or None if it is not known.

        A partial (HTTP 206) response's ``Content-Length`` is the length of the
        returned range, not of the file. Recording that as the file's length would
        make the Last-Modified + Content-Length fallback in ``_remote_unchanged``
        compare a partial length against the full remote one forever, re-downloading
        a multi-gigabyte file on every freshness expiry. ``Content-Range`` carries
        the total (``bytes 100-999/1000``); when it is present but the total is
        unknown (``/*``), the file on disk is the better answer.
        """
        content_range = headers.get("Content-Range")
        if content_range:
            total = content_range.rsplit("/", 1)[-1].strip()
            if total.isdigit():
                return int(total)
            try:
                return os.path.getsize(local_path)
            except OSError:
                return None
        if "Content-Length" in headers:
            return int(headers["Content-Length"])
        return None

    def _save_meta(self, local_path, headers):
        """
        Write a sidecar .meta JSON file next to local_path from response headers.

        Args:
            local_path: Path to the downloaded file
            headers: Response headers dict (or requests.structures.CaseInsensitiveDict)
        """
        meta = {}
        if "ETag" in headers:
            meta["etag"] = headers["ETag"]
        if "Last-Modified" in headers:
            meta["last_modified"] = headers["Last-Modified"]
        content_length = self._full_content_length(headers, local_path)
        if content_length is not None:
            meta["content_length"] = content_length

        self._write_meta(local_path, meta)

    def _is_within_freshness(self, meta, freshness_seconds):
        """
        Return True if last_checked is within freshness_seconds of now.

        Args:
            meta: dict loaded from .meta file
            freshness_seconds: Number of seconds; float('inf') means always fresh

        Returns:
            bool
        """
        if freshness_seconds == float("inf"):
            return True
        last_checked_str = meta.get("last_checked")
        if not last_checked_str:
            return False
        try:
            last_checked = datetime.fromisoformat(last_checked_str)
            age = (datetime.now(UTC) - last_checked).total_seconds()
            return age < freshness_seconds
        except (ValueError, TypeError):
            return False

    def _remote_unchanged(self, url, meta):
        """
        Do a HEAD request and check if the ETag (or Last-Modified + Content-Length)
        matches the stored metadata.

        Does not write to disk — the caller is responsible for updating last_checked
        when this returns ``True``.

        Args:
            url: URL to HEAD
            meta: dict loaded from .meta file (may have etag, last_modified, content_length)

        Returns:
            True if the remote file is confirmed to match the local metadata,
            False if it is confirmed to have changed, and ``None`` if the check
            could not be made (the HEAD request failed). ``None`` is *not* the
            same as ``True``: the cached file is still usable, but the caller must
            not refresh ``last_checked`` on the strength of a check that never
            happened. Doing so would let one flaky HEAD pin the previous release's
            Parquet as "freshly validated" for the whole freshness window, right
            after ``sync_cache_version`` cleared ``last_checked`` for a new release
            — exactly the cross-release mixing the version marker exists to prevent.
        """
        try:
            response = requests.head(url, timeout=self.timeout)
            response.raise_for_status()
        except requests.RequestException as e:
            self.logger.warning(
                f"HEAD request failed for {url}: {e}; using the cached file, "
                f"but it will be re-checked on next use"
            )
            return None

        remote_headers = response.headers

        # Primary check: ETag
        local_etag = meta.get("etag")
        remote_etag = remote_headers.get("ETag")
        if local_etag and remote_etag:
            if local_etag == remote_etag:
                self.logger.info(f"ETag matches ({remote_etag}), file is current")
                return True
            else:
                self.logger.info(
                    f"ETag changed: {local_etag!r} → {remote_etag!r}, re-downloading"
                )
                return False

        # Fallback: Last-Modified + Content-Length
        local_lm = meta.get("last_modified")
        remote_lm = remote_headers.get("Last-Modified")
        local_cl = meta.get("content_length")
        remote_cl = remote_headers.get("Content-Length")

        if local_lm and remote_lm and local_lm == remote_lm:
            if local_cl is None or remote_cl is None or int(remote_cl) == local_cl:
                self.logger.info(
                    f"Last-Modified matches ({remote_lm}), file is current"
                )
                return True

        self.logger.info(
            "Cannot confirm file is current (no matching ETag or Last-Modified), will re-download"
        )
        return False

    def _stream_download(self, response, local_path, resume_byte_pos, chunk_size):
        """
        Stream download from response to file with progress bar.

        Args:
            response: requests.Response object with stream=True
            local_path: Local file path to write to
            resume_byte_pos: Starting byte position (for resume)
            chunk_size: Size of chunks to read/write

        Raises:
            IncompleteDownloadError: If fewer bytes arrived than Content-Length
                advertised.
        """
        content_length = response.headers.get("Content-Length")
        if content_length:
            total_size = int(content_length) + resume_byte_pos
        else:
            total_size = None

        mode = "ab" if resume_byte_pos > 0 else "wb"

        with open(local_path, mode) as f:
            with tqdm(
                total=total_size,
                initial=resume_byte_pos,
                unit="B",
                unit_scale=True,
                unit_divisor=1024,
                desc=os.path.basename(local_path),
            ) as progress_bar:
                for chunk in response.iter_content(chunk_size=chunk_size):
                    if chunk:
                        f.write(chunk)
                        progress_bar.update(len(chunk))

        # A stream can end early without raising. Comparing against Content-Length
        # is only meaningful for an identity-coded body: with Content-Encoding set,
        # iter_content hands back decoded bytes whose count is unrelated to it.
        if total_size is not None and not response.headers.get("Content-Encoding"):
            written = os.path.getsize(local_path)
            if written != total_size:
                raise IncompleteDownloadError(
                    f"{local_path}: expected {total_size} bytes, received {written}"
                )

    def _download_with_retry(self, url, local_path, chunk_size):
        """
        Download a file with retry logic and resume capability.

        Args:
            url: URL to download from
            local_path: Local file path to save to
            chunk_size: Size of chunks to read/write

        Returns:
            requests.structures.CaseInsensitiveDict: Response headers from the final request

        Raises:
            RuntimeError: If all retry attempts fail
        """
        # Validator (ETag, else Last-Modified) of the response we started writing
        # from. Sent back as If-Range on a resume so a file that changed mid-download
        # restarts from scratch instead of having the new version's tail appended to
        # the old version's prefix — a splice that would pass every later ETag check.
        # A leftover .tmp from an earlier run carries no validator and is never
        # resumed; get_downloaded_file removes it before we are called.
        validator = None

        for attempt in range(1, self.retries + 1):
            try:
                resume_byte_pos = 0
                if os.path.exists(local_path):
                    resume_byte_pos = os.path.getsize(local_path)

                headers = {}
                if resume_byte_pos > 0:
                    headers["Range"] = f"bytes={resume_byte_pos}-"
                    if validator:
                        headers["If-Range"] = validator
                    self.logger.info(f"Resuming download from byte {resume_byte_pos}")

                # timeout is per-read (seconds without receiving bytes), not a total time limit.
                with requests.get(
                    url, headers=headers, stream=True, timeout=self.timeout
                ) as response:
                    if response.status_code == 416:
                        # 416 also comes back when the remote file *shrank* below our
                        # resume offset, so "the range is past the end" does not by
                        # itself mean the local file is the remote one. Check the size
                        # before promoting it, or a rebuild that produced a smaller
                        # Parquet leaves an over-long file with valid-looking metadata.
                        head = requests.head(url, timeout=self.timeout)
                        head.raise_for_status()
                        remote_length = head.headers.get("Content-Length")
                        if (
                            remote_length is not None
                            and int(remote_length) != resume_byte_pos
                        ):
                            self.logger.warning(
                                f"Local file is {resume_byte_pos} bytes but the remote "
                                f"file is {remote_length}; discarding it and "
                                f"downloading afresh"
                            )
                            os.remove(local_path)
                            continue
                        self.logger.info(f"File already complete: {local_path}")
                        # The 416 headers describe the error body, not the file; saving
                        # them as this file's metadata would record a bogus
                        # content_length and force a full re-download on the next check.
                        return head.headers
                    elif response.status_code == 206:
                        self.logger.info("Resuming download (HTTP 206)")
                    elif response.status_code == 200:
                        if resume_byte_pos > 0:
                            self.logger.warning(
                                "Server doesn't support resume, restarting from beginning"
                            )
                            resume_byte_pos = 0
                            if os.path.exists(local_path):
                                os.remove(local_path)
                    elif response.status_code == 404:
                        # Not worth retrying, and worth explaining: public Babel releases
                        # do not currently publish the DuckDB Parquet files.
                        raise MissingBabelFileError(
                            f"This Babel release ({self.babel_version or self.url_base}) does not "
                            f"publish {url[len(self.url_base) :]}. Translator team members should "
                            f"contact the Babel developers for the Translator-specific URL and set "
                            f"BABEL_URL in .env."
                        )
                    else:
                        response.raise_for_status()

                    validator = response.headers.get("ETag") or response.headers.get(
                        "Last-Modified"
                    )
                    self._stream_download(
                        response, local_path, resume_byte_pos, chunk_size
                    )
                    return response.headers

            except (OSError, requests.RequestException, IncompleteDownloadError) as e:
                self.logger.warning(
                    f"Download attempt {attempt}/{self.retries} failed: {e}"
                )

                if attempt < self.retries:
                    wait_time = min(2**attempt, 60)
                    self.logger.info(f"Retrying in {wait_time} seconds...")
                    time.sleep(wait_time)
                else:
                    raise RuntimeError(
                        f"Failed to download {url} after {self.retries} attempts: {e}"
                    )

        # Only reachable if the last attempt was a 416 that restarted the download
        # (`continue`) with no attempts left. Falling through would return None and
        # leave the caller replacing a .tmp that is no longer there.
        raise RuntimeError(f"Failed to download {url} after {self.retries} attempts")

    def get_downloaded_file(self, dirpath: str, chunk_size: int = 1024 * 1024):
        """
        Download a file from the Babel server to local storage with ETag-based caching.

        Three-tier freshness logic:
        1. If .meta exists and last_checked is within freshness window → return immediately
        2. If .meta exists but stale → HEAD request to compare ETag; return if unchanged
           (or if the HEAD failed, in which case last_checked is left alone so the
           check is retried on next use)
        3. If ETag changed or no .meta → full re-download

        Args:
            dirpath: Relative path from url_base to the file
            chunk_size: Size of chunks to download (default 1MB)

        Returns:
            str: Local path to the downloaded file
        """
        local_path_to_download_to = os.path.join(self.local_path, dirpath)
        os.makedirs(os.path.dirname(local_path_to_download_to), exist_ok=True)

        url_to_download = self.url_base + dirpath

        if os.path.exists(local_path_to_download_to):
            meta = self._load_meta(local_path_to_download_to)
            if meta is not None:
                # Tier 1: within freshness window — skip all network calls
                if self._is_within_freshness(meta, self.freshness_seconds):
                    self.logger.info(
                        f"File within freshness window ({self.freshness_seconds} seconds), skipping check: {local_path_to_download_to}"
                    )
                    return local_path_to_download_to

                # Tier 2: stale but maybe unchanged — HEAD request
                unchanged = self._remote_unchanged(url_to_download, meta)
                if unchanged is True:
                    self._write_meta(local_path_to_download_to, meta)
                    self.logger.info(
                        f"ETag matches, using existing file: {local_path_to_download_to}"
                    )
                    return local_path_to_download_to
                if unchanged is None:
                    # Could not reach the server. Use the cached file, but leave
                    # last_checked stale so the next run checks again rather than
                    # treating an unverified file as fresh for hours.
                    self.logger.warning(
                        f"Could not check whether {url_to_download} changed; "
                        f"using the cached file: {local_path_to_download_to}"
                    )
                    return local_path_to_download_to

                # Tier 3: ETag changed — re-download
                self.logger.warning(
                    f"Remote file changed, re-downloading: {local_path_to_download_to}"
                )

        self.logger.info(
            f"Downloading {url_to_download} to {local_path_to_download_to}"
        )

        # Download to a sibling .tmp file, then atomically replace the final destination.
        # This ensures the final file is never partially written.
        tmp_path = local_path_to_download_to + ".tmp"

        # Discard any .tmp left behind by an earlier run (killed process, Ctrl-C).
        # _download_with_retry resumes by byte offset, and we have no way to tell
        # which version of the remote file those bytes came from — while the only
        # way to reach this point with a cached file present is that the remote
        # bytes *changed*. Resuming would splice the new file's tail onto the old
        # file's prefix and then stamp the result with the new ETag, making the
        # corruption permanent. Restarting costs a re-download; splicing costs
        # silent, undetectable data corruption.
        if os.path.exists(tmp_path):
            self.logger.warning(
                f"Discarding partial download from an earlier run: {tmp_path}"
            )
            os.remove(tmp_path)

        try:
            response_headers = self._download_with_retry(
                url_to_download, tmp_path, chunk_size
            )
            os.replace(tmp_path, local_path_to_download_to)
        except BaseException:
            # BaseException, not Exception: a Ctrl-C mid-download must clean up too,
            # since the partial file cannot be safely resumed later.
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            raise

        # Save sidecar metadata
        if response_headers is not None:
            self._save_meta(local_path_to_download_to, response_headers)

        bytes_downloaded = os.path.getsize(local_path_to_download_to)
        self.logger.info(
            f"Downloaded {url_to_download} to {local_path_to_download_to}: {bytes_downloaded} bytes"
        )
        return local_path_to_download_to
