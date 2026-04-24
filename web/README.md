# Babel Explorer Web Frontend (GitHub Pages)

This is the **static frontend** for Babel Explorer, built with [Astro](https://astro.build/) and [Vue 3](https://vuejs.org/). It hosts browser-only tools that call public APIs directly — no backend server required.

## Dual-Frontend Architecture

babel-explorer has **two** web frontends:

| Frontend | Stack | Deployment | Tools | Directory |
|----------|-------|------------|-------|-----------|
| **This one** | Astro + Vue 3 | GitHub Pages | NodeNorm, NameRes, Autocomplete | `web/` |
| **Python frontend** | FastAPI + htmx | Kubernetes | XRefs, IDs, Test Concordance, NodeNorm | `src/babel_explorer/web/` |

The split follows data dependencies: tools that only call external APIs (NodeNorm, NameRes) can run entirely in the browser. Tools that query multi-GB Parquet files via DuckDB need a server.

Both frontends share the same Bootstrap 5 dark-navbar styling for visual consistency. The long-term vision is a unified navigation bar with tabs that seamlessly link between the two sites — some tools on GitHub Pages, others on the Kubernetes server.

## Current Features

### NodeNorm Lookup (`/nodenorm`)

- **Bulk normalization**: Enter multiple CURIEs, toggle API options (conflation, descriptions, individual types, taxa)
- **Unified instance selection**: Checkboxes for known NodeNorm deployments (Dev, Exp, CI, Test, Prod) plus a custom URL input; any combination of instances can be queried together
- **Comparison table**: Results shown as a table — rows = CURIEs, columns = selected instances; rows highlighted amber when instances disagree on preferred ID
- **Expandable row detail**: Click any CURIE row to reveal per-instance panels showing description, biolink types, IC score, and equivalent identifiers (prefix summary + expand/collapse for large cliques)
- **Column visibility**: Toggle biolink type, taxa, description columns page-wide
- **Unified summary**: Stat tiles above the table — normalized count (with partial/not-found detail), disagreement count across instances, and biolink type frequency badges
- **Shareable URLs**: Query state encoded in URL params (`?curie=`, `?target=`, non-default options); Share button copies link to clipboard; auto-submits on page load when URL contains CURIEs
- **CURIE link-outs**: Identifiers link to external resources via [biolink-model prefix map](https://github.com/biolink/biolink-model) (v4.3.7)

### NameRes Lookup (`/nameres`)

- **Batch name → CURIE resolution**: Enter multiple search terms (one per line), see ranked results per instance
- **Expected-CURIE validation**: Annotate any line with `[[CURIE]]` to mark expected results; validation reports success/partial/failure with the rank of the best match, configurable via a "fail if in top N" threshold
- **Multi-instance comparison**: Same unified instance selector as NodeNorm
- **API tuning**: `biolink_type`, `only_prefixes`, `exclude_prefixes`, `only_taxa` exposed in the form; limit and autocomplete mode toggles; shareable URL state and JSON export

### Autocomplete Playground (`/autocomplete`)

Purpose-built for evaluating NameRes as a real autocomplete (the primary way the Translator UI uses it).

- **Live-as-you-type**: every keystroke re-queries after a configurable debounce (0/150/300/500 ms); in-flight requests are aborted via `AbortController` so stale responses never render
- **Preset dropdown**: one-click switches between the three Translator UI query shapes — Disease (`DiseaseOrPhenotypicFeature` + `only_prefixes=MONDO|HP`), Gene, Small Molecule — plus Custom. Presets only set `biolink_type` and `only_prefixes`; every other field stays user-editable
- **Advanced options**: debounce, autocomplete flag, highlighting toggle, exclude_prefixes, only_taxa (collapsed by default, auto-opens when any non-default is set)
- **Latency badges**: per-instance response time, with a tooltip noting parallel-contention when comparing multiple environments
- **Match-reason highlighting**: renders NameRes's Solr `highlighting` fragments (`<em>`-wrapped matches) behind a whitelist sanitiser — the only place `v-html` is used in the codebase
- **Single- vs multi-instance views**: one instance → rich ranked table with copy-API-URL per row; multiple → side-by-side comparison table with row/cell styling for missing CURIEs, rank drift, label/types mismatches
- **Expected-CURIE panel**: paste CURIEs you expect to see; "Check" button fires a `limit=100` parallel lookup per instance and shows whether each expected CURIE appears in the top-N (green), top-100 (amber) or is missing (red). Round-trips through URL state for shareable review links
- **Shareable state**: `q`, `preset`, repeated `target`, repeated `expected`, per-field option overrides, non-default `debounce` and `highlight` all encoded in the URL

## Development

```bash
cd web
npm install
npm run dev
```

This starts a local dev server at `http://localhost:4321/babel-explorer/`.

## Testing

```bash
npm test            # Run all Vitest unit + component tests (~275 tests across lib and components)
npm run test:watch  # Watch mode
```

Tests are co-located with source in `__tests__/` directories. See [`web/tests/README.md`](tests/README.md) for the full test plan, fixture catalogue, and future improvements.

## Building

```bash
npm run build
```

Output goes to `web/dist/`. This is a fully static site that can be served from any web server or GitHub Pages.

## Deployment

The built site will be deployed to the `gh-pages` branch via GitHub Actions (triggered on new releases). GitHub Pages will serve it at `https://TranslatorSRI.github.io/babel-explorer/`. See `web/FUTURE.md` for the GitHub Actions workflow (not yet implemented).

## Shared Configuration

Deployment URLs for NodeNorm and NameRes are defined once in `config/translator-endpoints.json` at the repo root, shared by both frontends and the CLI. The Python frontend's `NodeNorm.URLs` dict is loaded from this file at startup. The Astro frontend imports it at build time.

CURIE link-outs use the [biolink-model prefix map](https://github.com/biolink/biolink-model), fetched at runtime from GitHub and cached. The biolink model version is configurable in `src/lib/curie-links.ts` (currently v4.3.7).

## Architecture

Each tool is an Astro page that hosts a Vue 3 island via `client:only="vue"`. This means:
- Astro handles page routing and the shared layout (navbar, Bootstrap CDN)
- Vue handles all interactivity within a tool (form state, API calls, result rendering)
- No server-side rendering of Vue components (everything is client-side)

```
src/
  layouts/BaseLayout.astro          # Bootstrap CDN + dark navbar
  pages/
    index.astro                     # Landing page with tool cards
    nodenorm.astro                  # Hosts NodeNormApp Vue island
    nameres.astro                   # Hosts NameResApp Vue island
    autocomplete.astro              # Hosts AutocompleteApp Vue island
  components/
    Navbar.astro                    # Shared navbar (Astro component)
    nodenorm/                       # NodeNorm Vue components (App, Form, ComparisonView, CurieDetailPanel, CurieResultCard, ResultsSummary, EquivalentIdTable, ColumnVisibility)
    nameres/                        # NameRes Vue components (App, Form, ComparisonView, DetailPanel, ResultsSummary)
    autocomplete/                   # Autocomplete Vue components (App, Form, Results, ComparisonView, HighlightedFragment, ExpectedCuriePanel, LatencyBadge)
    shared/
      InstanceSelector.vue          # Env checkboxes + custom URL + localStorage prefs (used by all tools)
      CurieLink.vue                 # CURIE → external URL link
      BiolinkTypeLink.vue           # Biolink type → link to biolink.github.io/biolink-model/{Type}; accepts both "biolink:Gene" and "Gene"
  lib/
    nodenorm-api.ts                 # NodeNorm API fetch wrapper (supports AbortSignal)
    nameres-api.ts                  # NameRes /lookup wrapper; parseSearchTerms; validateExpectedCuries
    nameres-types.ts                # NameRes TypeScript interfaces + DEFAULT_NAMERES_OPTIONS
    nameres-url-state.ts            # NameRes URL-state encode/decode
    autocomplete-url-state.ts       # Autocomplete URL-state encode/decode + DEFAULT_AUTOCOMPLETE_OPTIONS + parseExpectedCuries
    autocomplete-presets.ts         # Disease/Gene/SmallMolecule/Custom presets + detectPreset
    autocomplete-diff.ts            # Cross-instance diff signals + expected-CURIE classification
    debounce.ts                     # debounce(fn, ms) with .cancel() and synchronous 0-ms path
    highlight-sanitize.ts           # Whitelist sanitizer — allow only <em>/</em>
    instance-prefs.ts               # sessionPrefs + localStorage helpers
    curie-links.ts                  # Biolink prefix map loader
    url-state.ts                    # NodeNorm URL-state encode/decode
    types.ts                        # NodeNorm TypeScript interfaces
```

## Adding a New Tool

1. Create a new Astro page in `src/pages/` (e.g. `test-concord.astro`)
2. Create a root Vue island component in `src/components/<tool-name>/`
3. Add a nav link in `src/components/Navbar.astro`
4. Add a card on the landing page in `src/pages/index.astro`
5. If the tool needs deployment URLs, import from `config/translator-endpoints.json`
