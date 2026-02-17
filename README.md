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
uv run babel-explorer xrefs MONDO:0004979 --expand

# Get cross-references with labels from NodeNorm
uv run babel-explorer xrefs MONDO:0004979 --labels

# Get ID records for CURIEs
uv run babel-explorer ids MONDO:0004979

# Test concordance changes with NodeNorm
uv run babel-explorer test-concord MONDO:0004979 HP:0000001
```

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