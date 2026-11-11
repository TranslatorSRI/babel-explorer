/**
 * CURIE link-out support using the biolink-model prefix map.
 *
 * The prefix map maps CURIE prefixes to IRI bases (e.g. MONDO → http://purl.obolibrary.org/obo/MONDO_).
 * These IRIs generally resolve via 303/302 redirects to useful browseable pages
 * (OLS, identifiers.org, GenNames, etc.).
 *
 * biolink-prefix-map.json is a vendored copy of biolink-model v4.3.7's
 * src/biolink_model/prefixmaps/biolink-model-prefix-map.json, bundled at build time.
 * To update it, download that file from the new release tag over the vendored copy.
 */

import PREFIX_MAP from './biolink-prefix-map.json';

/**
 * Parse a CURIE into prefix and local ID.
 * e.g. "MONDO:0004979" → { prefix: "MONDO", localId: "0004979" }
 */
export function parseCurie(curie: string): { prefix: string; localId: string } | null {
  const idx = curie.indexOf(':');
  if (idx < 1) return null;
  return { prefix: curie.substring(0, idx), localId: curie.substring(idx + 1) };
}

/**
 * Construct a browseable URL for a CURIE using the biolink prefix map.
 * Returns null if the prefix is unknown.
 *
 * The IRI base typically ends with _ or / — we append the local ID directly.
 * e.g. MONDO:0004979 → http://purl.obolibrary.org/obo/MONDO_0004979
 */
export function getCurieUrl(
  curie: string,
  map: Record<string, string> = PREFIX_MAP,
): string | null {
  const parsed = parseCurie(curie);
  if (!parsed) return null;

  const iriBase = map[parsed.prefix];
  if (!iriBase) return null;

  return iriBase + parsed.localId;
}
