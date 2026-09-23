import { ref } from 'vue';

const STORAGE_KEY = 'babel-explorer:instance-prefs';

/**
 * Shared in-memory selection state for the current browser session.
 * Stored as env keys (e.g. ['dev', 'ci']) or raw custom URLs.
 * Cleared on page reload. Updated automatically whenever the user changes
 * instance selection in any tool.
 */
export const sessionPrefs = ref<string[] | null>(null);

/**
 * Save the current instance selection to localStorage and update sessionPrefs.
 * Each item is either an env key ('dev', 'ci', 'prod', …) or a custom URL.
 */
export function savePrefs(selection: string[]): void {
  sessionPrefs.value = [...selection];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
}

/**
 * Load the saved instance selection from localStorage.
 * Returns null if nothing has been saved or the stored value is invalid.
 */
export function loadPrefs(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a target — an env key or a URL — to an instance URL. Returns null
 * for an env key this service does not have: prefs and `?target=` links are
 * shared across tools, and NodeNorm and NameRes do not have the same keys
 * (`redis_ci` vs `es_ci`), so an unknown key must be dropped rather than
 * fetched as if it were a custom URL.
 */
export function resolveTarget(
  instances: { env: string; url: string }[],
  target: string,
): string | null {
  const inst = instances.find((i) => i.env === target || i.url === target);
  if (inst) return inst.url;
  return /^https?:\/\//i.test(target) ? target : null;
}

const ENV_ORDER: Record<string, number> = {
  exp:      0,
  dev:      1,
  ci:       2,
  es_ci:    3,
  redis_ci: 4,
  test:     5,
  prod:     6,
};

/**
 * Sort instances into canonical pipeline order: Exp → Dev → CI → ES CI → Redis CI → Test → Prod → custom URLs.
 * Custom URLs (env not in the known set) sort last, then alphabetically by URL for stability.
 */
export function sortInstances<T extends { env: string; url: string }>(instances: T[]): T[] {
  return [...instances].sort((a, b) => {
    const oa = ENV_ORDER[a.env] ?? 7;
    const ob = ENV_ORDER[b.env] ?? 7;
    if (oa !== ob) return oa - ob;
    return a.url.localeCompare(b.url);
  });
}
