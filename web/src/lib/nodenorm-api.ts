import type { ApiOptions, NodeNormResponse } from './types';

/**
 * Call the NodeNorm get_normalized_nodes endpoint.
 *
 * @param baseUrl  NodeNorm instance URL (must end with /)
 * @param curies   List of CURIEs to normalize
 * @param options  API query options (conflation, descriptions, etc.)
 * @returns        Raw NodeNorm response keyed by input CURIE
 */
export async function fetchNormalizedNodes(
  baseUrl: string,
  curies: string[],
  options: ApiOptions,
  signal?: AbortSignal,
): Promise<NodeNormResponse> {
  const url = new URL('get_normalized_nodes', baseUrl);

  for (const curie of curies) {
    url.searchParams.append('curie', curie);
  }
  url.searchParams.set('conflate', String(options.conflate));
  url.searchParams.set('drug_chemical_conflate', String(options.drug_chemical_conflate));
  url.searchParams.set('description', String(options.description));
  url.searchParams.set('individual_types', String(options.individual_types));
  url.searchParams.set('include_taxa', String(options.include_taxa));

  const resp = await fetch(url.toString(), { signal });
  if (!resp.ok) {
    throw new Error(`NodeNorm returned HTTP ${resp.status}: ${resp.statusText}`);
  }
  return resp.json();
}

/**
 * Parse a textarea value into a deduplicated list of CURIEs.
 * Skips blank lines and lines starting with #.
 */
export function parseCuries(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}
