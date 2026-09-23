# Future Work

Features and improvements deferred from the initial implementation.

## NodeNorm Tool

### Deep Diff in Comparison View
The current comparison view shows preferred ID, label, types, and equiv count per instance. A deeper diff would show:
- Which equivalent identifiers were added/removed between instances
- Label changes for the same identifier
- Type reclassifications
- Side-by-side diff view with expandable details per CURIE

### URL State Persistence
Encode form state (CURIEs, selected instance, API options) in URL query parameters so results are shareable and bookmarkable. This would also enable linking directly to a comparison.

### CSV/TSV Export
Add download buttons for results. Use Blob URLs for client-side file generation.

### Keyboard Navigation
- Arrow keys to navigate between accordion cards
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
- **NameRes Lookup**: Name resolution using the NameRes API (also CORS-enabled)
- **Node Annotator**: Annotation lookup via the Node Annotator API

### Pinia Store
If multiple tool pages need shared state (e.g. a shared CURIE list across tools), migrate from component-local `ref()`/`reactive()` to a Pinia store.

### Testing
Vitest unit and component tests are implemented (see `web/tests/README.md`). Future testing work:
- **Playwright E2E tests** for full-page interaction (form submission, accordion, Bootstrap JS)
- **Integration tests** calling live NodeNorm API to verify response parsing end-to-end
- **Coverage thresholds** via `vitest --coverage`
- **NodeNormForm / NodeNormApp tests** — form validation, orchestration logic, error states

### CORS Proxy Fallback
If any NodeNorm instance blocks browser requests, add an optional lightweight CORS proxy mode (configurable in the UI).

### Dark Mode
Full dark theme beyond just the navbar, using Bootstrap's `data-bs-theme="dark"`.

### Server-backed tools
Once the JSON API over the Python CLI exists (#9), add XRefs, IDs and Test Concordance pages here that call it, with an instance selector for which server to query.
