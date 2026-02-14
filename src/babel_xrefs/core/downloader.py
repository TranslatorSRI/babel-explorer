import functools
import os
import urllib.parse
import time
import requests
from tqdm import tqdm
import logging


class BabelDownloader:
    """
    Class for downloading Babel cross-reference files to a local directory as needed.
    """

    def __init__(self, url_base, local_path=None, retries=10):
        # We assume the URL base is correct (if not, we can fix it later).
        self.url_base = url_base
        self.retries = retries
        self.logger = logging.getLogger(BabelDownloader.__name__)

        if local_path is None:
            # Default to using TMPDIR.
            # TODO: replace with a real temporary directory.
            tmpdir = os.environ.get("TMPDIR")
            if tmpdir:
                local_path = tmpdir

        # Make sure the local path is an existing directory or that we can create it.
        if not os.path.exists(local_path):
            os.makedirs(local_path, exist_ok=True)
            self.local_path = local_path
        elif os.path.exists(local_path) and os.path.isdir(local_path):
            self.local_path = local_path
        else:
            raise ValueError(f"Invalid local_path (must be an existing directory): '{local_path}'")

    @functools.lru_cache(maxsize=None)
    def get_output_file(self, filename):
        filepath = os.path.join(self.local_path, filename)
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        return filepath

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
        content_length = response.headers.get('Content-Length')
        if content_length:
            total_size = int(content_length) + resume_byte_pos
        else:
            total_size = None

        # Open file in append mode if resuming, write mode otherwise
        mode = 'ab' if resume_byte_pos > 0 else 'wb'

        with open(local_path, mode) as f:
            with tqdm(
                total=total_size,
                initial=resume_byte_pos,
                unit='B',
                unit_scale=True,
                unit_divisor=1024,
                desc=os.path.basename(local_path)
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
                    headers['Range'] = f'bytes={resume_byte_pos}-'
                    self.logger.info(f"Resuming download from byte {resume_byte_pos}")

                # Make streaming request with timeout for connection (not total time)
                response = requests.get(url, headers=headers, stream=True, timeout=30)

                # Handle different response codes
                if response.status_code == 416:
                    # Range Not Satisfiable - file already complete
                    self.logger.info(f"File already complete: {local_path}")
                    return
                elif response.status_code == 206:
                    # Partial Content - resume successful
                    self.logger.info(f"Resuming download (HTTP 206)")
                elif response.status_code == 200:
                    # OK - server doesn't support resume or no Range header was sent
                    if resume_byte_pos > 0:
                        self.logger.warning(f"Server doesn't support resume, restarting from beginning")
                        resume_byte_pos = 0
                        # Remove partial file
                        if os.path.exists(local_path):
                            os.remove(local_path)
                else:
                    response.raise_for_status()

                # Stream download with progress bar
                self._stream_download(response, local_path, resume_byte_pos, chunk_size)

                # Success - exit retry loop
                return

            except (requests.RequestException, IOError) as e:
                self.logger.warning(f"Download attempt {attempt}/{self.retries} failed: {e}")

                if attempt < self.retries:
                    # Calculate exponential backoff with max of 60 seconds
                    wait_time = min(2 ** attempt, 60)
                    self.logger.info(f"Retrying in {wait_time} seconds...")
                    time.sleep(wait_time)
                else:
                    # All retries exhausted
                    raise RuntimeError(f"Failed to download {url} after {self.retries} attempts: {e}")

    @functools.lru_cache(maxsize=None)
    def get_downloaded_file(self, dirpath: str, chunk_size: int = 1024*1024):
        """
        Download a file from the Babel server to local storage.

        Args:
            dirpath: Relative path from url_base to the file
            chunk_size: Size of chunks to download (default 1MB)

        Returns:
            str: Local path to the downloaded file
        """
        local_path_to_download_to = os.path.join(self.local_path, dirpath)
        os.makedirs(os.path.dirname(local_path_to_download_to), exist_ok=True)

        url_to_download = urllib.parse.urljoin(self.url_base, dirpath)

        self.logger.info(f"Downloading {url_to_download} to {local_path_to_download_to}")

        # Download with retry logic
        self._download_with_retry(url_to_download, local_path_to_download_to, chunk_size)

        bytes_downloaded = os.path.getsize(local_path_to_download_to)
        self.logger.info(f"Downloaded {url_to_download} to {local_path_to_download_to}: {bytes_downloaded} bytes")
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
