# Babel Explorer Web Frontend (GitHub Pages)

This is the **static frontend** for Babel Explorer, built with [Astro](https://astro.build/) and [Vue 3](https://vuejs.org/). It hosts browser-only tools that call public Translator APIs directly — no backend server required. It is served at <https://translatorsri.github.io/babel-explorer/>.

## Where this fits

The Python package in `src/` is a CLI over Babel's multi-gigabyte Parquet files. This site covers the other half: tools that only need a public API (NodeNorm, NameRes) and so can run entirely in the browser.

A server-side JSON API over the Python code, so that `xrefs`/`ids`/`test-concord` can run against a copy of the Parquet files on our Kubernetes cluster, is planned in [#9](https://github.com/TranslatorSRI/babel-explorer/issues/9). Those tools will then appear here as further pages that call that API, so there is one UI and one navbar.

## Current Features

### NodeNorm Lookup (`/nodenorm`)

- **Bulk normalization**: Enter multiple CURIEs, toggle API options (conflation, descriptions, taxa)
- **Unified instance selection**: Checkboxes for known NodeNorm deployments (Dev, Exp, CI, Test, Prod) plus a custom URL input; any combination of instances can be queried together
- **Comparison table**: Results shown as a table — rows = CURIEs, columns = selected instances; rows highlighted amber when instances disagree on preferred ID
- **Expandable row detail**: Click any CURIE row to reveal per-instance panels showing description, biolink types, IC score, and equivalent identifiers (prefix summary + expand/collapse for large cliques)
- **Column visibility**: Toggle biolink type, taxa, description columns page-wide
- **Unified summary**: Stat tiles above the table — normalized count (with partial/not-found detail), disagreement count across instances, and biolink type frequency badges
- **Shareable URLs**: Query state encoded in the URL fragment (`#curie=`, `target=`, any non-default option the form offers; `individual_types` is always on and never read from a link), so long CURIE lists never reach a server URL limit; older `?curie=` links still load; Share button copies link to clipboard; auto-submits on page load when URL contains CURIEs
- **CURIE link-outs**: Identifiers link to external resources via the [biolink-model prefix map](https://github.com/biolink/biolink-model), at the release named in `src/lib/biolink-prefix-map.version`

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
```

Tests are co-located with source in `__tests__/` directories and run in CI (the `web` job in `.github/workflows/ci.yml`), along with the type check. Vitest and the Astro build strip types without checking them, so a type error passes both; only `npm run typecheck` catches it. TypeScript stays on 5.x because Astro's `tsconfck` requires `^5.0.0`. See [`web/tests/README.md`](tests/README.md) for the fixture catalogue and how to regenerate it.

## Building

```bash
npm run build
```

Output goes to `web/dist/`. This is a fully static site that can be served from any web server or GitHub Pages.

## Deployment

`.github/workflows/deploy.yml` builds the site and pushes it to the `gh-pages` branch on every push to `main` that touches `web/` or `config/`, on published releases, and on demand (`workflow_dispatch`). GitHub Pages serves it at `https://translatorsri.github.io/babel-explorer/`.
Each deploy copies the build over what is already on `gh-pages` (`keep_files: true`) rather
than replacing the branch, because some tools are deployed there from branches that are not
on `main` yet. Stale files are therefore never removed; see the comment in `deploy.yml` for
when to switch back to `force_orphan`.
Deploys run one at a time (a `pages` concurrency group), so two cannot push to `gh-pages`
together; a deploy that arrives while one is running waits, and only the newest waiting one runs.

## Shared Configuration

Deployment URLs for NodeNorm and NameRes are defined once in `config/translator-endpoints.json` at the repo root. The Astro frontend imports it at build time; the planned server API will read the same file, so a new deployment is added in one place.

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
  components/
    Navbar.astro                    # Shared navbar (Astro component)
    nodenorm/                       # NodeNorm Vue components
      NodeNormApp.vue               # Root island: orchestrates form + results
      NodeNormForm.vue              # CURIE input, checkbox instance selection, custom URL, API options
      ComparisonView.vue            # Results table with expandable per-CURIE rows
      CurieDetailPanel.vue          # Detail body: description, types, IC, equiv IDs table
      ResultsSummary.vue            # Stat tiles: normalized count, disagreements, type badges
      EquivalentIdTable.vue         # Equiv ID table with togglable columns
      ColumnVisibility.vue          # Column show/hide controls
    shared/
      CurieLink.vue                 # CURIE → external URL link
      BiolinkTypeLink.vue           # Biolink type badge → biolink-model docs
  lib/
    nodenorm-api.ts                 # NodeNorm API fetch wrapper (batched, bounded concurrency, AbortSignal)
    instances.ts                    # Target (env key or URL) → instance URL; the one http(s) check
    curie-links.ts                  # CURIE → URL via the vendored biolink prefix map
    url-state.ts                    # Encode/decode query state in URL params
    types.ts                        # TypeScript interfaces
```

## Adding a New Tool

1. Create a new Astro page in `src/pages/` (e.g. `test-concord.astro`)
2. Create a root Vue island component in `src/components/<tool-name>/`
3. Add a nav link in `src/components/Navbar.astro`
4. Add a card on the landing page in `src/pages/index.astro`
5. If the tool needs deployment URLs, import from `config/translator-endpoints.json`
