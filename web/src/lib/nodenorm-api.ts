import type { ApiOptions, NormalizedNode, NodeNormResponse } from './types';

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
 * Build the NodeNorm GET URL for a single CURIE with the given options.
 * Useful for linking directly to the raw API response.
 */
export function buildNodeNormUrl(baseUrl: string, curie: string, options: ApiOptions): string {
  const url = new URL('get_normalized_nodes', baseUrl);
  url.searchParams.append('curie', curie);
  url.searchParams.set('conflate', String(options.conflate));
  url.searchParams.set('drug_chemical_conflate', String(options.drug_chemical_conflate));
  url.searchParams.set('description', String(options.description));
  url.searchParams.set('individual_types', String(options.individual_types));
  url.searchParams.set('include_taxa', String(options.include_taxa));
  return url.toString();
}

/**
 * Compute the "direct types" for a normalized node.
 *
 * NodeNorm returns two distinct type structures:
 *
 *   node.type — The full biolink type *hierarchy* for the clique, from most-specific
 *     (type[0]) to root (NamedThing). Example: ["biolink:Gene", "biolink:BiologicalEntity",
 *     "biolink:NamedThing"]. This is the lineage, not just the direct type, so it is
 *     not useful for display on its own.
 *
 *   identifier.type — The *direct* biolink type for one specific identifier within the
 *     clique. Only present when individual_types=true is passed to the API (always
 *     enabled in this app). Example: "biolink:Gene" for NCBIGene entries,
 *     "biolink:Protein" for UniProtKB entries in a conflated gene+protein result.
 *
 * This function collects unique type values from equivalent_identifiers[*].type,
 * preserving first-appearance order. For most non-conflated results this returns a
 * single type (e.g. ["biolink:Gene"]). For conflated results (e.g. a gene/protein
 * conflation) it returns 2–5 types in the order they first appear among the identifiers.
 *
 * Falls back to [node.type[0]] if no individual types are present (e.g. if the API
 * was called without individual_types=true).
 */
export function getDirectTypes(node: NormalizedNode): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of node.equivalent_identifiers) {
    if (id.type && !seen.has(id.type)) {
      seen.add(id.type);
      result.push(id.type);
    }
  }
  return result.length > 0 ? result : node.type.slice(0, 1);
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
