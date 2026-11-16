import { defineConfig } from 'vitest/config';

/**
 * The live contract tests (`npm run test:live`): real requests to the NodeNorm and
 * NameRes deployments in src/lib/__tests__/live.ts. See "Live checks" in
 * web/tests/README.md.
 */
export default defineConfig({
  test: {
    // Node, not happy-dom: real fetch, and nothing here renders.
    environment: 'node',
    include: ['src/**/*.live.test.ts'],
    // Above the request code's own 60 s deadlines (LOOKUP_TIMEOUT_MS, BATCH_TIMEOUT_MS),
    // so a slow server fails with their message rather than a bare test timeout.
    testTimeout: 90_000,
    // One retry absorbs a single dropped connection; a real change fails twice.
    retry: 1,
  },
});
