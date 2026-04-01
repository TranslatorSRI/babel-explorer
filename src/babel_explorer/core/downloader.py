import functools
import json
import os
import tempfile
import urllib.parse
import time
import requests
from datetime import datetime, timezone
from tqdm import tqdm
import logging


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
        # We assume the URL base is correct (if not, we can fix it later).
        self.url_base = url_base
        self.retries = retries
        self.freshness_seconds = freshness_seconds
        self.timeout = timeout
        self.logger = logging.getLogger(BabelDownloader.__name__)

        if local_path is None:
            local_path = tempfile.gettempdir()

        # Make sure the local path is an existing directory or that we can create it.
        try:
            os.makedirs(local_path, exist_ok=True)
        except (FileExistsError, NotADirectoryError) as exc:
            raise ValueError(
                f"Invalid local_path (must be an existing directory): '{local_path}'"
            ) from exc
        if not os.path.isdir(local_path):
            raise ValueError(
                f"Invalid local_path (must be an existing directory): '{local_path}'"
            )
        self.local_path = local_path

    @functools.lru_cache(maxsize=None)
    def get_output_file(self, filename):
        filepath = os.path.join(self.local_path, filename)
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        return filepath

    def _get_meta_path(self, local_path):
        """Return the sidecar metadata file path for a given local file."""
        return local_path + ".meta"

    def _load_meta(self, local_path):
        """Load sidecar metadata JSON, or return None if not found/invalid."""
        meta_path = self._get_meta_path(local_path)
        if not os.path.exists(meta_path):
            return None
        try:
            with open(meta_path, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return None

    def _save_meta(self, local_path, headers, update_last_checked=True):
        """
        Write a sidecar .meta JSON file next to local_path.

        Args:
            local_path: Path to the downloaded file
            headers: Response headers dict (or requests.structures.CaseInsensitiveDict)
            update_last_checked: If True, set last_checked to now
        """
        meta = {}
        if "ETag" in headers:
            meta["etag"] = headers["ETag"]
        if "Last-Modified" in headers:
            meta["last_modified"] = headers["Last-Modified"]
        if "Content-Length" in headers:
            meta["content_length"] = int(headers["Content-Length"])
        if update_last_checked:
            meta["last_checked"] = datetime.now(timezone.utc).isoformat()

        meta_path = self._get_meta_path(local_path)
        with open(meta_path, "w") as f:
            json.dump(meta, f, indent=2)

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
            age = (datetime.now(timezone.utc) - last_checked).total_seconds()
            return age < freshness_seconds
        except (ValueError, TypeError):
            return False

    def _etag_matches(self, url, meta):
        """
        Do a HEAD request and check if the ETag (or Last-Modified + Content-Length)
        matches the stored metadata.

        Does not write to disk — the caller is responsible for updating last_checked
        when this returns True.

        Args:
            url: URL to HEAD
            meta: dict loaded from .meta file (may have etag, last_modified, content_length)

        Returns:
            bool: True if remote matches local meta (file is still current)
        """
        try:
            response = requests.head(url, timeout=self.timeout)
            response.raise_for_status()
        except requests.RequestException as e:
            self.logger.warning(
                f"HEAD request failed for {url}: {e}; assuming file is current"
            )
            return True

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
        """
        # Get total size from Content-Length header (may not be present)
        content_length = response.headers.get("Content-Length")
        if content_length:
            total_size = int(content_length) + resume_byte_pos
        else:
            total_size = None

        # Open file in append mode if resuming, write mode otherwise
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
        for attempt in range(1, self.retries + 1):
            try:
                # Check if we're resuming a partial download
                resume_byte_pos = 0
                if os.path.exists(local_path):
                    resume_byte_pos = os.path.getsize(local_path)

                # Prepare headers for resume
                headers = {}
                if resume_byte_pos > 0:
                    headers["Range"] = f"bytes={resume_byte_pos}-"
                    self.logger.info(f"Resuming download from byte {resume_byte_pos}")

                # Make streaming request with timeout for connection (not total time)
                with requests.get(
                    url, headers=headers, stream=True, timeout=self.timeout
                ) as response:
                    # Handle different response codes
                    if response.status_code == 416:
                        # Range Not Satisfiable - file already complete
                        self.logger.info(f"File already complete: {local_path}")
                        return response.headers
                    elif response.status_code == 206:
                        # Partial Content - resume successful
                        self.logger.info("Resuming download (HTTP 206)")
                    elif response.status_code == 200:
                        # OK - server doesn't support resume or no Range header was sent
                        if resume_byte_pos > 0:
                            self.logger.warning(
                                "Server doesn't support resume, restarting from beginning"
                            )
                            resume_byte_pos = 0
                            try:
                                os.remove(local_path)
                            except FileNotFoundError:
                                pass
                    else:
                        response.raise_for_status()

                    # Stream download with progress bar
                    self._stream_download(
                        response, local_path, resume_byte_pos, chunk_size
                    )

                    # Success - exit retry loop
                    return response.headers

            except (requests.RequestException, IOError) as e:
                self.logger.warning(
                    f"Download attempt {attempt}/{self.retries} failed: {e}"
                )

                if attempt < self.retries:
                    # Calculate exponential backoff with max of 60 seconds
                    wait_time = min(2**attempt, 60)
                    self.logger.info(f"Retrying in {wait_time} seconds...")
                    time.sleep(wait_time)
                else:
                    # All retries exhausted
                    raise RuntimeError(
                        f"Failed to download {url} after {self.retries} attempts: {e}"
                    )

    @functools.lru_cache(maxsize=None)
    def get_downloaded_file(self, dirpath: str, chunk_size: int = 1024 * 1024):
        """
        Download a file from the Babel server to local storage with ETag-based caching.

        Three-tier freshness logic:
        1. If .meta exists and last_checked is within freshness window → return immediately
        2. If .meta exists but stale → HEAD request to compare ETag; return if unchanged
        3. If ETag changed or no .meta → full re-download

        Args:
            dirpath: Relative path from url_base to the file
            chunk_size: Size of chunks to download (default 1MB)

        Returns:
            str: Local path to the downloaded file
        """
        local_path_to_download_to = os.path.join(self.local_path, dirpath)
        os.makedirs(os.path.dirname(local_path_to_download_to), exist_ok=True)

        url_to_download = urllib.parse.urljoin(self.url_base, dirpath)

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
                if self._etag_matches(url_to_download, meta):
                    # Update last_checked timestamp
                    meta["last_checked"] = datetime.now(timezone.utc).isoformat()
                    meta_path = self._get_meta_path(local_path_to_download_to)
                    with open(meta_path, "w") as f:
                        json.dump(meta, f, indent=2)
                    self.logger.info(
                        f"ETag matches, using existing file: {local_path_to_download_to}"
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
        try:
            response_headers = self._download_with_retry(
                url_to_download, tmp_path, chunk_size
            )
            os.replace(tmp_path, local_path_to_download_to)
        except Exception:
            try:
                os.remove(tmp_path)
            except FileNotFoundError:
                pass
            raise

        # Save sidecar metadata
        if response_headers is not None:
            self._save_meta(local_path_to_download_to, response_headers)

        bytes_downloaded = os.path.getsize(local_path_to_download_to)
        self.logger.info(
            f"Downloaded {url_to_download} to {local_path_to_download_to}: {bytes_downloaded} bytes"
        )
        return local_path_to_download_to

    @functools.lru_cache(maxsize=None)
    def get_downloaded_dir(self, dirpath: str):
        """
        Download a directory recursively.

        NOTE: This method is not implemented in the Python-based downloader.
        Use get_downloaded_file() for individual files instead.

        Raises:
            NotImplementedError: This method is not implemented
        """
        raise NotImplementedError(
            "Recursive directory downloads are not supported. "
            "Use get_downloaded_file() for individual files."
        )
