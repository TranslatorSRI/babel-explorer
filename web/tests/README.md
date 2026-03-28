# Web Frontend Tests

Tests for the Astro + Vue 3 static frontend (`web/`).

## Test Stack

| Tool | Purpose |
|------|---------|
| [Vitest](https://vitest.dev/) | Test runner — native ESM, fast, Vite-compatible |
| [@vue/test-utils](https://test-utils.vuejs.org/) | Vue component mounting and assertions |
| [happy-dom](https://github.com/nicedayjs/happy-dom) | Lightweight DOM environment (no browser needed) |

Vitest's built-in `vi.fn()`, `vi.spyOn()`, and `vi.stubGlobal()` handle all mocking — no additional libraries needed.

## Running Tests

```bash
cd web
npm test          # Run all tests once
npm run test:watch  # Watch mode (re-runs on file changes)
```

## Test Organization

Tests are **co-located** with source using `__tests__/` directories:

```
web/src/
  lib/
    __tests__/
      nodenorm-api.test.ts    # parseCuries + fetchNormalizedNodes + AbortSignal + fixture shape
      url-state.test.ts       # readQueryState + buildQueryUrl + round-trip
      curie-links.test.ts     # parseCurie + getCurieUrl + loadPrefixMap
      types.test.ts           # DEFAULT_API_OPTIONS smoke test
  components/
    nodenorm/
      __tests__/
        SummaryCard.test.ts
        CurieResultCard.test.ts
        ComparisonView.test.ts
    shared/
      __tests__/
        CurieLink.test.ts
```

### Library tests (highest priority)

Pure function tests with mocked `fetch()`. These cover:
- **`nodenorm-api.ts`**: CURIE parsing (blank lines, comments, deduplication), API request construction, AbortSignal pass-through, and NodeNorm response shape assertions (executed as documentation of the API contract)
- **`url-state.ts`**: `readQueryState` (no params, curie/target/option parsing), `buildQueryUrl` (default option omission, multi-target), and round-trip fidelity
- **`curie-links.ts`**: CURIE parsing, URL construction from biolink prefix map, cache behavior
- **`types.ts`**: Default options constant

### Component tests

Mount Vue components with `@vue/test-utils` and assert on rendered output and computed logic:
- **SummaryCard**: normalized/not-found counts, type breakdown, shared types
- **CurieResultCard**: adaptive display threshold (≤10 vs >10 equiv IDs), prefix summary
- **ComparisonView**: agreement detection, row highlighting, helper functions
- **CurieLink**: conditional `<a>` vs `<span>` rendering

## Shared Fixtures

Test fixtures live at the repo root so both Python and TypeScript tests can use them:

```
tests/fixtures/
  nodenorm_responses/
    mondo_0004979.json             # Asthma — 28 equiv IDs (large clique), 3 descriptions
    chebi_48947.json               # Metformin — 82 equiv IDs (very large clique)
    ncit_c55060.json               # Hypertension CTCAE — 2 equiv IDs (small clique)
    ncit_c34373.json               # ALS — multiple descriptions
    ncbigene_1756.json             # DMD gene — has taxa on equiv IDs
    mesh_d014867_conflated.json    # Water — 206 equiv IDs (conflate=true)
    mesh_d014867_no_conflate.json  # Water — 30 equiv IDs (conflate=false, drug_chemical_conflate=false)
    batch_mixed.json               # Multi-CURIE GET: MONDO:0004979 + NCIT:C55060 + FAKE:9999999
    not_found.json                 # FAKE:9999999 → null (key present, value null)
  prefix_map_subset.json           # 10 entries from biolink-model prefix map (MONDO, CHEBI, …)
```

### NodeNorm API response shape (key facts for test authors)

These facts are verified by tests in `nodenorm-api.test.ts` and should be kept in sync if the API changes:

- **`id.description`** — plain `string` (the best/longest description). Same as `descriptions[0]`. Only present when `description=true`.
- **`descriptions`** — `string[]` collecting all descriptions found across the clique. `descriptions[0]` is the best description. Only present when `description=true`.
- **`equivalent_identifiers[i].description`** — plain `string` when present (not an array). Not every identifier has one.
- **Not-found CURIEs** — the key is present in the response with a `null` value (not a missing key).
- **Conflation** — `conflate=true` merges Chemical/SmallMolecule/Drug cliques, significantly expanding the equivalent identifier set. MESH:D014867 (water): 206 equiv IDs conflated vs. 30 without.
- **Multi-CURIE requests** — send repeated `curie=` params in GET, or send a JSON body `{"curies": [...]}` via POST to the same endpoint. All options (`conflate`, `description`, etc.) apply to the whole batch.

### Regenerating fixtures

Fixtures are snapshots of real NodeNorm Dev responses. To regenerate a single CURIE:

```bash
curl -s 'https://nodenormalization-sri.renci.org/get_normalized_nodes?curie=MONDO:0004979&conflate=true&drug_chemical_conflate=true&description=true&individual_types=true&include_taxa=true' \
  | python3 -m json.tool > tests/fixtures/nodenorm_responses/mondo_0004979.json
```

For a multi-CURIE batch (GET with repeated params):

```bash
curl -s 'https://nodenormalization-sri.renci.org/get_normalized_nodes?curie=MONDO:0004979&curie=NCIT:C55060&curie=FAKE:9999999&conflate=true&drug_chemical_conflate=true&description=true&individual_types=true&include_taxa=true' \
  | python3 -m json.tool > tests/fixtures/nodenorm_responses/batch_mixed.json
```

Or equivalently via POST:

```bash
curl -s -X POST \
  'https://nodenormalization-sri.renci.org/get_normalized_nodes?conflate=true&drug_chemical_conflate=true&description=true&individual_types=true&include_taxa=true' \
  -H 'Content-Type: application/json' \
  -d '{"curies": ["MONDO:0004979", "NCIT:C55060", "FAKE:9999999"]}' \
  | python3 -m json.tool > tests/fixtures/nodenorm_responses/batch_mixed.json
```

For the prefix map subset:

```bash
curl -s 'https://raw.githubusercontent.com/biolink/biolink-model/v4.3.7/src/biolink_model/prefixmaps/biolink-model-prefix-map.json' | python3 -c "
import json, sys
full = json.load(sys.stdin)
keep = ['MONDO', 'CHEBI', 'HP', 'HGNC', 'NCIT', 'UMLS', 'DOID', 'MESH', 'GO', 'NCBITaxon']
print(json.dumps({k: full[k] for k in keep if k in full}, indent=2))
" > tests/fixtures/prefix_map_subset.json
```

## Key Testing Patterns

### Mocking `fetch()`

```typescript
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve(fixtureData),
}));
```

### Module cache isolation (`curie-links.ts`)

`curie-links.ts` caches the prefix map in a module-level variable. Tests that exercise `loadPrefixMap()` must reset the module between tests:

```typescript
beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

it('test case', async () => {
  const { loadPrefixMap } = await import('../curie-links');
  // ...
});
```

## Future Improvements

- **Playwright e2e tests** — test the full page in a real browser (form submission, accordion interaction, Bootstrap JS)
- **Integration tests** — call live NodeNorm API and verify response parsing end-to-end
- **Coverage thresholds** — enforce minimum coverage via `vitest --coverage`
- **CI integration** — run `npm test` in GitHub Actions alongside Python tests
- **Snapshot tests** — if component markup stabilizes, add snapshots for regression detection
- **NodeNormForm tests** — test form validation, mode toggle, emit payloads, initial-value prop wiring
- **NodeNormApp tests** — test orchestration logic (loading state, error handling, parallel fetch in compare mode, URL auto-submit on mount)
