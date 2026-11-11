import type { ApiOptions, NormalizedNode, NodeNormInstance, NodeNormResponse } from './types';

// Keep each GET well under the ~8 KB request-line limit common to servers and proxies.
const MAX_CURIE_PARAMS_LENGTH = 4000;

// Batches in flight at once per instance. A few thousand CURIEs make dozens of
// batches, and sending them all together invites HTTP 429s.
export const MAX_CONCURRENT_BATCHES = 4;

/**
 * Call the NodeNorm get_normalized_nodes endpoint.
 *
 * Long CURIE lists are split into several GET requests, since one URL carrying every
 * CURIE can exceed server limits (HTTP 414). GET rather than POST because a JSON POST
 * needs a CORS preflight, which a custom NodeNorm URL may not answer (every deployment
 * in translator-endpoints.json did when checked on 2026-11-10). At most
 * MAX_CONCURRENT_BATCHES requests are in flight at once, and the first failure aborts
 * the rest, since their responses would be thrown away.
 *
 * @param baseUrl  NodeNorm instance URL
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
  const batches: string[][] = [];
  let length = Infinity;
  for (const curie of curies) {
    const cost = '&curie='.length + encodeURIComponent(curie).length;
    if (length + cost > MAX_CURIE_PARAMS_LENGTH) {
      batches.push([]);
      length = 0;
    }
    batches[batches.length - 1].push(curie);
    length += cost;
  }

  // Linked by hand rather than with AbortSignal.any, which Safari gained only in 17.4.
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });

  const responses: NodeNormResponse[] = new Array(batches.length);
  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const i = next++;
      const resp = await fetch(buildNodeNormUrl(baseUrl, batches[i], options), {
        signal: controller.signal,
      });
      if (!resp.ok) {
        throw new Error(`NodeNorm returned HTTP ${resp.status}: ${resp.statusText}`);
      }
      responses[i] = (await resp.json()) as NodeNormResponse;
    }
  }

  try {
    const workers = Math.min(MAX_CONCURRENT_BATCHES, batches.length);
    await Promise.all(Array.from({ length: workers }, worker));
  } catch (err) {
    controller.abort();
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  return Object.assign({}, ...responses);
}

/**
 * Build the NodeNorm get_normalized_nodes GET URL for the given CURIEs and options.
 * Also used to link directly to the raw API response for one CURIE.
 * A base URL without a trailing slash is treated as a directory, so
 * https://host/nodenorm resolves to https://host/nodenorm/get_normalized_nodes.
 */
export function buildNodeNormUrl(baseUrl: string, curies: string[], options: ApiOptions): string {
  const url = new URL('get_normalized_nodes', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
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
 *
 * Memoised per node, since ComparisonView, ResultsSummary and CurieDetailPanel each
 * ask for the same node's types and a conflated clique can list hundreds of
 * identifiers. That relies on nodes never being mutated: NodeNormApp replaces a
 * response whole rather than editing it. The result is shared, hence readonly.
 */
const directTypesCache = new WeakMap<NormalizedNode, readonly string[]>();

export function getDirectTypes(node: NormalizedNode): readonly string[] {
  const cached = directTypesCache.get(node);
  if (cached) return cached;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of node.equivalent_identifiers) {
    if (id.type && !seen.has(id.type)) {
      seen.add(id.type);
      result.push(id.type);
    }
  }
  const types = result.length > 0 ? result : node.type.slice(0, 1);
  directTypesCache.set(node, types);
  return types;
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
