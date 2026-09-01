# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

babel-explorer is a tool for querying and exploring Babel intermediate files. It allows users to discover why two biological/chemical identifiers are considered identical by the Babel system, which handles cross-references between different ontology and database identifiers (e.g., MONDO, HP, UMLS, HGNC).

## Development Setup

This project uses **uv** for package management:

```bash
# Install dependencies
uv sync

# Install with dev dependencies
uv sync --group dev

# Configure the Babel and NodeNorm endpoints
cp env.default .env

# Run the CLI
uv run babel-explorer --help
```

## Configuration

`BABEL_RELEASES_URL`, `BABEL_VERSION`, `BABEL_LOCAL_DIR`, `BABEL_CHECK_DOWNLOAD`, `NODENORM_URL`, and
`BABEL_ALLOW_VERSION_MISMATCH` are read from `.env` (via `python-dotenv`, loaded in the `cli()`
group) or the environment. Each is also a command-line option, and precedence runs
**flag > environment variable > `.env` > built-in default**.

The release actually queried — the **effective Babel URL** — is
`BABEL_RELEASES_URL.rstrip("/") + "/" + BABEL_VERSION + "/"`, composed by `resolve_babel_url()`
(`cli.py`) on top of the pure `compose_babel_url()` (`core/downloader.py`). `compose_babel_url`
lives in the downloader rather than the CLI because `tests/constants.py` needs the same
composition and must not import Click to get it.

`--babel-url` overrides the composed pair with a complete URL, for a tree that does not follow the
releases-directory layout. It has **no `envvar=`, on purpose**: two variables already feed the
composed URL, and a third that silently outranked both would make "which release am I querying?"
unanswerable from the environment alone. Do not add one. `BABEL_URL` was the single pre-refactor
setting and is now inert; `cli()` warns if it is still set so it does not fail silently.

`env.default` ships with the **public** Babel URL only. Public Babel releases do not currently
publish the DuckDB Parquet files this tool needs, so Translator team members must contact the
Babel developers for the Translator-specific releases URL and set `BABEL_RELEASES_URL` to it.
Never commit that URL to this repository.

## Babel versions

The Babel version behind the effective Babel URL is resolved by `resolve_babel_version()`
(`core/downloader.py`), which reads `VERSION.txt` (`Babel 2026jul22`) and falls back to the final
path segment for older trees that predate it. `latest/` resolves to whatever release it currently
points at. That fallback segment is now exactly `BABEL_VERSION`, so a pinned release still
resolves when `VERSION.txt` is unreachable, while `latest` yields `None` as before.

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

`BabelExplorerGroup.invoke()` turns `requests.RequestException` into a `ClickException`, so an
unreachable NodeNorm reports an error rather than a traceback. In practice only NodeNorm reaches
it: the downloader handles its own network failures, while NodeNorm deliberately lets HTTP errors
propagate so a failed lookup is not cached. `get_babel_version()` swallows its own errors, so an
unreachable NodeNorm passes the version check below and only fails part-way through the query.

`xrefs` fails when NodeNorm's `status` endpoint reports a different `babel_version` than the Babel
being queried, since labels and cliques would not match the cross-references. Pass
`--allow-version-mismatch` to proceed anyway. The check is skipped when NodeNorm is not consulted
(`xrefs` without `--labels`, including `--recurse`, which is served entirely by DuckDB; and `ids`
without `--labels`) or when either version is unavailable.

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

## Commands

### Running the Application

```bash
# Get cross-references for one or more CURIEs
uv run babel-explorer xrefs MONDO:0004979

# Get cross-references with expansion (recursive lookup)
uv run babel-explorer xrefs MONDO:0004979 --recurse

# Get cross-references with labels from NodeNorm
uv run babel-explorer xrefs MONDO:0004979 --labels

# Get ID records for CURIEs
uv run babel-explorer ids MONDO:0004979

# Get ID records with labels from NodeNorm
uv run babel-explorer ids MONDO:0004979 --labels

# Test concordance changes with NodeNorm
uv run babel-explorer test-concord MONDO:0004979 HP:0000001

# Use a custom Babel server or local directory (overrides .env)
uv run babel-explorer xrefs MONDO:0004979 --local-dir data --babel-version 2025dec11

# Override the composed URL entirely (command line only; there is no BABEL_URL env var)
uv run babel-explorer xrefs MONDO:0004979 --babel-url https://stars.renci.org/var/babel/latest/
```

