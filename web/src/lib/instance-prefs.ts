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
 * Sort instances into canonical pipeline order: Exp → Dev → CI → ES CI → Test → Prod → custom URLs.
 * Custom URLs (env not in the known set) sort last, then alphabetically by URL for stability.
 */
export function sortInstances<T extends { env: string; url: string }>(instances: T[]): T[] {
  return [...instances].sort((a, b) => {
    const oa = ENV_ORDER[a.env] ?? 6;
    const ob = ENV_ORDER[b.env] ?? 6;
    if (oa !== ob) return oa - ob;
    return a.url.localeCompare(b.url);
  });
}
