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
Add download buttons for results, matching the CSV export pattern from the Python frontend. Use Blob URLs for client-side file generation.

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
- **Vitest** for unit tests (API client, CURIE parsing, prefix map logic)
- **Playwright** for E2E tests (form submission, result rendering, comparison mode)

### GitHub Actions Deployment
CI workflow that builds the Astro site and deploys to the `gh-pages` branch on push to `main` or on new releases.

### CORS Proxy Fallback
If any NodeNorm instance blocks browser requests, add an optional lightweight CORS proxy mode (configurable in the UI).

### Dark Mode
Full dark theme beyond just the navbar, using Bootstrap's `data-bs-theme="dark"`.

### Shared CSS Between Frontends
Extract common Bootstrap customizations (if any) into a shared CSS file that both the Python and Astro frontends can reference.
