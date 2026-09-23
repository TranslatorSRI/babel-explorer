# Babel Explorer Web Frontend (GitHub Pages)

This is the **static frontend** for Babel Explorer, built with [Astro](https://astro.build/) and [Vue 3](https://vuejs.org/). It hosts browser-only tools that call public Translator APIs directly — no backend server required. It is served at <https://translatorsri.github.io/babel-explorer/>.

## Where this fits

The Python package in `src/` is a CLI over Babel's multi-gigabyte Parquet files. This site covers the other half: tools that only need a public API (NodeNorm, NameRes) and so can run entirely in the browser.

A server-side JSON API over the Python code, so that `xrefs`/`ids`/`test-concord` can run against a copy of the Parquet files on our Kubernetes cluster, is planned in [#9](https://github.com/TranslatorSRI/babel-explorer/issues/9). Those tools will then appear here as further pages that call that API, so there is one UI and one navbar.

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
```

Tests are co-located with source in `__tests__/` directories and run in CI (the `web` job in `.github/workflows/ci.yml`). See [`web/tests/README.md`](tests/README.md) for the fixture catalogue and how to regenerate it.

## Building

```bash
npm run build
```

Output goes to `web/dist/`. This is a fully static site that can be served from any web server or GitHub Pages.

## Deployment

`.github/workflows/deploy.yml` builds the site and pushes it to the `gh-pages` branch on every push to `main` that touches `web/` or `config/`, on published releases, and on demand (`workflow_dispatch`). GitHub Pages serves it at `https://translatorsri.github.io/babel-explorer/`.

## Shared Configuration

Deployment URLs for NodeNorm and NameRes are defined once in `config/translator-endpoints.json` at the repo root. The Astro frontend imports it at build time; the planned server API will read the same file, so a new deployment is added in one place.

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
  components/
    Navbar.astro                    # Shared navbar (Astro component)
    nodenorm/                       # NodeNorm Vue components
      NodeNormApp.vue               # Root island: orchestrates form + results
      NodeNormForm.vue              # CURIE input, checkbox instance selection, custom URL, API options
      ComparisonView.vue            # Results table with expandable per-CURIE rows
      CurieDetailPanel.vue          # Detail body: description, types, IC, equiv IDs table
      CurieResultCard.vue           # Accordion card wrapping CurieDetailPanel
      ResultsSummary.vue            # Stat tiles: normalized count, disagreements, type badges
      EquivalentIdTable.vue         # Equiv ID table with togglable columns
      ColumnVisibility.vue          # Column show/hide controls
    shared/
      CurieLink.vue                 # CURIE → external URL link
      BiolinkTypeLink.vue           # Biolink type badge → biolink-model docs
  lib/
    nodenorm-api.ts                 # NodeNorm API fetch wrapper (supports AbortSignal)
    curie-links.ts                  # Biolink prefix map loader
    url-state.ts                    # Encode/decode query state in URL params
    types.ts                        # TypeScript interfaces
```

## Adding a New Tool

1. Create a new Astro page in `src/pages/` (e.g. `test-concord.astro`)
2. Create a root Vue island component in `src/components/<tool-name>/`
3. Add a nav link in `src/components/Navbar.astro`
4. Add a card on the landing page in `src/pages/index.astro`
5. If the tool needs deployment URLs, import from `config/translator-endpoints.json`
