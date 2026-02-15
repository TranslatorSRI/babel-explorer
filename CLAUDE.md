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
uv run babel-explorer xrefs MONDO:0004979 --expand

# Get cross-references with labels from NodeNorm
uv run babel-explorer xrefs MONDO:0004979 --labels

# Get ID records for CURIEs
uv run babel-explorer ids MONDO:0004979

# Test concordance changes with NodeNorm
uv run babel-explorer test-concord MONDO:0004979 HP:0000001

# Use custom Babel server or local directory
uv run babel-explorer xrefs MONDO:0004979 --local-dir data/2025nov19 --babel-url https://stars.renci.org:443/var/babel_outputs/2025nov19/
```

### Development Commands

```bash
# Run tests
uv run pytest

# Run linter
uv run ruff check

# Format code
uv run ruff format
```

## Architecture

### Core Components

1. **BabelDownloader** (`src/babel_explorer/core/downloader.py`):
   - Downloads Babel intermediate files from a remote server using `wget`
   - Caches files locally in configurable directory (default: `data/2025nov19/`)
   - Uses `@functools.lru_cache` to avoid re-downloading
   - **Important**: Requires `wget` to be installed on the system

2. **BabelXRefs** (`src/babel_explorer/babel_xrefs.py`):
   - Main query engine for cross-references
   - Uses DuckDB to query Parquet files (`Concord.parquet`, `Identifiers.parquet`, `Metadata.parquet`)
   - Supports recursive expansion of cross-references
   - Creates ephemeral DuckDB databases in `data/<version>/output/duckdbs/`

3. **NodeNorm** (`src/babel_explorer/core/nodenorm.py`):
   - Integration with NodeNormalization API (https://nodenormalization-sri.renci.org/)
   - Fetches labels, biolink types, and equivalent identifiers for CURIEs
   - Uses `@functools.lru_cache` for performance
   - Optional component for label enrichment

4. **CLI** (`src/babel_explorer/cli.py`):
   - Click-based command-line interface
   - Three main commands: `xrefs`, `ids`, `test-concord`

### Data Flow

1. User provides CURIEs via CLI
2. BabelDownloader ensures required Parquet files are downloaded
3. BabelXRefs queries files using DuckDB
4. If `--labels` or `--expand` flags are set, NodeNorm is queried for additional metadata
5. Results are printed to stdout

### Key Design Patterns

- **Lazy downloading**: Files are only downloaded when first accessed
- **LRU caching**: Heavy use of `@functools.lru_cache` to avoid redundant downloads and API calls
- **Recursive expansion**: The `--expand` flag recursively follows all cross-references to build complete graphs
- **DuckDB for querying**: In-memory SQL queries against Parquet files for fast lookups

## Important Notes

- **System dependency**: This project requires `wget` to be installed (used by BabelDownloader)
- **Data directory**: The `data/` directory is gitignored and contains downloaded Parquet files and generated DuckDB databases
- **Babel versions**: The default Babel version is `2025nov19`, but this can be customized via `--local-dir` and `--babel-url`
- **No tests yet**: The project currently has pytest configured but no test files exist
- **Empty model.py**: The `src/babel_explorer/core/model.py` file exists but is currently empty; data classes are defined in `babel_explorer.py` and `nodenorm.py` instead

## File Locations

- Source code: `src/babel_explorer/`
- Downloaded Babel files: `data/<version>/duckdb/*.parquet`
- Generated DuckDB databases: `data/<version>/output/duckdbs/`
- Entry point: `src/babel_explorer/cli.py`
