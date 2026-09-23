/**
 * CURIE link-out support using the biolink-model prefix map.
 *
 * The prefix map is fetched from GitHub at build time and bundled.
 * It maps CURIE prefixes to IRI bases (e.g. MONDO → http://purl.obolibrary.org/obo/MONDO_).
 * These IRIs generally resolve via 303/302 redirects to useful browseable pages
 * (OLS, identifiers.org, GenNames, etc.).
 *
 * Biolink model version is configurable — update BIOLINK_VERSION below.
 */

const BIOLINK_VERSION = 'v4.3.7';

const PREFIX_MAP_URL =
  `https://raw.githubusercontent.com/biolink/biolink-model/${BIOLINK_VERSION}/src/biolink_model/prefixmaps/biolink-model-prefix-map.json`;

/** Cached prefix map: prefix → IRI base URL. */
let prefixMap: Record<string, string> | null = null;

/**
 * Load the biolink prefix map. Fetches from GitHub on first call,
 * then returns the cached copy. Falls back to an empty map on error.
 */
export async function loadPrefixMap(): Promise<Record<string, string>> {
  if (prefixMap) return prefixMap;

  try {
    const resp = await fetch(PREFIX_MAP_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    prefixMap = await resp.json();
    return prefixMap!;
  } catch (err) {
    console.warn('Failed to load biolink prefix map:', err);
    prefixMap = {};
    return prefixMap;
  }
}

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
export function getCurieUrl(curie: string, map: Record<string, string>): string | null {
  const parsed = parseCurie(curie);
  if (!parsed) return null;

  const iriBase = map[parsed.prefix];
  if (!iriBase) return null;

  return iriBase + parsed.localId;
}
