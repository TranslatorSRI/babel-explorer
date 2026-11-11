// Astro's client types, which bring in Vite's: `?raw` and other asset imports, and
// `import.meta.env`. Astro also writes this reference into .astro/types.d.ts, but that
// file is gitignored and generated only by `astro dev`, `build` or `sync`, so without
// this one `npm run typecheck` passes after a local build and fails on a fresh clone,
// which is how CI runs it (before the build).
/// <reference types="astro/client" />
