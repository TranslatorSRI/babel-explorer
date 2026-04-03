import type { NameResApiOptions } from './nameres-types';
import { DEFAULT_NAMERES_OPTIONS } from './nameres-types';

/** Parsed state from URL query parameters for NameRes. */
export interface NameResQueryState {
  /** Raw search term lines (with [[CURIE]] annotations preserved). */
  terms: string[];
  /** Target identifiers: env keys (dev, exp, ci, test, prod) or full URLs. */
  targets: string[];
  /** API options that differ from defaults. */
  options: Partial<NameResApiOptions>;
  /** "Fail if in top" threshold, if explicitly set. */
  threshold?: number;
}

const STRING_OPTION_KEYS: (keyof NameResApiOptions)[] = [
  'biolink_type',
  'only_prefixes',
  'exclude_prefixes',
  'only_taxa',
];

/**
 * Read the current URL's query params and return the encoded NameRes query state.
 */
export function readNameResQueryState(): NameResQueryState {
  const params = new URLSearchParams(window.location.search);

  const terms = params.getAll('term');
  const targets = params.getAll('target');

  const options: Partial<NameResApiOptions> = {};

  const limitVal = params.get('limit');
  if (limitVal !== null) {
    const parsed = parseInt(limitVal, 10);
    if (!isNaN(parsed)) options.limit = parsed;
  }

  const autoVal = params.get('autocomplete');
  if (autoVal !== null) {
    options.autocomplete = autoVal !== 'false';
  }

  for (const key of STRING_OPTION_KEYS) {
    const val = params.get(key);
    if (val !== null) {
      (options as Record<string, unknown>)[key] = val;
    }
  }

  let threshold: number | undefined;
  const threshVal = params.get('threshold');
  if (threshVal !== null) {
    const parsed = parseInt(threshVal, 10);
    if (!isNaN(parsed)) threshold = parsed;
  }

  return { terms, targets, options, threshold };
}

/**
 * Build a shareable relative URL for the current NameRes query.
 *
 * Only includes options that differ from DEFAULT_NAMERES_OPTIONS.
 */
export function buildNameResQueryUrl(
  terms: string[],
  targets: string[],
  options: NameResApiOptions,
  threshold?: number,
): string {
  const params = new URLSearchParams();

  for (const term of terms) {
    params.append('term', term);
  }
  for (const target of targets) {
    params.append('target', target);
  }

  if (options.limit !== DEFAULT_NAMERES_OPTIONS.limit) {
    params.set('limit', String(options.limit));
  }
  if (options.autocomplete !== DEFAULT_NAMERES_OPTIONS.autocomplete) {
    params.set('autocomplete', String(options.autocomplete));
  }
  for (const key of STRING_OPTION_KEYS) {
    if (options[key] !== DEFAULT_NAMERES_OPTIONS[key]) {
      params.set(key, options[key] as string);
    }
  }

  // Only include threshold if it differs from limit (the default behavior)
  if (threshold !== undefined && threshold !== options.limit) {
    params.set('threshold', String(threshold));
  }

  const qs = params.toString();
  return qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
}
