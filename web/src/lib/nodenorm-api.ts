import type { ApiOptions, NormalizedNode, NodeNormInstance, NodeNormResponse } from './types';

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
  const resp = await fetch(buildNodeNormUrl(baseUrl, curies, options), { signal });
  if (!resp.ok) {
    throw new Error(`NodeNorm returned HTTP ${resp.status}: ${resp.statusText}`);
  }
  return resp.json();
}

/**
 * Build the NodeNorm get_normalized_nodes GET URL for the given CURIEs and options.
 * Also used to link directly to the raw API response for one CURIE.
 */
export function buildNodeNormUrl(baseUrl: string, curies: string[], options: ApiOptions): string {
  const url = new URL('get_normalized_nodes', baseUrl);
  for (const curie of curies) {
    url.searchParams.append('curie', curie);
  }
  for (const [key, value] of Object.entries(options)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * True if the instances that answered disagree on the preferred ID for a CURIE.
 * An instance with no response (its request failed) is skipped; one that answered
 * null counts as "(not found)".
 */
export function preferredIdsDisagree(
  curie: string,
  instances: NodeNormInstance[],
  resultsByInstance: Map<string, NodeNormResponse>,
): boolean {
  const ids = new Set<string>();
  for (const inst of instances) {
    const resp = resultsByInstance.get(inst.url);
    if (resp) ids.add(resp[curie]?.id?.identifier ?? '(not found)');
  }
  return ids.size > 1;
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
