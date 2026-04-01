# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

babel-explorer is a tool for querying and exploring Babel intermediate files. It allows users to discover why two biological/chemical identifiers are considered identical by the Babel system, which handles cross-references between different ontology and database identifiers (e.g., MONDO, HP, UMLS, HGNC).

## Development Setup

This project has two package managers — **uv** for Python and **npm** for the Astro/Vue frontend:

```bash
# Python (CLI + server frontend)
uv sync --group dev
uv run babel-explorer --help

# Astro/Vue frontend (GitHub Pages)
cd web && npm install && npm run dev
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

# Use custom Babel server or local directory
uv run babel-explorer xrefs MONDO:0004979 --local-dir data/2025nov19 --babel-url https://stars.renci.org:443/var/babel/2025nov19/

# Start the web server
uv run babel-explorer web

# Start with custom options
uv run babel-explorer web --host 0.0.0.0 --port 9000 --reload
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

# Astro/Vue frontend (from web/ directory)
cd web && npm run dev        # Dev server at localhost:4321
cd web && npm run build      # Build to web/dist/
cd web && npm test           # Run Vitest unit + component tests
cd web && npm run test:watch # Watch mode
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
   - `NodeNorm.URLs` loaded from `config/translator-endpoints.json` (shared with the Astro frontend)
   - Optional component for label enrichment

4. **CLI** (`src/babel_explorer/cli.py`):
   - Click-based command-line interface
   - Four main commands: `xrefs`, `ids`, `test-concord`, `web`

5. **Python Web Frontend** (`src/babel_explorer/web/`):
   - FastAPI + Jinja2 + htmx + Bootstrap 5 (CDN) web interface
   - App factory in `web/__init__.py` — `create_app(local_dir, babel_url, nodenorm_url)`
   - All routes in `web/routes.py` — HTML pages, htmx partials, JSON API, CSV downloads
   - Templates in `web/templates/` with `_partials/` for htmx fragments
   - Sync route handlers (core code is synchronous; FastAPI runs them in a threadpool)
   - Four tools exposed: NodeNorm, XRefs, IDs, Test Concordance
   - Deployed to Kubernetes (hosts DB-dependent tools)

6. **Astro/Vue Web Frontend** (`web/`):
   - Astro + Vue 3 static site for browser-only tools (no backend required)
   - npm package name: `babel-explorer` (directory stays `web/`)
   - Deployed to GitHub Pages
   - Currently hosts: NodeNorm lookup (unified instance selection via checkboxes, expandable result table, shareable URLs)
   - Calls NodeNorm API directly from the browser via `fetch()` (CORS-enabled)
   - Uses Bootstrap 5 (CDN) with the same dark-navbar styling as the Python frontend
   - CURIE link-outs via [biolink-model prefix map](https://github.com/biolink/biolink-model) (v4.3.7, fetched at runtime)
   - Tested with Vitest + @vue/test-utils + happy-dom (99 tests); see `web/tests/README.md`
   - See `web/README.md` for development instructions and `web/FUTURE.md` for deferred features

7. **Shared Configuration** (`config/`):
   - `config/translator-endpoints.json` — single source of truth for NodeNorm and NameRes deployment URLs across all environments (dev, exp, ci, test, prod)
   - Consumed by Python CLI/frontend (`nodenorm.py`) and Astro frontend (`NodeNormApp.vue`)

### Data Flow

1. User provides CURIEs via CLI
2. BabelDownloader ensures required Parquet files are downloaded
3. BabelXRefs queries files using DuckDB
4. If `--labels` or `--recurse` flags are set, NodeNorm is queried for additional metadata
5. Results are printed to stdout
1. User provides CURIEs via CLI, Python web UI, or Astro web UI
2. For DB-dependent tools (XRefs, IDs): BabelDownloader ensures required Parquet files are downloaded, BabelXRefs queries files using DuckDB
3. For API-only tools (NodeNorm): the Astro frontend calls the NodeNorm API directly from the browser; the Python frontend proxies through the server
4. If `--labels` or `--expand` flags are set, NodeNorm is queried for additional metadata
5. Results are printed to stdout (CLI), rendered as HTML tables / JSON / CSV (Python web), or rendered as Vue components (Astro web)

### Astro/Vue Frontend Structure (`web/`)

```
web/src/
  layouts/BaseLayout.astro          # Bootstrap 5 CDN + dark navbar
  components/
    Navbar.astro                    # Dark navbar matching Python frontend
    nodenorm/
      NodeNormApp.vue               # Root Vue island (client:only="vue")
      NodeNormForm.vue              # Form: textarea, checkboxes + custom URL, API toggles
      ComparisonView.vue            # Results table (rows=CURIEs, cols=instances) with expandable rows
      CurieDetailPanel.vue          # Expandable detail body: description, types, IC, equiv IDs
      CurieResultCard.vue           # Accordion card wrapping CurieDetailPanel (single-instance use)
      ResultsSummary.vue            # Unified stat tiles: normalized count, disagreements, types
      EquivalentIdTable.vue         # Striped table with togglable columns
      ColumnVisibility.vue          # Page-wide column show/hide controls
    shared/
      CurieLink.vue                 # CURIE → external URL link using biolink prefix map
  lib/
    nodenorm-api.ts                 # fetch() wrapper for NodeNorm get_normalized_nodes (AbortSignal support)
    curie-links.ts                  # Biolink prefix map loader + URL builder
    url-state.ts                    # Encode/decode query state in URL params (readQueryState, buildQueryUrl)
    types.ts                        # TypeScript interfaces + DEFAULT_API_OPTIONS
  pages/
    index.astro                     # Landing page with tool cards
    nodenorm.astro                  # NodeNorm tool page
