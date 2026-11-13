/**
 * Shared setup for the live contract tests (`*.live.test.ts`, run by `npm run test:live`
 * and the daily live-check workflow, never by `npm test`). See "Live checks" in
 * web/tests/README.md for what they cover and why.
 */
import { expect } from 'vitest';
import endpoints from '../../../../config/translator-endpoints.json';
import { buildInstances, type Instance } from '../instances';

/**
 * The environments the live checks query: the ones people rely on, and the one that
 * shows a change before it reaches them. Babel Validation's daily dashboard already
 * tests every environment's data, so these tests only check the interface. es_ci is
 * left out until it replaces ci.
 */
export const LIVE_ENVS = ['ci', 'prod'];

/** The site's origin, which every request from the published pages carries. */
export const SITE_ORIGIN = 'https://translatorsri.github.io';

export function liveInstances(service: 'nodenorm' | 'nameres'): Instance[] {
  const label = service === 'nodenorm' ? 'NodeNorm' : 'NameRes';
  return buildInstances(label, endpoints[service]).filter((i) => LIVE_ENVS.includes(i.env));
}

/**
 * Assert that a browser on the published site may read this response. Node's fetch
 * ignores CORS, so without this a server that stopped sending the header would pass
 * every other contract test while every page failed.
 */
export async function expectCorsAllowsSite(url: string): Promise<void> {
  const resp = await fetch(url, { headers: { Origin: SITE_ORIGIN } });
  expect(resp.ok, `HTTP ${resp.status} from ${url}`).toBe(true);
  expect(['*', SITE_ORIGIN]).toContain(resp.headers.get('access-control-allow-origin'));
}
