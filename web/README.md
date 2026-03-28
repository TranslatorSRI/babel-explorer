# Babel Explorer Web Frontend (GitHub Pages)

This is the **static frontend** for Babel Explorer, built with [Astro](https://astro.build/) and [Vue 3](https://vuejs.org/). It hosts browser-only tools that call public APIs directly — no backend server required.

## Dual-Frontend Architecture

babel-explorer has **two** web frontends:

| Frontend | Stack | Deployment | Tools | Directory |
|----------|-------|------------|-------|-----------|
| **This one** | Astro + Vue 3 | GitHub Pages | NodeNorm (more planned) | `web/` |
| **Python frontend** | FastAPI + htmx | Kubernetes | XRefs, IDs, Test Concordance, NodeNorm | `src/babel_explorer/web/` |

The split follows data dependencies: tools that only call external APIs (NodeNorm, NameRes) can run entirely in the browser. Tools that query multi-GB Parquet files via DuckDB need a server.

Both frontends share the same Bootstrap 5 dark-navbar styling for visual consistency. The long-term vision is a unified navigation bar with tabs that seamlessly link between the two sites — some tools on GitHub Pages, others on the Kubernetes server.

## Current Features

### NodeNorm Lookup (`/nodenorm`)

- **Bulk normalization**: Enter multiple CURIEs, toggle API options (conflation, descriptions, individual types, taxa)
- **Adaptive result display**: Accordion cards per CURIE; full equiv ID table for ≤10 identifiers, prefix summary + expand for larger cliques
- **Column visibility**: Toggle biolink type, taxa, description columns page-wide
- **Summary card**: Aggregate stats — normalization success rate, shared biolink types, type breakdown
- **Multi-instance comparison**: Side-by-side comparison across NodeNorm deployments (Dev, Exp, CI, Test, Prod) with difference highlighting
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
npm test            # Run all 60 Vitest unit + component tests
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
  components/
    Navbar.astro                    # Shared navbar (Astro component)
    nodenorm/                       # NodeNorm Vue components
      NodeNormApp.vue               # Root island: orchestrates form + results
      NodeNormForm.vue              # CURIE input, instance selection, API options
      NodeNormResults.vue           # Summary + accordion of result cards
      CurieResultCard.vue           # Per-CURIE accordion card
      EquivalentIdTable.vue         # Equiv ID table with togglable columns
      ColumnVisibility.vue          # Column show/hide controls
      SummaryCard.vue               # Aggregate stats
      ComparisonView.vue            # Side-by-side multi-instance table
    shared/
      CurieLink.vue                 # CURIE → external URL link
  lib/
    nodenorm-api.ts                 # NodeNorm API fetch wrapper
    curie-links.ts                  # Biolink prefix map loader
    types.ts                        # TypeScript interfaces
```

## Adding a New Tool

1. Create a new Astro page in `src/pages/` (e.g. `test-concord.astro`)
2. Create a root Vue island component in `src/components/<tool-name>/`
3. Add a nav link in `src/components/Navbar.astro`
4. Add a card on the landing page in `src/pages/index.astro`
5. If the tool needs deployment URLs, import from `config/translator-endpoints.json`
