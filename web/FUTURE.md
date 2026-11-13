# Future Work

Features and improvements deferred from the initial implementation.

## NodeNorm Tool

### Deep Diff in Comparison View
The current comparison view shows preferred ID, label, types, and equiv count per instance. A deeper diff would show:
- Which equivalent identifiers were added/removed between instances
- Label changes for the same identifier
- Type reclassifications
- Side-by-side diff view with expandable details per CURIE

### CSV/TSV Export
Add download buttons for results. Use Blob URLs for client-side file generation.

### Keyboard Navigation
- Arrow keys to navigate between comparison rows
- Enter to expand/collapse
- Ctrl+A to expand all / collapse all

### Batch Size Limits
For very large CURIE lists (100+), consider:
- Chunked API calls to avoid URL length limits
- Progress indicator showing how many chunks have completed
- Streaming results as they arrive

## General

### Additional Tools
- **Test Concordance**: Compare equivalence cliques across NodeNorm instances
- **Node Annotator**: Annotation lookup via the Node Annotator API

### Pinia Store
If multiple tool pages need shared state (e.g. a shared CURIE list across tools), migrate from component-local `ref()`/`reactive()` to a Pinia store.

### Testing
Vitest unit and component tests are implemented (see `web/tests/README.md`). Future testing work:
- **Broader Playwright coverage**: the live checks (see `web/tests/README.md`) drive each tool from a share link; form submission, row expansion and column toggles are untested in a browser
- **Run the browser tests on PRs** against a local build, once a way to keep a live-service outage from failing an unrelated PR is settled
- **Coverage thresholds** via `vitest --coverage`
- **NodeNormForm / NodeNormApp tests** — form validation, orchestration logic, error states
- **Snapshot tests** once component markup stabilizes

### CORS Proxy Fallback
If any NodeNorm instance blocks browser requests, add an optional lightweight CORS proxy mode (configurable in the UI).

### Dark Mode
Full dark theme beyond just the navbar, using Bootstrap's `data-bs-theme="dark"`.

### Server-backed tools
Once the JSON API over the Python CLI exists (#9), add XRefs, IDs and Test Concordance pages here that call it, with an instance selector for which server to query.