### Development Commands

```bash
# Run all tests (includes large file downloads)
uv run pytest -v

# Run unit tests only (fast, no network)
uv run pytest -v -m "not integration"

# Run integration tests without the Identifiers.parquet download
uv run pytest -v -m "integration and not slow"

# Run a single test file
uv run pytest -v tests/test_nodenorm.py

# Run serially, e.g. to read one test's output
uv run pytest -v -n0 tests/test_nodenorm.py
```

`[tool.pytest.ini_options]` puts `-n auto` in `addopts`, so every run is parallel by default.
Disable it with `-n0`, **not** `-p no:xdist` — unloading the plugin leaves the already-parsed
`-n` behind and pytest exits with `unrecognized arguments: -n`.

### Linting

**Run both of these before committing or pushing.** CI checks them on every PR, and a push
that skips them turns the PR red for reasons unrelated to the change under review.

```bash
uv run ruff check          # Python lint
uv run ruff check --fix    # Python auto-fix
uv run ruff format --check # Python format check
uv run ruff format         # Python auto-format
```

Run them over the whole repository, not just the files you touched — `[tool.ruff]` in
`pyproject.toml` sets the scope. If `ruff format` reports files you did not edit, the repository
had drifted; commit that reformatting separately from your change so review stays readable, and
do not silently revert it.

Rules are `E`, `F`, `I` (import sorting) and `UP` (pyupgrade), with `E501` left to the formatter.
Line length is ruff's default of 88. `*.md` is excluded, because ruff 0.16+ reformats Python
inside Markdown code blocks and this repository's snippets are illustrative fragments.

## Console Output Format Conventions

### Label display

When a human-readable label is shown alongside a CURIE in console output, it always appears **immediately after the CURIE, in double quotes**:

```
MONDO:0004979 "asthma"  skos:exactMatch  EFO:0000270 "asthma"
```

This applies everywhere labels appear: `xrefs --labels`, `xrefs --paths --labels`, `ids --labels`, and `test-concord`.

`--paths` is console-only; combining it with `--format json`/`tsv`/`csv` is rejected up front rather
than silently emitting the full cross-reference list. It also needs at least two CURIEs, and that
is checked in the same place, before `make_downloader()` — `--paths` implies `--recurse`, so
finding out inside `_print_paths()` would cost a multi-gigabyte download and a full recursive query
before rejecting the run.

**When a label is absent, omit it entirely** — do not substitute a placeholder like `-` or `""`. A CURIE with no label renders as just the bare CURIE.

**Escaping:** embedded backslashes are escaped as `\\` and embedded double quotes as `\"`. Downstream tools can parse labels with the regex `"([^"\\]|\\.)*"`.

**Do not** use parentheses `(label)` or any other delimiter — double quotes are the sole convention.

## Architecture

### Core Components

1. **BabelDownloader** (`src/babel_explorer/core/downloader.py`):
   - Downloads Babel intermediate files from a remote HTTP(S) server using Python's `requests` library (streaming downloads)
   - Caches files locally in a configurable directory (default: `data/`), one Babel release at a time
   - Caching is on disk, keyed by ETag and the `.meta` sidecars — not in memory. Only
     `babel_version` is memoised, via `functools.cached_property`
   - Resolves the Babel version (`resolve_babel_version`) and refreshes the cache when it changes (`sync_cache_version`)
   - Raises `MissingBabelFileError` on a 404 for a `duckdb/` file, since public releases do not publish them
   - **Important**: Requires network access but no external tools like `wget`

2. **BabelXRefs** (`src/babel_explorer/core/babel_xrefs.py`):
   - Main query engine for cross-references
   - Uses DuckDB to query Parquet files (`Concord.parquet`, `Identifiers.parquet`)
   - Supports recursive expansion of cross-references via a single `WITH RECURSIVE` query
   - Uses ephemeral in-memory DuckDB connections, opened by `BabelXRefs._connect()`. No
     database is persisted, but larger-than-memory queries spill to disk: `_connect()` sets
     `temp_directory` to `<BABEL_LOCAL_DIR>/duckdb-spill/`, because DuckDB's default is
     `.tmp` in the *current working directory* and a `--recurse` run materialises the whole
     multi-gigabyte Concord relation

