import type { NameResResult, NameResApiOptions, ParsedSearchTerm, ExpectedCurieValidation } from './nameres-types';
import { MAX_REQUESTS_PER_INSTANCE } from './instances';

/** The largest Limit or "Fail if in top" value the form accepts. */
export const MAX_RESULT_COUNT = 100;

/**
 * True for a usable Limit or "Fail if in top" value: a whole number from 1 to
 * MAX_RESULT_COUNT. An emptied number input binds as '' through v-model.number, which
 * would otherwise reach the API as `limit=` (a 422 on every lookup) or, as a threshold,
 * make every partial match compare as a failure.
 */
export function isValidResultCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_RESULT_COUNT;
}

/**
 * Parse textarea input into search terms with optional expected CURIEs.
 *
 * Each line becomes one search term. Lines starting with # are comments.
 * Expected CURIEs are annotated with [[CURIE]] notation and stripped from
 * the search text before sending to the API.
 *
 * Example: "asthma [[MONDO:0004979]]" → text="asthma", expectedCuries=["MONDO:0004979"]
 *
 * A line is dropped only when an earlier one has the same search text *and* the same
 * expected CURIEs. Two lines that search for the same text but expect different CURIEs
 * are separate checks, so both are kept; callers look the text up once (see
 * uniqueSearchTexts) and validate each line against the same results.
 */
export function parseSearchTerms(raw: string): ParsedSearchTerm[] {
  const seen = new Set<string>();
  const result: ParsedSearchTerm[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Extract [[CURIE]] annotations. A CURIE annotated twice is expected once: the
    // comparison view keys its badges by CURIE, so a repeat would also give Vue
    // duplicate keys.
    const expectedCuries: string[] = [];
    const annotationRegex = /\[\[([^\]]+)\]\]/g;
    let match;
    while ((match = annotationRegex.exec(trimmed)) !== null) {
      const curie = match[1].trim();
      if (!expectedCuries.includes(curie)) expectedCuries.push(curie);
    }

    // Strip annotations from search text
    const text = trimmed.replace(annotationRegex, '').trim();
    if (!text) continue;

    // Deduplicate by search text and the set of expected CURIEs
    const key = JSON.stringify([text, [...expectedCuries].sort()]);
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({ text, raw: trimmed, expectedCuries });
  }
  return result;
}

/** The distinct search texts among some terms, in first-appearance order. */
export function uniqueSearchTexts(terms: ParsedSearchTerm[]): string[] {
  return [...new Set(terms.map((t) => t.text))];
}

/**
 * How long one lookup may take, from request to parsed body, before it is reported as
 * failed. Without a deadline, an instance that stalls mid-response holds back every
 * other instance's results, since NameResApp waits for all of them. Generous, as
 * NodeNorm's BATCH_TIMEOUT_MS is, so that a slow Solr query is not mistaken for a
 * stalled server.
 */
export const LOOKUP_TIMEOUT_MS = 60_000;

/**
 * The NameRes /lookup URL for one search term. Used both to fetch and to show the user
 * the request that was made, so the two cannot disagree about a parameter.
 */
export function buildLookupUrl(baseUrl: string, text: string, options: NameResApiOptions): URL {
  const url = new URL('lookup', baseUrl);
  url.searchParams.set('string', text);
  url.searchParams.set('limit', String(options.limit));
  url.searchParams.set('autocomplete', String(options.autocomplete));

  if (options.biolink_type) {
    url.searchParams.set('biolink_type', options.biolink_type);
  }
  if (options.only_prefixes) {
    url.searchParams.set('only_prefixes', options.only_prefixes);
  }
  if (options.exclude_prefixes) {
    url.searchParams.set('exclude_prefixes', options.exclude_prefixes);
  }
  if (options.only_taxa) {
    url.searchParams.set('only_taxa', options.only_taxa);
  }
  // NameRes defaults to false, and then returns `highlighting: {}` on every result.
  if (options.highlighting) {
    url.searchParams.set('highlighting', 'true');
  }
  return url;
}

/**
 * Call the NameRes /lookup endpoint for a single search term.
 *
 * A lookup that takes longer than LOOKUP_TIMEOUT_MS fails on its own; the caller's
 * signal is left alone, so the other lookups carry on.
 * @param baseUrl  NameRes instance URL (must end with /)
 * @param text     Search string
 * @param options  API query options
 * @param signal   Optional AbortSignal for cancellation
 * @returns        Array of ranked results
 */
