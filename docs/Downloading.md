# Downloading and caching Babel files

How `BabelDownloader` (`src/babel_explorer/core/downloader.py`) decides what to fetch, what to
reuse, and what to throw away. Every rule here records a specific failure that actually
happened; the comments in the source say the same things at the point of temptation. Read this
before changing anything in that file.

The failure these rules exist to prevent is always the same shape: a Parquet file that is
wrong but looks right. Whatever lands on disk gets stamped with the correct ETag, so a corrupt
or mixed-release file passes every later freshness check forever.

## Cache refresh across releases

The `.babel-version` marker records the release the server *resolved* to, not the one requested, so
`BABEL_VERSION=latest` and `BABEL_VERSION=2025dec11` share a cache while they name the same
release. That is deliberate — do not "fix" it into a spurious refresh.

`BABEL_LOCAL_DIR` holds **one Babel release at a time**, recorded in a `.babel-version` marker.
When the release changes, `BabelDownloader.sync_cache_version()` clears `last_checked` from the
`.meta` sidecars in `<local_dir>/duckdb/` — never the Parquet files — so the existing ETag path
re-checks each cached file and re-downloads only what actually changed. The stored ETag is kept
deliberately: deleting the sidecar outright skips the HEAD and forces an unconditional
multi-gigabyte re-download. Partial `.tmp` downloads *are* deleted, so no prefix from the previous
release survives into the next one. This keeps `Concord.parquet` and `Identifiers.parquet` from
being read together across two different Babel releases.

`sync_cache_version()` does **not** write the new release to `.babel-version` itself. The marker
claims "the local cache holds this release", which is only true once every cached file has been
re-validated against it, so it is written by `_write_version_marker_if_synced()` after a download
instead — once no `.meta` sidecar in `duckdb/` is still missing its `last_checked`. Stamping it up
front would leave a run interrupted between `Concord.parquet` and `Identifiers.parquet` with a
marker naming the new release over a half-old cache, and the next run would see a marker that
matches and skip the refresh entirely. A cached file nobody asks for holds the marker back
indefinitely, costing one HEAD per run; that is correct, not a bug — the file really is still from
the previous release.

`--check-download never` (`freshness_seconds=inf`) suppresses re-checks *within* a release, not
across one. `_is_within_freshness()` tests for a missing `last_checked` **before** the `inf`
shortcut, so a sidecar the version change expired is never fresh. Reordering those two lines
re-opens the whole hole: `never` would hand back the previous release's Parquet with no network
call at all.

A `.tmp` is deleted in two places, on purpose. The delete in `get_downloaded_file()` is the safety
guarantee (see [Partial downloads](#partial-downloads)); the sweep in `sync_cache_version()` is
housekeeping that reclaims gigabytes belonging to a release nobody will ask for again, including
for files that are never re-downloaded and so never reach `get_downloaded_file()`. Dropping the
sweep only wastes disk; dropping the other reintroduces silent Parquet corruption.

If a HEAD request fails, `_remote_unchanged()` returns `None` — "could not check", distinct from
`True`/"confirmed unchanged". The cached file is still used, but `last_checked` is deliberately
**not** refreshed, so the next run checks again. Restamping it there would let one flaky HEAD pin
the previous release's Parquet as freshly validated for the whole freshness window, immediately
after `sync_cache_version()` cleared `last_checked` for a new release.

## Partial downloads

Downloads land in a sibling `.tmp` file and are promoted with `os.replace`. Three rules keep a
`.tmp` from becoming a corrupt Parquet that then passes every freshness check — a failure that is
permanent, because the file gets stamped with the *correct* ETag:

- **A `.tmp` is never resumed across runs.** `get_downloaded_file()` deletes any it finds before
  starting, and cleans up on `BaseException` so a Ctrl-C leaves nothing behind. Resume is by byte
  offset, the only way to reach the download at all is that the remote bytes *changed*, and an
  orphaned `.tmp` carries no record of which version its bytes came from. Restarting costs a
  re-download; splicing costs silent data corruption. Do not "optimise" this back into a
  cross-run resume without persisting the validator alongside the `.tmp`.
- **A resume requires a validator, and sends it as `If-Range`.** The validator is the ETag (else
  Last-Modified) of the response the bytes on disk were written from, so a file rebuilt
  mid-download restarts (HTTP 200) instead of splicing. A server that supplies neither leaves
  nothing to make the resume conditional on, so `_download_with_retry()` discards the partial file
  and restarts from zero rather than sending a bare `Range`. Do not relax that into "send `Range`,
  add `If-Range` when we happen to have one": the case with no validator is exactly the one where
  a splice cannot be detected afterwards.
- **Sizes are checked, twice.** A stream that ends short of `Content-Length` raises
  `IncompleteDownloadError` and is retried, rather than being promoted as complete; and an HTTP
  416 is only treated as "already complete" once the local size matches the remote
  `Content-Length`, since 416 also means the remote file *shrank* below the resume offset. A HEAD
  that reports no `Content-Length` at all is "cannot confirm", not "complete", and restarts too —
  which cannot loop, because the retry has nothing on disk and so sends no `Range`.

`_save_meta()` records the length of the whole file, taken from `Content-Range` rather than a 206
response's `Content-Length` (which is only the range's length). Storing the partial length would
make the Last-Modified fallback in `_remote_unchanged()` compare it against the full remote length
forever, re-downloading an unchanged multi-gigabyte file on every freshness expiry.

## Concurrent runs

Several processes can share one `BABEL_LOCAL_DIR`: two CLI runs at once, or every pytest-xdist
worker running the session fixtures. Unlocked, they each rewrite the same `.tmp` and race to
`os.replace` it, and the version-change sweep above deletes a `.tmp` that another process is still
writing. `BabelDownloader` takes two cross-process locks, always in this order:

- **`.babel-cache.lock`** in `BABEL_LOCAL_DIR`. `get_downloaded_file()` holds it *shared*.
  `sync_cache_version()` takes it *exclusive*, and only when the release has changed, so the sweep
  waits for every download in progress and no download starts while it runs. An unchanged release
  needs only the shared lock to read the marker, so it never waits.
- **`<file>.lock`** beside each cached file, held exclusive by `get_downloaded_file()`. One process
  downloads; the others log that they are waiting, then find the file cached.

Do not collapse these into one exclusive lock for the whole cache. It is simpler, but a run that
needs only an already-cached `Concord.parquet` would then wait out another run's multi-gigabyte
`Identifiers.parquet` download.

Both are kernel locks (`flock` on POSIX, `msvcrt.locking` on Windows), released when the process
exits however it exits, so there is no stale-lock cleanup to write. `msvcrt` has no shared mode,
so on Windows the shared lock is exclusive: still correct, only more serial. Two runs pointed at
*different* releases in one directory are still unsupported; the lock makes them take turns, and
each turn refreshes the cache for its own release.