3. **NodeNorm** (`src/babel_explorer/core/nodenorm.py`):
   - Integration with NodeNormalization API (https://nodenormalization-sri.renci.org/)
   - Fetches labels, biolink types, and equivalent identifiers for CURIEs
   - Caches normalisation results, identifiers and cliques in per-instance dicts; a new
     `NodeNorm` object is the way to get uncached results
   - `get_babel_version()` reads the `status` endpoint to report which Babel release it was built from
   - Optional component for label enrichment

4. **CLI** (`src/babel_explorer/cli.py`):
   - Click-based command-line interface
   - Three main commands: `xrefs`, `ids`, `test-concord`

### Data Flow

1. User provides CURIEs via CLI; `BABEL_RELEASES_URL` + `BABEL_VERSION` / `NODENORM_URL` come from `.env` or the environment, and are composed into the effective Babel URL
2. BabelDownloader resolves the Babel version, refreshes the cache if it changed, and ensures required Parquet files are downloaded
3. BabelXRefs queries files using DuckDB
4. If `--labels` is set, NodeNorm is queried for additional metadata (`--recurse` alone does not consult NodeNorm — the recursive expansion is a single DuckDB query)
5. Results are printed to stdout

### Key Design Patterns

- **Lazy downloading**: Files are only downloaded when first accessed
- **Caching**: Downloads are cached on disk (ETag + `.meta` sidecar); NodeNorm results are cached
  in per-instance dicts. Neither uses `functools.lru_cache`
- **Recursive expansion**: The `--recurse` flag recursively follows all cross-references to build complete graphs
- **DuckDB for querying**: In-memory SQL queries against Parquet files for fast lookups, spilling
  to `<BABEL_LOCAL_DIR>/duckdb-spill/` rather than the working directory

## Testing

### Test Structure

Tests live in `tests/` and are split into fast **unit tests** (mocked, no network) and slower **integration tests** (real downloads and API calls). Pytest markers control which tests run:

- **`@pytest.mark.integration`** — requires network access (downloads Parquet files or calls NodeNorm API)
- **`@pytest.mark.slow`** — downloads `Identifiers.parquet`, the largest file Babel publishes

Note that `not slow` is *not* the same as "small". `Concord.parquet` is itself multi-gigabyte in
current releases (4.6 GB in `2026jul22`) and its tests are not marked slow, because excluding them
would leave the non-slow integration set covering nothing that touches real data. Budget for that
before pointing CI at a Babel that publishes the Parquet files (see issue #18).

Do not record per-file test counts here — they drift silently and then mislead. Get them on demand:

```bash
uv run pytest --collect-only -q -m "not integration"   # unit test count
uv run pytest --collect-only -q                        # full count
```

**Integration tests skip when the composed Babel URL points at a release that does not publish
`duckdb/Concord.parquet`**, which is the case for every public release right now. A run reporting
a couple of dozen skips is the expected result without a Translator `BABEL_RELEASES_URL` in `.env`, not a
broken test environment.

**A release can publish one DuckDB file without the other.** `2026jul22` serves a 4.6 GB
`Concord.parquet` with no `Identifiers.parquet` beside it, so "does this release have the Parquet
files?" is not one question. Every DuckDB file goes through `_download_or_skip()`, which skips on
the `MissingBabelFileError` the downloader already raises for a 404 on a `duckdb/` path.
`shared_downloader` answers only the genuinely session-wide question — is the server reachable —
and deliberately probes the release root rather than a specific file, so it cannot be mistaken for
a publication check. Do not collapse these back into one up-front probe: the non-slow integration
tests run perfectly well against a release that lacks `Identifiers.parquet`.

**A full run re-downloads everything.** `pytest_sessionfinish` deletes `data/test`, so each
`uv run pytest` with a Babel release configured pays the multi-gigabyte download again (~9 minutes
for `2026jul22`). Use `-m "not integration"` while iterating, and budget for the full run.

**Never run two full suites at once.** `data/test` is a fixed path shared by every run, and
`pytest_sessionfinish` deletes it unconditionally, so a second run tears down the first run's
download — and the `FileLock` around each download does not help, because it guards one file, not
a session. Two concurrent runs will each re-download a file the other has just deleted, for as long
as you let them.

- **Detect it**: `du -sh data/test` going *down* instead of up, and a full run that sails past the
  ~9 minutes it should take. `ps -eo pid,etime,command | grep "[p]ytest"` showing two sets of
  workers with different `etime` values confirms it.
- **Avoid it**: check for a run already in flight before starting one, and never `rm -rf data/test`
  to "start clean" without checking first — that is the fastest way to corrupt a run in progress.
- **Recover**: kill every pytest process, `rm -rf data/test`, and start exactly one run. Nothing
  outside `data/test` is affected, so no repository or cache state needs repairing.

### Test Infrastructure

- **`tests/conftest.py`** — Session-scoped fixtures that download Parquet files once and share them across all integration tests. `shared_downloader` HEADs the release root and skips the session if the server is unreachable; `_download_or_skip()` then skips per file if the release does not publish it. `nodenorm` probes `status` the same way, so a NodeNorm outage skips rather than reddening CI. Teardown removes the `data/test/` directory so the next run starts fresh — see the concurrency warning above before running two suites at once.
- **`tests/constants.py`** — Shared constants (URLs, file paths) and `load_curies()` helper.
- **`tests/data/valid_curies.txt`** — One CURIE per line (`#` comments allowed). Integration tests are parametrized over this list — adding a new line automatically expands test coverage.

### Key Dataclasses

- **`Identifier`** — Frozen dataclass for a normalized NodeNorm entry (curie, label, biolink_type, taxa, description). Returned by `NodeNorm.get_identifier()` and `get_clique_identifiers()`.
- **`CrossReference`** — Frozen dataclass for Concord.parquet rows (filename, subj, pred, obj)
- **`LabeledCrossReference`** — Extends CrossReference with labels and biolink types from NodeNorm
- **`IdentifierRecord`** — Frozen dataclass for Identifiers.parquet rows (curie + dynamic extra fields, plus `nodenorm_label` under `--labels`). Returned by `BabelXRefs.get_curie_ids()`. The NodeNorm label is *not* called `label`: Identifiers.parquet has its own `label` column, which lands in `extra_fields` and would collide with it once the record is flattened for json/tsv/csv.

## Repository history was rewritten on 2026-09-01

Every commit was rewritten to remove an internal Babel URL that had been the hardcoded default
since the initial commit. Consequences a future contributor will trip over:

- **A clone taken before that date has divergent history.** Every SHA changed except `gh-pages`.
  Re-clone; do not try to merge or rebase the old history back together.
- **PRs #1, #4, #6, #7 and #11 are dead.** GitHub refuses to reopen a PR whose original head
  commits no longer exist, so they were recreated as #20-#24. Old PR links and commit SHAs in
  issue comments point at nothing.
- **`.env.*` is gitignored, `env.default` is not.** The URL leaked in the first place because it
  was a default in source rather than configuration. `TestCommittedConfigTemplate`
  (`tests/test_cli.py`) now fails if a non-public host appears in `env.default`; that test is the
  enforcement, so do not weaken it to accommodate a convenient default.

## Important Notes

- **Data directory**: The `data/` directory is gitignored and contains downloaded Parquet files and generated DuckDB databases
- **Babel versions**: The Babel release comes from `BABEL_RELEASES_URL` + `BABEL_VERSION`, or from `--babel-url` when given; see [Babel versions](#babel-versions) above
- **`.env`**: gitignored. Only `env.default` is committed, and it must never contain the Translator-specific Babel URL

## File Locations

- Source code: `src/babel_explorer/`
- Tests: `tests/`
- Test CURIEs: `tests/data/valid_curies.txt`
- Downloaded Babel files: `<BABEL_LOCAL_DIR>/duckdb/*.parquet` (default `data/duckdb/`)
- DuckDB query spill: `<BABEL_LOCAL_DIR>/duckdb-spill/` (default `data/duckdb-spill/`)
- Endpoint configuration: `.env` (gitignored), template in `env.default`
- Entry point: `src/babel_explorer/cli.py`
