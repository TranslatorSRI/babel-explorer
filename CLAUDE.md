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

# Run the CLI
uv run babel-explorer --help
```

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

# Test concordance changes with NodeNorm
uv run babel-explorer test-concord MONDO:0004979 HP:0000001

# Search external providers (OLS4, MyChem.info) for candidate xrefs
# and diff against Babel's Concord — finds xrefs worth importing into Babel.
uv run babel-explorer search-xrefs CHEBI:31941 --ignore-known

# Use custom Babel server or local directory
uv run babel-explorer xrefs MONDO:0004979 --local-dir data/2025nov19 --babel-url https://stars.renci.org:443/var/babel_outputs/2025nov19/
```

### Development Commands

```bash
# Run all tests (includes large file downloads)
uv run pytest -v

# Run unit tests only (fast, no network)
uv run pytest -v -m "not integration"

# Run integration tests without 2GB+ downloads
uv run pytest -v -m "integration and not slow"

# Run a single test file
uv run pytest -v tests/test_nodenorm.py

# Run linter
uv run ruff check

# Format code
uv run ruff format
```

## Architecture

### Core Components

1. **BabelDownloader** (`src/babel_explorer/core/downloader.py`):
   - Downloads Babel intermediate files from a remote HTTP(S) server using Python's `requests` library (streaming downloads)
   - Caches files locally in configurable directory (default: `data/2025nov19/`)
   - Uses `@functools.lru_cache` to avoid re-downloading
   - **Important**: Requires network access but no external tools like `wget`

2. **BabelXRefs** (`src/babel_explorer/core/babel_xrefs.py`):
   - Main query engine for cross-references
   - Uses DuckDB to query Parquet files (`Concord.parquet`, `Identifiers.parquet`)
   - Supports recursive expansion of cross-references via a single `WITH RECURSIVE` query
   - Uses ephemeral in-memory DuckDB connections (nothing written to disk)

3. **NodeNorm** (`src/babel_explorer/core/nodenorm.py`):
   - Integration with NodeNormalization API (https://nodenormalization-sri.renci.org/)
   - Fetches labels, biolink types, and equivalent identifiers for CURIEs
   - Uses `@functools.lru_cache` for performance
   - Optional component for label enrichment

4. **CLI** (`src/babel_explorer/cli.py`):
   - Click-based command-line interface
   - Four main commands: `xrefs`, `ids`, `test-concord`, `search-xrefs`
   - Shared `@format_option` decorator adds `--format [console|json|tsv|csv]` and `--json-indent` to every command

5. **XRef Providers** (`src/babel_explorer/core/providers/`):
   - Pluggable external mapping sources used by `search-xrefs` (currently OLS4 and MyChem.info)
   - `XRefProvider` `typing.Protocol` + module-level `PROVIDERS` registry dict (see `providers/__init__.py`)
   - Each provider mirrors the `NodeNorm` pattern: `requests`, `@functools.lru_cache(maxsize=None)` on `fetch()`, empty-URL skip, frozen-dataclass results
   - **Adding a new provider**: write a class with `name: str` and `fetch(curie) -> list[CandidateXRef]`, then append a factory to `PROVIDERS` in `providers/__init__.py`. No CLI changes needed — the registry drives `--providers` selection.

6. **curie_utils** (`src/babel_explorer/core/curie_utils.py`):
   - Shared CURIE↔IRI helpers (`split_curie`, `to_iri`, `from_iri`) and a `DEFAULT_PREFIX_MAP` of common Translator prefixes
   - Used by providers that query external services by IRI (e.g. OLS4)

### Data Flow

1. User provides CURIEs via CLI
2. BabelDownloader ensures required Parquet files are downloaded
3. BabelXRefs queries files using DuckDB
4. If `--labels` or `--recurse` flags are set, NodeNorm is queried for additional metadata
5. Results are printed to stdout

### Key Design Patterns

- **Lazy downloading**: Files are only downloaded when first accessed
- **LRU caching**: Heavy use of `@functools.lru_cache` to avoid redundant downloads and API calls
- **Recursive expansion**: The `--recurse` flag recursively follows all cross-references to build complete graphs
- **DuckDB for querying**: In-memory SQL queries against Parquet files for fast lookups

## Testing

### Test Structure

Tests live in `tests/` and are split into fast **unit tests** (mocked, no network) and slower **integration tests** (real downloads and API calls). Pytest markers control which tests run:

- **`@pytest.mark.integration`** — requires network access (downloads Parquet files or calls NodeNorm API)
- **`@pytest.mark.slow`** — downloads very large files (2 GB+)

| File | Unit | Integration | Slow | Total |
|------|------|-------------|------|-------|
| `tests/test_downloader.py` | 41 | 4 | 1 | 46 |
| `tests/test_babel_xrefs.py` | 23 | 20 | 3 | 46 |
| `tests/test_nodenorm.py` | 20 | 13 | 0 | 33 |
| `tests/test_cli.py` | 24 | 0 | 0 | 24 |
| `tests/test_curie_utils.py` | 26 | 0 | 0 | 26 |
| `tests/test_providers_ols.py` | 17 | 2 | 0 | 19 |
| `tests/test_providers_mychem.py` | 21 | 3 | 0 | 24 |
| `tests/test_search_xrefs_cli.py` | 15 | 0 | 0 | 15 |

### Test Infrastructure

- **`tests/conftest.py`** — Session-scoped fixtures that download Parquet files once and share them across all integration tests. Teardown removes the `data/test/` directory so the next run starts fresh.
- **`tests/constants.py`** — Shared constants (URLs, file paths) and `load_curies()` helper.
- **`tests/data/valid_curies.txt`** — One CURIE per line (`#` comments allowed). Integration tests are parametrized over this list — adding a new line automatically expands test coverage.

### Key Dataclasses

- **`Identifier`** — Frozen dataclass for a normalized NodeNorm entry (curie, label, biolink_type, taxa, description). Returned by `NodeNorm.get_identifier()` and `get_clique_identifiers()`.
- **`CrossReference`** — Frozen dataclass for Concord.parquet rows (filename, subj, pred, obj)
- **`LabeledCrossReference`** — Extends CrossReference with labels and biolink types from NodeNorm
- **`IdentifierRecord`** — Frozen dataclass for Identifiers.parquet rows (curie + dynamic extra fields). Returned by `BabelXRefs.get_curie_ids()`.
- **`CandidateXRef`** — Frozen dataclass for an xref candidate from an external provider (query_curie, target_curie, provider, predicate, confidence, evidence, in_babel, target_label, target_biolink_type). Returned by `XRefProvider.fetch()`.

## Important Notes

- **Data directory**: The `data/` directory is gitignored and contains downloaded Parquet files and generated DuckDB databases
- **Babel versions**: The default Babel version is `2025nov19`, but this can be customized via `--local-dir` and `--babel-url`

## File Locations

- Source code: `src/babel_explorer/`
- Tests: `tests/`
- Test CURIEs: `tests/data/valid_curies.txt`
- Downloaded Babel files: `data/<version>/duckdb/*.parquet`
- Entry point: `src/babel_explorer/cli.py`
