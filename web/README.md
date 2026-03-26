# Babel Explorer Web Frontend (GitHub Pages)

This is the **static frontend** for Babel Explorer, built with [Astro](https://astro.build/) and [Vue 3](https://vuejs.org/). It hosts browser-only tools that call public APIs directly — no backend server required.

## Dual-Frontend Architecture

babel-explorer has **two** web frontends:

| Frontend | Stack | Deployment | Tools | Directory |
|----------|-------|------------|-------|-----------|
| **This one** | Astro + Vue 3 | GitHub Pages | NodeNorm, Test Concordance | `web/` |
| **Python frontend** | FastAPI + htmx | Kubernetes | XRefs, IDs | `src/babel_explorer/web/` |

The split follows data dependencies: tools that only call external APIs (NodeNorm, NameRes) run entirely in the browser. Tools that query multi-GB Parquet files via DuckDB need a server.

Both frontends share the same Bootstrap 5 dark-navbar styling for visual consistency.

## Development

```bash
cd web
npm install
npm run dev
```

This starts a local dev server at `http://localhost:4321`.

## Building

```bash
npm run build
```

Output goes to `web/dist/`. This is a fully static site that can be served from any web server or GitHub Pages.

## Deployment

The built site is deployed to the `gh-pages` branch via GitHub Actions (triggered on new releases). GitHub Pages serves it at `https://TranslatorSRI.github.io/babel-explorer/`.

## Shared Configuration

Deployment URLs for NodeNorm and NameRes are defined once in `config/translator-endpoints.json` at the repo root, shared by both frontends and the CLI.

CURIE link-outs use the [biolink-model prefix map](https://github.com/biolink/biolink-model), fetched at runtime and cached. The biolink model version is configurable in `src/lib/curie-links.ts`.

## Adding a New Tool

1. Create a new Astro page in `src/pages/` (e.g. `test-concord.astro`)
2. Create Vue components in `src/components/<tool-name>/`
3. Add a nav link in `src/components/Navbar.astro`
4. Add a card on the landing page in `src/pages/index.astro`