```

Key patterns:
- Each tool page hosts one Vue island via `client:only="vue"` (no SSR — all client-side)
- Shared config imported from `config/translator-endpoints.json` at build time
- Bootstrap via CDN (not npm) to match the Python frontend exactly

### Python Web Route Structure

| Route | Method | Returns | Purpose |
|-------|--------|---------|---------|
| `/` | GET | HTML | Landing page |
| `/nodenorm`, `/xrefs`, `/ids`, `/test-concord` | GET | HTML | Tool form pages |
| `/htmx/nodenorm`, `/htmx/xrefs`, `/htmx/ids`, `/htmx/test-concord` | POST | HTML partial | htmx result fragments |
| `/api/nodenorm`, `/api/xrefs`, `/api/ids`, `/api/test-concord` | GET | JSON | REST API (`?curie=X&curie=Y`) |
| `/api/*/csv` | GET | CSV file | CSV download for each tool |
| `/docs` | GET | HTML | Swagger UI (auto-generated by FastAPI) |

The NodeNorm and Test Concordance pages include a dropdown to select from predefined `NodeNorm.URLs` instances or enter a custom URL.

### Key Design Patterns

- **Lazy downloading**: Files are only downloaded when first accessed
- **LRU caching**: Heavy use of `@functools.lru_cache` to avoid redundant downloads and API calls
- **Recursive expansion**: The `--recurse` flag recursively follows all cross-references to build complete graphs
- **DuckDB for querying**: In-memory SQL queries against Parquet files for fast lookups
- **Dual frontend**: DB-dependent tools on a server (FastAPI + htmx), API-only tools in the browser (Astro + Vue). Split follows data dependencies.
- **Shared config**: `config/translator-endpoints.json` is the single source of truth for deployment URLs, consumed by both frontends and the CLI

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
| `tests/test_web.py` | 25 | 0 | 0 | 25 |

### Test Infrastructure

- **`tests/conftest.py`** — Session-scoped fixtures that download Parquet files once and share them across all integration tests. Teardown removes the `data/test/` directory so the next run starts fresh.
- **`tests/constants.py`** — Shared constants (URLs, file paths) and `load_curies()` helper.
- **`tests/data/valid_curies.txt`** — One CURIE per line (`#` comments allowed). Integration tests are parametrized over this list — adding a new line automatically expands test coverage.
- **`tests/fixtures/`** — JSON snapshots of real NodeNorm API responses, shared by both Python and TypeScript test suites. Includes single-CURIE responses, batch (multi-CURIE) responses, conflated vs. non-conflated variants, and a biolink prefix map subset. See `web/tests/README.md` for the full fixture list and how to regenerate them.

### Key Dataclasses

- **`Identifier`** — Frozen dataclass for a normalized NodeNorm entry (curie, label, biolink_type, taxa, description). Returned by `NodeNorm.get_identifier()` and `get_clique_identifiers()`.
- **`CrossReference`** — Frozen dataclass for Concord.parquet rows (filename, subj, pred, obj)
- **`LabeledCrossReference`** — Extends CrossReference with labels and biolink types from NodeNorm
- **`IdentifierRecord`** — Frozen dataclass for Identifiers.parquet rows (curie + dynamic extra fields). Returned by `BabelXRefs.get_curie_ids()`.

## Important Notes

- **Data directory**: The `data/` directory is gitignored and contains downloaded Parquet files and generated DuckDB databases
- **Babel versions**: The default Babel version is `2025nov19`, but this can be customized via `--local-dir` and `--babel-url`

## File Locations

- Python source code: `src/babel_explorer/`
- Tests: `tests/`
- Test CURIEs: `tests/data/valid_curies.txt`
- Downloaded Babel files: `data/<version>/duckdb/*.parquet`
- Generated DuckDB databases: `data/<version>/output/duckdbs/`
- Python web frontend: `src/babel_explorer/web/`
- Python web templates: `src/babel_explorer/web/templates/`
- Astro/Vue web frontend: `web/`
- Astro/Vue components: `web/src/components/`
- Astro/Vue pages: `web/src/pages/`
- Astro/Vue tests: `web/src/**/__tests__/` (co-located) + `web/tests/README.md`
- Shared config: `config/translator-endpoints.json`
- Shared test fixtures (Python + TS): `tests/fixtures/`
- Entry point: `src/babel_explorer/cli.py`
