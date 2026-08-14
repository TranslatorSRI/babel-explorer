# Babel Explorer
Software for querying and exploring Babel intermediate files.

babel-explorer allows you to discover why two biological/chemical identifiers are considered identical by the [Babel](https://github.com/TranslatorSRI/Babel) system, which handles cross-references between different ontology and database identifiers (e.g., MONDO, HP, UMLS, HGNC).

## Setup

This project uses [uv](https://docs.astral.sh/uv/) for package management:

```bash
uv sync --group dev
cp .env.example .env
```

## Configuration

`.env` holds the endpoints babel-explorer talks to:

| Variable | Default | Purpose |
|---|---|---|
| `BABEL_URL` | `https://stars.renci.org/var/babel/latest/` | Babel release to query |
| `BABEL_LOCAL_DIR` | `data` | Where downloaded Babel files are cached |
| `BABEL_CHECK_DOWNLOAD` | `3h` | How often to re-check downloads |
| `NODENORM_URL` | `https://nodenormalization-sri.renci.org/` | NodeNorm instance for labels and cliques |

Each has a matching command-line option, and precedence runs **flag > environment variable >
`.env` > default**.

> **Translator team members:** public Babel releases do not currently publish the DuckDB Parquet
> files (`duckdb/Concord.parquet`, `duckdb/Identifiers.parquet`) that babel-explorer needs, so the
> default `BABEL_URL` will report that the files are missing. Contact the Babel developers for the
> Translator-specific URL and set `BABEL_URL` to it in your `.env`.

### Babel versions

`BABEL_LOCAL_DIR` holds one Babel release at a time. When `BABEL_URL` starts pointing at a
different release, babel-explorer notices and re-downloads the files that changed — you do not
need to clear the cache by hand.

`xrefs` refuses to run when NodeNorm was built from a different Babel release than the one being
queried, since the labels and cliques would not match the cross-references. Pass
`--allow-version-mismatch` to override.

## Usage

```bash
# Get cross-references for one or more CURIEs
uv run babel-explorer xrefs MONDO:0004979

# Get cross-references with expansion (recursive lookup)
uv run babel-explorer xrefs MONDO:0004979 --recurse

# Get cross-references with labels from NodeNorm
uv run babel-explorer xrefs MONDO:0004979 --labels
# Labels appear in double quotes immediately after the CURIE:
#   MONDO:0004979 "asthma"  skos:exactMatch  EFO:0000270 "asthma"

# Get ID records for CURIEs
uv run babel-explorer ids MONDO:0004979

# Test concordance changes with NodeNorm
uv run babel-explorer test-concord MONDO:0004979 HP:0000001
```

## Testing

Tests are split into fast **unit tests** (mocked, no network) and slower **integration tests** (real file downloads and API calls), controlled by pytest markers.

Integration tests run against whatever `BABEL_URL` points at, and skip when that release does not
publish the DuckDB Parquet files.

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
