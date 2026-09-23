import type { NameResResult, NameResApiOptions, ParsedSearchTerm, ExpectedCurieValidation } from './nameres-types';

/**
 * Parse textarea input into search terms with optional expected CURIEs.
 *
 * Each line becomes one search term. Lines starting with # are comments.
 * Expected CURIEs are annotated with [[CURIE]] notation and stripped from
 * the search text before sending to the API.
 *
 * Example: "asthma [[MONDO:0004979]]" → text="asthma", expectedCuries=["MONDO:0004979"]
 */
export function parseSearchTerms(raw: string): ParsedSearchTerm[] {
  const seen = new Set<string>();
  const result: ParsedSearchTerm[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Extract [[CURIE]] annotations
    const expectedCuries: string[] = [];
    const annotationRegex = /\[\[([^\]]+)\]\]/g;
    let match;
    while ((match = annotationRegex.exec(trimmed)) !== null) {
      expectedCuries.push(match[1].trim());
    }

    // Strip annotations from search text
    const text = trimmed.replace(annotationRegex, '').trim();
    if (!text) continue;

    // Deduplicate by search text
    if (seen.has(text)) continue;
    seen.add(text);

    result.push({ text, raw: trimmed, expectedCuries });
  }
  return result;
}

/**
 * Call the NameRes /lookup endpoint for a single search term.
 *
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

  const resp = await fetch(url.toString(), { signal });
  if (!resp.ok) {
    throw new Error(`NameRes returned HTTP ${resp.status}: ${resp.statusText}`);
  }
  return resp.json();
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
