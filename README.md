# babel-explorer
Software for querying and exploring Babel intermediate files.

babel-explorer allows you to discover why two biological/chemical identifiers are considered identical by the [Babel](https://github.com/TranslatorSRI/Babel) system, which handles cross-references between different ontology and database identifiers (e.g., MONDO, HP, UMLS, HGNC).

## Setup

This project uses [uv](https://docs.astral.sh/uv/) for package management:

```bash
uv sync --group dev
```

## Usage

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
```

## Web Frontend

babel-explorer includes a web interface built with FastAPI, htmx, and Bootstrap 5. It exposes all four tools — NodeNorm, XRefs, IDs, and Test Concordance — through a browser UI, a JSON REST API, and CSV downloads.

```bash
# Start the web server (default: http://127.0.0.1:8000)
uv run babel-explorer web

# Custom host/port
uv run babel-explorer web --host 0.0.0.0 --port 9000

# Auto-reload for development
uv run babel-explorer web --reload
```

Once running, open http://127.0.0.1:8000 in a browser. The navbar links to each tool page, the Swagger API docs (`/docs`), and this GitHub repository.

### REST API

The JSON API accepts CURIEs as repeated query parameters:

```bash
# NodeNorm lookup
curl "http://127.0.0.1:8000/api/nodenorm?curie=MONDO:0004979"

# Cross-references with expansion
curl "http://127.0.0.1:8000/api/xrefs?curie=MONDO:0004979&expand=true"

# Identifier records
curl "http://127.0.0.1:8000/api/ids?curie=MONDO:0004979"

# Test concordance
curl "http://127.0.0.1:8000/api/test-concord?curie=MONDO:0004979"
```

CSV downloads are available at `/api/nodenorm/csv`, `/api/xrefs/csv`, `/api/ids/csv`, and `/api/test-concord/csv` with the same query parameters.

## Testing

Tests are split into fast **unit tests** (mocked, no network) and slower **integration tests** (real file downloads and API calls), controlled by pytest markers.

```bash
# Unit tests only — fast, no network required
uv run pytest -v -m "not integration"

# Integration tests without 2GB+ downloads
uv run pytest -v -m "integration and not slow"

# Full suite including large file downloads
uv run pytest -v
```

### Adding Test CURIEs

Integration tests are parametrized over the CURIEs listed in `tests/data/valid_curies.txt`. Add a new CURIE on its own line to automatically expand test coverage:

```
# tests/data/valid_curies.txt
MONDO:0004979
HP:0000001
```
