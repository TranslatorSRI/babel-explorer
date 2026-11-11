import type { NodeNormInstance } from './types';

/**
 * Resolving a NodeNorm "target" — an env key such as `prod`, or a full URL — to the
 * instance URL to query.
 *
 * Every path that turns a target into a URL goes through here: the share-link
 * fragment, the "Add custom URL" box and the URL written back to the address bar.
 * Keep it that way. The http(s) check once lived only in the form, so a `#target=`
 * value in a share link skipped it and was fetched on page load.
 */

const ENV_LABELS: Record<string, string> = {
  dev: 'Dev',
  exp: 'Exp',
  ci: 'CI',
  test: 'Test',
  prod: 'Production',
};

/**
 * Canonical form of an instance URL, or null if it is not an absolute http(s) URL.
 *
 * The path always ends in a slash and any fragment is dropped, so
 * `https://nodenorm-es.transltr.io` and `https://nodenorm-es.transltr.io/` compare equal and
 * the same deployment is not queried twice under two spellings.
 */
export function normalizeInstanceUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!URL.canParse(trimmed)) return null;
  const url = new URL(trimmed);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

/** Build the instance list from the `nodenorm` section of translator-endpoints.json. */
export function buildInstances(urlsByEnv: Record<string, string>): NodeNormInstance[] {
  return Object.entries(urlsByEnv).map(([env, url]) => ({
    name: `NodeNorm ${ENV_LABELS[env] ?? env}`,
    env,
    url: normalizeInstanceUrl(url) ?? url,
  }));
}

/** The known instance a target names, by env key or by (normalized) URL. */
export function findInstance(
  instances: NodeNormInstance[],
  target: string,
): NodeNormInstance | undefined {
  const url = normalizeInstanceUrl(target);
  return instances.find((i) => i.env === target || (url !== null && i.url === url));
}

/**
 * The URL to query for a target: a known instance's URL, or the normalized custom URL.
 * Null when the target is neither a known instance nor an http(s) URL.
 */
export function resolveTarget(instances: NodeNormInstance[], target: string): string | null {
  return findInstance(instances, target)?.url ?? normalizeInstanceUrl(target);
}

/** The instance for a resolved URL, inventing a "custom" one for unknown URLs. */
export function instanceForUrl(instances: NodeNormInstance[], url: string): NodeNormInstance {
  return findInstance(instances, url) ?? { name: url, env: url, url };
}

/** The shortest target naming a URL: its env key if known, otherwise the URL itself. */
export function urlToTarget(instances: NodeNormInstance[], url: string): string {
  return findInstance(instances, url)?.env ?? url;
}
