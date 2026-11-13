import { test as base, expect } from '@playwright/test';

/**
 * A `page` that fails its test on any console error or failed request to the site
 * itself. A CORS refusal, a script that throws, or an `_astro/` bundle missing after a
 * deploy all show up here, often before any assertion about the page's content would.
 */
export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const problems: string[] = [];
    const site = new URL(baseURL!).origin;
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`uncaught: ${err.message}`));
    page.on('response', (resp) => {
      if (resp.url().startsWith(site) && resp.status() >= 400) {
        problems.push(`HTTP ${resp.status()} for ${resp.url()}`);
      }
    });
    page.on('requestfailed', (req) => {
      // A lookup the page aborts on purpose (a newer query replaced it) is not a failure.
      if (req.failure()?.errorText.includes('ERR_ABORTED')) return;
      problems.push(`request failed: ${req.url()} (${req.failure()?.errorText})`);
    });

    await use(page);

    expect(problems, 'problems while the page ran').toEqual([]);
  },
});

export { expect };
