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

/** How the site shows one named environment. */
export interface EnvironmentInfo {
  /** Ends the instance's name in result tables: "NameRes Dev". */
  label: string;
  /** The instance selector's label, which names the host: "RENCI Dev", "ITRB CI". */
  selectorLabel: string;
  /** A word in selectorLabel the selector wraps in <abbr>, with this title. */
  abbr?: { text: string; title: string };
  /** Shown in the selector without expanding "Extended environments". */
  primary: boolean;
}

/**
 * Every named environment, in pipeline order (Exp → Dev → CI → ES CI → Redis CI → Test →
 * Prod). config/translator-endpoints.json says which environments each service has and
 * where they are; this says how to show and order them. Adding an environment means its
 * URL there and one entry here — a test fails if the config names an environment this
 * table lacks. Each service has only one of es_ci and redis_ci.
 */
export const ENVIRONMENTS: Record<string, EnvironmentInfo> = {
  exp: { label: 'Exp', selectorLabel: 'RENCI Experimental', primary: false },
  dev: { label: 'Dev', selectorLabel: 'RENCI Dev', primary: true },
  ci: { label: 'CI', selectorLabel: 'ITRB CI', primary: true },
  es_ci: {
    label: 'ES CI',
    selectorLabel: 'ITRB ES CI',
    abbr: { text: 'ES', title: 'ElasticSearch' },
    primary: true,
  },
  redis_ci: { label: 'Redis CI', selectorLabel: 'ITRB Redis CI', primary: true },
  test: { label: 'Test', selectorLabel: 'ITRB Test', primary: false },
  prod: { label: 'Production', selectorLabel: 'ITRB Prod', primary: true },
};

/** Pipeline order of the known environments; anything else is a custom URL. */
const ENV_ORDER = Object.keys(ENVIRONMENTS);

function envOrder(env: string): number {
  const i = ENV_ORDER.indexOf(env);
  return i === -1 ? ENV_ORDER.length : i;
}

/**
 * Sort instances into pipeline order (see ENVIRONMENTS), then custom URLs, alphabetically
 * by URL for stability.
 */
export function sortInstances<T extends Instance>(instances: T[]): T[] {
  return [...instances].sort((a, b) => {
    const oa = envOrder(a.env);
    const ob = envOrder(b.env);
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
    name: `${service} ${ENVIRONMENTS[env]?.label ?? env}`,
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