export async function fetchNameResLookup(
  baseUrl: string,
  text: string,
  options: NameResApiOptions,
  signal?: AbortSignal,
): Promise<NameResResult[]> {
  const url = buildLookupUrl(baseUrl, text, options);

  // Linked by hand rather than with AbortSignal.any, which Safari gained only in 17.4.
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  // The body is read under the same signal, so the deadline covers a stalled body too.
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, LOOKUP_TIMEOUT_MS);

  try {
    const resp = await fetch(url.toString(), { signal: controller.signal });
    if (!resp.ok) {
      throw new Error(`NameRes returned HTTP ${resp.status}: ${resp.statusText}`);
    }
    // A 200 that is not a list (an error object from a custom server, a proxy's page)
    // would otherwise be stored as this term's results and crash the views that index
    // into it; as a failed lookup it fails only its own cell.
    const body: unknown = await resp.json();
    if (!Array.isArray(body)) {
      throw new Error('NameRes returned something other than a list of results');
    }
    return body as NameResResult[];
  } catch (err) {
    if (timedOut && !signal?.aborted) {
      throw new Error(`NameRes did not answer within ${LOOKUP_TIMEOUT_MS / 1000} s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Lookups in flight at once per instance (see MAX_REQUESTS_PER_INSTANCE). */
export const MAX_CONCURRENT_LOOKUPS = MAX_REQUESTS_PER_INSTANCE;

/**
 * Look up several texts on one instance, at most MAX_CONCURRENT_LOOKUPS at a time.
 *
 * Returns one settled result per text, in the same order. A failed lookup fails only
 * its own text, so a single 500 does not hide the rest. One GET per text rather than a
 * bulk request: a JSON POST needs a CORS preflight that a custom NameRes URL may not
 * answer, and a bulk request that fails takes every term with it.
 */
export async function fetchNameResLookups(
  baseUrl: string,
  texts: string[],
  options: NameResApiOptions,
  signal?: AbortSignal,
): Promise<PromiseSettledResult<NameResResult[]>[]> {
  const settled: PromiseSettledResult<NameResResult[]>[] = new Array(texts.length);
  let next = 0;
  async function worker() {
    while (next < texts.length) {
      const i = next++;
      // Once stopped, fail the rest without starting them.
      if (signal?.aborted) {
        settled[i] = { status: 'rejected', reason: signal.reason };
        continue;
      }
      try {
        settled[i] = { status: 'fulfilled', value: await fetchNameResLookup(baseUrl, texts[i], options, signal) };
      } catch (reason) {
        settled[i] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_LOOKUPS, texts.length) }, worker));
  return settled;
}

/**
 * Validate expected CURIEs against actual search results.
 *
 * Uses "any match" semantics: success if ANY expected CURIE is the #1 result,
 * partial if any is within the threshold, failure if none found within threshold.
 *
 * @param results         Ranked search results from NameRes
 * @param expectedCuries  Expected CURIEs from [[CURIE]] annotations
 * @param threshold       "Fail if in top" threshold (results checked up to this rank)
 * @returns               Validation result
 */
export function validateExpectedCuries(
  results: NameResResult[],
  expectedCuries: string[],
  threshold: number,
): ExpectedCurieValidation {
  if (expectedCuries.length === 0) {
    return { status: 'none', matchedCurie: '', rank: -1, threshold };
  }

  // Find the best (lowest) rank among all expected CURIEs
  let bestRank = -1;
  let bestCurie = expectedCuries[0];

  for (const expected of expectedCuries) {
    const rank = results.findIndex(r => r.curie === expected);
    if (rank !== -1 && (bestRank === -1 || rank < bestRank)) {
      bestRank = rank;
      bestCurie = expected;
    }
  }

  if (bestRank === 0) {
    return { status: 'success', matchedCurie: bestCurie, rank: 0, threshold };
  }
  if (bestRank > 0 && bestRank < threshold) {
    return { status: 'partial', matchedCurie: bestCurie, rank: bestRank, threshold };
  }
  return { status: 'failure', matchedCurie: bestCurie, rank: bestRank, threshold };
}
