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
      if (msg.type() !== 'error') return;
      // Chrome logs "Failed to load resource" for any host's 4xx/5xx; on another host
      // (the CDN, NodeNorm, NameRes) that is its outage, not the site's. A CORS refusal
      // logs its own "blocked by CORS policy" error, which is still caught.
      if (msg.text().startsWith('Failed to load resource') && !msg.location().url.startsWith(site)) {
        return;
      }
      problems.push(`console error: ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`uncaught: ${err.message}`));
    page.on('response', (resp) => {
      if (resp.url().startsWith(site) && resp.status() >= 400) {
        problems.push(`HTTP ${resp.status()} for ${resp.url()}`);
      }
    });
    page.on('requestfailed', (req) => {
      // Another host's failure is its outage; see the console handler above.
      if (!req.url().startsWith(site)) return;
      // A fetch the page aborts on purpose (a newer query replaced it) is not a failure,
      // but an aborted script or stylesheet is a broken page.
      const aborted = req.failure()?.errorText.includes('ERR_ABORTED');
      if (aborted && ['fetch', 'xhr'].includes(req.resourceType())) return;
      problems.push(`request failed: ${req.url()} (${req.failure()?.errorText})`);
    });

    await use(page);

    expect(problems, 'problems while the page ran').toEqual([]);
  },
});

export { expect };
