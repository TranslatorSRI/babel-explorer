import { test, expect } from './fixtures';

/**
 * Each tool, opened from a share link against Prod (and CI where comparing), must run
 * its query in a real browser and render the answer. These cover what the contract
 * tests in src/lib/__tests__/*.live.test.ts cannot: the built pages, the deploy, and
 * CORS as a browser enforces it.
 */

for (const path of ['', 'nodenorm/', 'nameres/', 'autocomplete/']) {
  test(`page "${path || '/'}" loads`, async ({ page }) => {
    const resp = await page.goto(path);
    expect(resp?.status()).toBe(200);
    await expect(page.locator('nav')).toBeVisible();
  });
}

test('NodeNorm normalizes a CURIE from a link', async ({ page }) => {
  await page.goto('nodenorm/#curie=MONDO:0004979&target=prod');
  await expect(page.getByRole('table').first()).toContainText('MONDO:0004979');
  await expect(page.getByRole('table').first()).toContainText('asthma');
  await expect(page.locator('.alert-danger')).toHaveCount(0);
});

test('NameRes finds an expected CURIE from a link', async ({ page }) => {
  await page.goto(`nameres/#${new URLSearchParams({ term: 'asthma [[MONDO:0004979]]', target: 'prod' })}`);
  await expect(page.locator('.badge.bg-success').filter({ hasText: '#1' }).first()).toBeVisible();
  await expect(page.locator('.alert-danger')).toHaveCount(0);
});

test('Autocomplete compares instances with highlighting from a link', async ({ page }) => {
  await page.goto('autocomplete/#q=asthm&target=prod&target=ci');
  await expect(page.getByText('Comparison —')).toBeVisible();
  await expect(page.locator('tbody mark').first()).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Autocomplete looks up what is typed', async ({ page }) => {
  await page.goto('autocomplete/#target=prod');
  await page.locator('#ac-query').fill('diabe');
  await expect(page.locator('tbody tr').first()).toContainText(/diabe/i);
  await expect(page.locator('.alert-danger')).toHaveCount(0);
});
