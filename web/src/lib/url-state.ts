import type { ApiOptions } from './types';
import { DEFAULT_API_OPTIONS } from './types';

/** Parsed state from the URL fragment (or, for older links, the query string). */
export interface QueryState {
  /** CURIEs from repeated ?curie= params. */
  curies: string[];
  /**
   * NodeNorm target identifiers from repeated ?target= params.
   * Each value is either an env key (dev, exp, ci, test, prod)
   * or a full URL for custom instances.
   */
  targets: string[];
  /**
   * API options that differ from defaults.
   * Absent keys should fall back to DEFAULT_API_OPTIONS.
   */
  options: Partial<ApiOptions>;
}

const OPTION_KEYS = Object.keys(DEFAULT_API_OPTIONS) as (keyof ApiOptions)[];

/**
 * Read the query state from the current URL.
 *
 * Share links keep it in the fragment (#curie=…), which browsers never send to the
 * server, so a long CURIE list cannot hit a server's URL length limit. Links from
 * before that change put it in the query string, which is read when there is no
 * fragment. Returns empty arrays and no options if no relevant params are present.
 */
export function readQueryState(): QueryState {
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search);

  const curies = params.getAll('curie');
  const targets = params.getAll('target');

  const options: Partial<ApiOptions> = {};
  for (const key of OPTION_KEYS) {
    const val = params.get(key);
    if (val !== null) {
      options[key] = val !== 'false';
    }
  }

  return { curies, targets, options };
}

/**
 * Build a shareable relative URL for the current query.
 *
 * Uses the current page path (window.location.pathname) so the URL is
 * relative to the deployment base — works both locally and on GitHub Pages.
 *
 * Only API options that differ from DEFAULT_API_OPTIONS are included,
 * keeping shared URLs short when using standard settings.
 */
export function buildQueryUrl(
  curies: string[],
  targets: string[],
  options: ApiOptions,
): string {
  const params = new URLSearchParams();

  for (const curie of curies) {
    params.append('curie', curie);
  }
  for (const target of targets) {
    params.append('target', target);
  }
  for (const key of OPTION_KEYS) {
    if (options[key] !== DEFAULT_API_OPTIONS[key]) {
      params.set(key, String(options[key]));
    }
  }

  const qs = params.toString();
  return qs ? `${window.location.pathname}#${qs}` : window.location.pathname;
}
