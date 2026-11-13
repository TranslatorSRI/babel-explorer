# Babel Explorer Web Frontend (GitHub Pages)

This is the **static frontend** for Babel Explorer, built with [Astro](https://astro.build/) and [Vue 3](https://vuejs.org/). It hosts browser-only tools that call public Translator APIs directly — no backend server required. It is served at <https://translatorsri.github.io/babel-explorer/>.

## Where this fits

The Python package in `src/` is a CLI over Babel's multi-gigabyte Parquet files. This site covers the other half: tools that only need a public API (NodeNorm, NameRes) and so can run entirely in the browser.

A server-side JSON API over the Python code, so that `xrefs`/`ids`/`test-concord` can run against a copy of the Parquet files on our Kubernetes cluster, is planned in [#9](https://github.com/TranslatorSRI/babel-explorer/issues/9). Those tools will then appear here as further pages that call that API, so there is one UI and one navbar.

## Current Features

### NodeNorm Lookup (`/nodenorm`)

- **Bulk normalization**: Enter multiple CURIEs, toggle API options (conflation, descriptions, taxa)
- **Unified instance selection**: Checkboxes for known NodeNorm deployments (Dev, Exp, CI, Test, Prod) plus any number of custom http(s) URLs, each with its own checkbox; any combination can be queried together. A selection you make is remembered for the tab's session (in `sessionStorage`, since each tool is a separate page load; opening a share link does not overwrite it) and can be saved as a default; environments carry over between tools, while custom URLs stay with the tool they were added in, so a custom NodeNorm server is never queried as NameRes
- **Comparison table**: Results shown as a table — rows = CURIEs, columns = selected instances; rows highlighted amber when instances disagree on preferred ID
- **Expandable row detail**: Click any CURIE row to reveal per-instance panels showing description, biolink types, IC score, and equivalent identifiers (prefix summary + expand/collapse for large cliques)
- **Column visibility**: Toggle biolink type, taxa, description columns page-wide
- **Unified summary**: Stat tiles above the table — normalized count (with partial/not-found detail), disagreement count across instances, and biolink type frequency badges
- **Shareable URLs**: Query state encoded in the URL fragment (`#curie=`, `target=`, any non-default option the form offers; `individual_types` is always on and never read from a link), so long CURIE lists never reach a server URL limit; older `?curie=` links still load; Share button copies link to clipboard; auto-submits on page load when URL contains CURIEs
- **CURIE link-outs**: Identifiers link to external resources via the [biolink-model prefix map](https://github.com/biolink/biolink-model), at the release named in `src/lib/biolink-prefix-map.version`

### NameRes Lookup (`/nameres`)

- **Batch name → CURIE resolution**: Enter multiple search terms (one per line), see ranked results per instance
- **Expected-CURIE validation**: Annotate any line with `[[CURIE]]` to mark expected results; validation reports success/partial/failure with the rank of the best match, configurable via a "fail if in top N" threshold, which follows the Limit until it is set and may not exceed it
- **Multi-instance comparison**: Same unified instance selector as NodeNorm
- **API tuning**: `biolink_type`, `only_prefixes`, `exclude_prefixes`, `only_taxa` exposed in the form; limit and autocomplete mode toggles; JSON export
- **Shareable URLs**: Query state in the URL fragment (`#term=`, `target=`, non-default options and threshold), like NodeNorm, so a long annotated term list never reaches a server URL limit; older `?term=` links still load; a pasted link or Back re-runs the query without a reload

### Autocomplete Playground (`/autocomplete`)

Purpose-built for evaluating NameRes as a real autocomplete (the primary way the Translator UI uses it).

- **Live-as-you-type**: every keystroke re-queries after a configurable debounce (0/150/300/500 ms); in-flight requests are aborted via `AbortController` so stale responses never render
- **Preset dropdown**: one-click switches between the three Translator UI query shapes — Disease (`DiseaseOrPhenotypicFeature` + `only_prefixes=MONDO|HP`), Gene, Small Molecule — plus Custom. Presets only set `biolink_type` and `only_prefixes`; every other field stays user-editable
- **Advanced options**: debounce, autocomplete flag, highlighting toggle (sends `highlighting=true`; off leaves it out, so the latency badges time a plain request), exclude_prefixes, only_taxa (collapsed by default, auto-opens when any non-default is set)
- **Latency badges**: per-instance response time, with a tooltip noting parallel-contention when comparing multiple environments
- **Match-reason highlighting**: renders NameRes's `highlighting` fragments — HTML-encoded Solr output with each match in `<strong>` — as `<mark>`, escaping everything else; the only place `v-html` is used in the codebase. NameRes returns them only when asked (`highlighting=true`), and an empty `{}` otherwise
- **Single- vs multi-instance views**: one instance → rich ranked table with copy-API-URL per row; multiple → side-by-side comparison table with row/cell styling for missing CURIEs, rank drift, label/types mismatches; each column header has an `API↗` link to the raw NameRes JSON for that instance
- **Biolink type display**: the left-hand CURIE column shows the most specific Biolink type as a badge (linked to biolink.github.io/biolink-model); when instances disagree, all distinct types are shown and the type is repeated per-cell for easy comparison
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
npm test            # Run the Vitest unit + component tests
npm run test:watch  # Watch mode
npm run typecheck   # vue-tsc over the .ts and .vue files
npm run test:live   # Contract tests against live NodeNorm and NameRes (not in npm test)
npm run test:e2e    # Playwright tests of a local build; SITE_URL=… tests a deployment
```

Tests are co-located with source in `__tests__/` directories and run in CI (the `web` job in `.github/workflows/ci.yml`), along with the type check. Vitest and the Astro build strip types without checking them, so a type error passes both; only `npm run typecheck` catches it. TypeScript stays on 5.x because Astro's `tsconfck` requires `^5.0.0`. See [`web/tests/README.md`](tests/README.md) for the fixture catalogue and how to regenerate it, and its "Live checks" section for the two live suites and the daily workflow that runs them.

## Building

```bash
npm run build
```

Output goes to `web/dist/`. This is a fully static site that can be served from any web server or GitHub Pages.

## Deployment

`.github/workflows/deploy.yml` builds the site and pushes it to the `gh-pages` branch on every push to `main` that touches `web/` or `config/`, on published releases, and on demand (`workflow_dispatch`). GitHub Pages serves it at `https://translatorsri.github.io/babel-explorer/`.
Each deploy replaces `gh-pages` with exactly that build (`force_orphan: true`), so a file the
site no longer produces is removed. Every page therefore has to be built from `main`: a tool
deployed to `gh-pages` from another branch disappears at the next deploy from `main`.
Deploys run one at a time (a `pages` concurrency group), so two cannot push to `gh-pages`
together; a deploy that arrives while one is running waits, and only the newest waiting one runs.

## Shared Configuration

Deployment URLs for NodeNorm and NameRes are defined once in `config/translator-endpoints.json` at the repo root. The Astro frontend imports it at build time; the planned server API will read the same file, so a new deployment is added in one place.

Instance keys: NodeNorm has `dev`, `exp`, `ci`, `test`, `prod`, all of CI onwards on ElasticSearch; NameRes has `dev`, `exp`, `ci` (Solr), `es_ci`, `test`, `prod`. `es_ci` is the ElasticSearch rewrite of NameRes, being tested and improved in CI before it is published, so the two services' `ci` keys point at different backends. Saved defaults and `#target=` links are shared by every tool, so a key the current service lacks (`es_ci` in NodeNorm) is ignored rather than treated as a custom URL — `resolveTarget()` in `src/lib/instances.ts`. So is a retired key, such as NodeNorm's former `redis_ci`, that an old saved default or link still names.

Comparison tables always list instances in pipeline order (Exp, Dev, CI, ES CI, Test, Prod, then custom URLs). To add a named instance: (1) add its URL to `config/translator-endpoints.json`; (2) if its key is new, add one entry to `ENVIRONMENTS` in `src/lib/instances.ts`, at its place in the pipeline. That entry holds everything else: its result-table label, its selector label (and any word in it to show as an `<abbr>`), and whether it is primary, i.e. shown without expanding "Extended environments". A test in `instances.test.ts` fails if the config names a key `ENVIRONMENTS` lacks.

CURIE link-outs use the [biolink-model prefix map](https://github.com/biolink/biolink-model), vendored as `src/lib/biolink-prefix-map.json` and bundled at build time. It is an exact copy of one release, named in `src/lib/biolink-prefix-map.version`; update both with `npm run update-prefix-map` (latest release) or `npm run update-prefix-map -- <tag>`.

`.github/workflows/update-prefix-map.yml` runs that script every Monday and, when the map changes, opens or updates a draft PR from `bot/biolink-prefix-map` whose description lists the added, changed and (first) removed prefixes. A removed prefix that NodeNorm still emits loses its link-out, so read that list before merging. The job runs the tests, the type check and the build itself, because a PR opened with `GITHUB_TOKEN` does not trigger `ci.yml`.

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
    nodenorm/                       # NodeNorm Vue components
      NodeNormApp.vue               # Root island: orchestrates form + results
      NodeNormForm.vue              # CURIE input, InstanceSelector, API options
      ComparisonView.vue            # Results table with expandable per-CURIE rows
      CurieDetailPanel.vue          # Detail body: description, types, IC, equiv IDs table
      ResultsSummary.vue            # Stat tiles: normalized count, disagreements, type badges
      EquivalentIdTable.vue         # Equiv ID table with togglable columns
      ColumnVisibility.vue          # Column show/hide controls
    nameres/                        # NameRes Vue components (App, Form, ComparisonView, DetailPanel, ResultsSummary)
    autocomplete/                   # Autocomplete Vue components (App, Form, Results, ComparisonView, HighlightedFragment, ExpectedCuriePanel, LatencyBadge)
    shared/
      InstanceSelector.vue          # Deployment checkboxes + custom URLs, shared by every tool
      CurieLink.vue                 # CURIE → external URL link
      BiolinkTypeLink.vue           # Biolink type badge → biolink-model docs
  lib/
    nodenorm-api.ts                 # NodeNorm API fetch wrapper (batched, bounded concurrency, AbortSignal)
    instances.ts                    # Target (env key or URL) → instance URL, for every service; the one http(s) check; pipeline order
    curie-links.ts                  # CURIE → URL via the vendored biolink prefix map
    url-state.ts                    # Encode/decode NodeNorm query state in the URL fragment
    types.ts                        # NodeNorm TypeScript interfaces
    nameres-api.ts                  # NameRes /lookup wrapper (bounded concurrency, AbortSignal); parseSearchTerms; validateExpectedCuries
    nameres-types.ts                # NameRes interfaces and default options
    nameres-url-state.ts            # Encode/decode NameRes query state in the URL fragment
    instance-prefs.ts               # Session and saved selection; initialSelection, the starting instances
    use-share-link.ts               # The Share button: copy the page URL, report success or failure
    autocomplete-url-state.ts       # Encode/decode Autocomplete query state
    autocomplete-presets.ts         # Disease/Gene/SmallMolecule/Custom presets + detectPreset
    autocomplete-diff.ts            # Presence/rank/label/type diffs across instances
    debounce.ts                     # debounce(fn, ms) with .cancel()
    highlight-sanitize.ts           # Renders NameRes highlighting fragments (<strong> marks → <mark>, all else escaped)
```

## Adding a New Tool

1. Create a new Astro page in `src/pages/` (e.g. `test-concord.astro`)
2. Create a root Vue island component in `src/components/<tool-name>/`
3. Add a nav link in `src/components/Navbar.astro`
4. Add a card on the landing page in `src/pages/index.astro`
5. If the tool needs deployment URLs, build its instance list with `buildInstances` from `config/translator-endpoints.json`, and select instances with `InstanceSelector`. Start a link-driven query from `initialSelection`, so it runs against the instances the form shows ticked, and resolve every target through `instances.ts`, so an unusable one is reported rather than fetched
