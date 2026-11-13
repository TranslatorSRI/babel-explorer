/**
 * Resolving a service "target" — an env key such as `prod`, or a full URL — to the
 * instance URL to query, for NodeNorm and NameRes alike.
 *
 * Every path that turns a target into a URL goes through here: share links, saved
 * instance preferences, the "Add custom URL" box and the URL written back to the
 * address bar. Keep it that way. The http(s) check once lived only in the form, so a
 * `#target=` value in a share link skipped it and was fetched on page load.
 */

/**
 * Requests one tool keeps in flight at once against one instance: NodeNorm's batches
 * and NameRes's lookups. A long CURIE list or regression list against every instance
 * would otherwise start dozens or hundreds of requests together, which the browser
 * queues anyway and the servers may answer with HTTP 429 or 503, showing up as failures
 * unrelated to what is being checked. One constant, so the two tools cannot drift apart.
 */
export const MAX_REQUESTS_PER_INSTANCE = 4;

/** A named deployment of a service. NodeNormInstance and NameResInstance are aliases of it. */
export interface Instance {
  name: string;
  env: string;
  url: string;
}

const ENV_LABELS: Record<string, string> = {
  dev: 'Dev',
  exp: 'Exp',
  ci: 'CI',
  es_ci: 'ES CI',
  redis_ci: 'Redis CI',
  test: 'Test',
  prod: 'Production',
};

/** Pipeline order of the known environments; anything else is a custom URL. */
const ENV_ORDER: Record<string, number> = {
  exp: 0,
  dev: 1,
  ci: 2,
  es_ci: 3,
  redis_ci: 4,
  test: 5,
  prod: 6,
};

/**
 * Sort instances into pipeline order: Exp → Dev → CI → ES CI → Redis CI → Test → Prod,
 * then custom URLs, alphabetically by URL for stability.
 */
export function sortInstances<T extends Instance>(instances: T[]): T[] {
  return [...instances].sort((a, b) => {
    const oa = ENV_ORDER[a.env] ?? 7;
    const ob = ENV_ORDER[b.env] ?? 7;
    if (oa !== ob) return oa - ob;
    return a.url.localeCompare(b.url);
  });
}

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

/** Build a service's instance list from its section of translator-endpoints.json. */
export function buildInstances(service: string, urlsByEnv: Record<string, string>): Instance[] {
  return Object.entries(urlsByEnv).map(([env, url]) => ({
    name: `${service} ${ENV_LABELS[env] ?? env}`,
    env,
    url: normalizeInstanceUrl(url) ?? url,
  }));
}

/** The known instance a target names, by env key or by (normalized) URL. */
export function findInstance<T extends Instance>(
  instances: T[],
  target: string,
): T | undefined {
  const url = normalizeInstanceUrl(target);
  return instances.find((i) => i.env === target || (url !== null && i.url === url));
}

/**
 * The URL to query for a target: a known instance's URL, or the normalized custom URL.
 * Null when the target is neither a known instance nor an http(s) URL.
 */
export function resolveTarget(instances: Instance[], target: string): string | null {
  return findInstance(instances, target)?.url ?? normalizeInstanceUrl(target);
}

/**
 * Resolve several targets, dropping any that are neither a known instance nor an
 * http(s) URL, and any that name the same instance twice.
 */
export function resolveTargets(instances: Instance[], targets: string[]): string[] {
  return [
    ...new Set(targets.map((t) => resolveTarget(instances, t)).filter((u): u is string => u !== null)),
  ];
}

/** The instance for a resolved URL, inventing a "custom" one for unknown URLs. */
export function instanceForUrl(instances: Instance[], url: string): Instance {
  return findInstance(instances, url) ?? { name: url, env: url, url };
}

/** The shortest target naming a URL: its env key if known, otherwise the URL itself. */
export function urlToTarget(instances: Instance[], url: string): string {
  return findInstance(instances, url)?.env ?? url;
}
