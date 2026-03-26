# Babel Explorer
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
uv run babel-explorer xrefs MONDO:0004979 --recurse

# Get cross-references with labels from NodeNorm
uv run babel-explorer xrefs MONDO:0004979 --labels

# Get ID records for CURIEs
uv run babel-explorer ids MONDO:0004979

# Test concordance changes with NodeNorm
uv run babel-explorer test-concord MONDO:0004979 HP:0000001
```

## Web Frontends

babel-explorer has **two** web frontends that share the same Bootstrap 5 dark-navbar styling. See [Architecture: Frontend Deployment](#architecture-frontend-deployment) for the rationale behind the split.

### Astro/Vue Frontend (GitHub Pages)

Static site built with Astro + Vue 3. Hosts API-only tools that run entirely in the browser.

```bash
cd web
npm install
npm run dev    # Dev server at http://localhost:4321
npm run build  # Build to web/dist/
```

**Currently available:** NodeNorm lookup (single-instance and multi-instance comparison).

### Python Frontend (Kubernetes)

FastAPI + htmx server. Hosts database-dependent tools that need DuckDB and multi-GB Parquet files.

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

## Architecture: Frontend Deployment

babel-explorer's four web tools have fundamentally different infrastructure needs:

| Tool | Data dependency | Needs a server? |
|------|----------------|-----------------|
| **XRefs** | Concord.parquet (~626 MB) + DuckDB | Yes |
| **IDs** | Identifiers.parquet (~2 GB+) + DuckDB | Yes |
| **NodeNorm** | External API only (CORS-enabled) | No |
| **Test Concordance** | External API only (CORS-enabled) | No |

XRefs and IDs query multi-GB Parquet files via DuckDB — they genuinely need a server with those files on disk. NodeNorm and Test Concordance are pure API proxies: the server adds latency and a failure point for zero value, since the NodeNorm API supports CORS and can be called directly from the browser.

The frontend is therefore split along this natural dependency boundary:

### Server (Kubernetes) — `src/babel_explorer/web/`

The FastAPI + htmx server hosts **XRefs** and **IDs**. It downloads and caches Parquet files, runs DuckDB queries, and renders HTML server-side. It also exposes the JSON REST API (`/api/xrefs`, `/api/ids`) and CSV downloads for programmatic access.

### GitHub Pages (static) — `web/`

**NodeNorm** (and eventually **Test Concordance**) are built as an Astro + Vue 3 static site in the `web/` directory. These pages call the NodeNorm API directly from the browser using `fetch()` — no server required.

Deployment URLs for NodeNorm and NameRes are defined once in `config/translator-endpoints.json`, shared by both frontends and the CLI. CURIE link-outs use the [biolink-model prefix map](https://github.com/biolink/biolink-model) (fetched at runtime). Both sites share Bootstrap 5 dark-navbar styling for a consistent look.

### Why this split?

- **Preserves htmx where it matters.** XRefs/IDs benefit from server-side rendering because the data is already on the server. No need to rewrite them in client-side JS.
- **Minimal new code.** The JS for calling NodeNorm directly is trivial (~200 lines). A fully headless API approach would require replicating htmx partial rendering for XRefs/IDs dynamic columns in JS — more code for no gain.
- **Resilience.** If the Kubernetes pod is down or a Parquet download stalls, the API-only tools still work on GitHub Pages.
- **Reusable pattern.** Any CORS-enabled Translator API (NameRes, Node Annotator, etc.) can get a GitHub Pages demo the same way. This demonstrates to the [translator_sdk](https://github.com/NCATSTranslator/Translator_sdk) team that web UIs for API tools are easy and free to host, without complicating that repo's PyPI package. translator_sdk stays as a Python SDK (pipx-runnable CLI); web demos can live in `docs/` here or in a shared repo if the pattern scales.

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