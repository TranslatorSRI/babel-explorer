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
