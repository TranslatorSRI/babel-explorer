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
    // An exact origin match: a prefix match would count localhost:43210 as localhost:4321.
    const isSite = (url: string) => URL.canParse(url) && new URL(url).origin === site;
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      // Chrome logs "Failed to load resource" for any host's 4xx/5xx; on another host
      // (the CDN, NodeNorm, NameRes) that is its outage, not the site's. A CORS refusal
      // logs its own "blocked by CORS policy" error, which is still caught.
      if (msg.text().startsWith('Failed to load resource') && !isSite(msg.location().url)) {
        return;
      }
      problems.push(`console error: ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`uncaught: ${err.message}`));
    page.on('response', (resp) => {
      if (isSite(resp.url()) && resp.status() >= 400) {
        problems.push(`HTTP ${resp.status()} for ${resp.url()}`);
      }
    });
    page.on('requestfailed', (req) => {
      // Another host's failure is its outage; see the console handler above. That
      // includes the NodeNorm and NameRes fetches a page aborts when a newer query
      // replaces one, so those need no exemption of their own: the pages fetch nothing
      // from the site's origin, where any failure, aborted or not, is a broken page.
      if (!isSite(req.url())) return;
      problems.push(`request failed: ${req.url()} (${req.failure()?.errorText})`);
    });

    await use(page);

    expect(problems, 'problems while the page ran').toEqual([]);
  },
});

export { expect };
