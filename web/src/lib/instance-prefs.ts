import { ref } from 'vue';
import { resolveTargets, type Instance } from './instances';

const STORAGE_KEY = 'babel-explorer:instance-prefs';

/** Environments the instance selector shows without expanding "Extended environments". */
export const PRIMARY_ENVS = new Set(['dev', 'ci', 'prod']);

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
 * Storage can be unavailable (a private window, blocked site data); the session
 * still keeps the choice.
 */
export function savePrefs(selection: string[]): void {
  sessionPrefs.value = [...selection];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Not saved across reloads; nothing else to do.
  }
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
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : null;
  } catch {
    return null;
  }
}

/**
 * The instance URLs a tool starts with, from the first of these that names any usable
 * instance: the page URL's targets, this session's selection, the saved default, and
 * finally the first primary instance.
 *
 * Every source goes through resolveTargets, so a target that is neither a known
 * instance nor an http(s) URL is dropped wherever it came from: a share link, or a
 * value another tool, or an older version of this one, left in storage. Keys a service
 * lacks are dropped too, which is what lets one saved default serve every tool.
 *
 * The app and its form both call this, so the instances a link-driven query runs
 * against are the ones the form shows as ticked.
 */
export function initialSelection(instances: Instance[], targets: string[] = []): string[] {
  for (const source of [targets, sessionPrefs.value ?? [], loadPrefs() ?? []]) {
    const urls = resolveTargets(instances, source);
    if (urls.length > 0) return urls;
  }
  const first = instances.find((i) => PRIMARY_ENVS.has(i.env)) ?? instances[0];
  return first ? [first.url] : [];
}
