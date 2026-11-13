import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests of the site (`npm run test:e2e`), against real NodeNorm and NameRes.
 *
 * With SITE_URL set they test that deployment, e.g. the published site:
 *   SITE_URL=https://translatorsri.github.io/babel-explorer/ npm run test:e2e
 * Without it they build this checkout and test `astro preview`. Either way the URL must
 * end in "/" and the specs use relative paths ("nodenorm/"), because the site lives
 * under Astro's `base` (/babel-explorer/), not at the root.
 *
 * See "Live checks" in web/tests/README.md.
 */
const siteUrl = process.env.SITE_URL;
const baseURL = siteUrl
  ? siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`
  : 'http://localhost:4321/babel-explorer/';

export default defineConfig({
  testDir: 'e2e',
  // All generated output goes under reports/, which .gitignore ignores as a whole.
  outputDir: 'reports/test-results',
  // Every spec queries live services; a slow instance is not a failure of the site.
  timeout: 120_000,
  expect: { timeout: 70_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'reports/playwright' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: siteUrl
    ? undefined
    : {
        command: 'npm run build && npm run preview -- --port 4321',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
