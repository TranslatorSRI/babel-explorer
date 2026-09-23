import type { NameResResult } from './nameres-types';

export interface InstanceDiffs {
  /** All CURIEs appearing in any instance's top-N, sorted by best (lowest) rank. */
  unionCuries: string[];
  /** For each instance URL, the set of CURIEs present in its top-N. */
  presenceByInstance: Map<string, Set<string>>;
  /** For each instance URL, a map from CURIE → 0-based rank in its top-N. */
  rankByInstance: Map<string, Map<string, number>>;
  /** For each CURIE, its rank in each instance (Infinity if missing). */
  rankByCurie: Map<string, Map<string, number>>;
  /** CURIEs whose label differs between instances (among instances that have the CURIE). */
  labelMismatch: Set<string>;
  /** CURIEs whose `types` set differs between instances. */
  typesMismatch: Set<string>;
  /** For each instance URL, CURIEs that appear only in that instance (not in any other). */
  uniqueToInstance: Map<string, Set<string>>;
}

function sortedTypesKey(types: string[]): string {
  return [...types].sort().join('|');
}

export function computeInstanceDiffs(
  perInstance: Map<string, NameResResult[]>,
): InstanceDiffs {
  const presenceByInstance = new Map<string, Set<string>>();
  const rankByInstance = new Map<string, Map<string, number>>();
  const rankByCurie = new Map<string, Map<string, number>>();
  const labelByInstance = new Map<string, Map<string, string>>();
  const typesByInstance = new Map<string, Map<string, string>>();
  const bestRank = new Map<string, number>();

  for (const [url, results] of perInstance) {
    const presence = new Set<string>();
    const rankMap = new Map<string, number>();
    const labelMap = new Map<string, string>();
    const typesMap = new Map<string, string>();

    results.forEach((r, idx) => {
      presence.add(r.curie);
      if (!rankMap.has(r.curie)) rankMap.set(r.curie, idx);
      labelMap.set(r.curie, r.label);
      typesMap.set(r.curie, sortedTypesKey(r.types));

      if (!rankByCurie.has(r.curie)) rankByCurie.set(r.curie, new Map());
      rankByCurie.get(r.curie)!.set(url, idx);

      const prev = bestRank.get(r.curie);
      if (prev === undefined || idx < prev) bestRank.set(r.curie, idx);
    });

    presenceByInstance.set(url, presence);
    rankByInstance.set(url, rankMap);
    labelByInstance.set(url, labelMap);
    typesByInstance.set(url, typesMap);
  }

  const unionCuries = [...bestRank.keys()].sort((a, b) => {
    const ra = bestRank.get(a)!;
    const rb = bestRank.get(b)!;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });

  const labelMismatch = new Set<string>();
  const typesMismatch = new Set<string>();

  for (const curie of unionCuries) {
    const labels = new Set<string>();
    const typeKeys = new Set<string>();
    for (const url of perInstance.keys()) {
      const lbl = labelByInstance.get(url)?.get(curie);
      if (lbl !== undefined) labels.add(lbl);
      const tk = typesByInstance.get(url)?.get(curie);
      if (tk !== undefined) typeKeys.add(tk);
    }
    if (labels.size > 1) labelMismatch.add(curie);
    if (typeKeys.size > 1) typesMismatch.add(curie);
  }

  const uniqueToInstance = new Map<string, Set<string>>();
  for (const [url, presence] of presenceByInstance) {
    const unique = new Set<string>();
    for (const curie of presence) {
      let onlyHere = true;
      for (const [otherUrl, otherPresence] of presenceByInstance) {
        if (otherUrl === url) continue;
        if (otherPresence.has(curie)) {
          onlyHere = false;
          break;
        }
      }
      if (onlyHere) unique.add(curie);
    }
    uniqueToInstance.set(url, unique);
  }

  return {
    unionCuries,
    presenceByInstance,
    rankByInstance,
    rankByCurie,
    labelMismatch,
    typesMismatch,
    uniqueToInstance,
  };
}

/**
 * Classify an expected CURIE against the top-N and top-100 results for a single instance.
 */
export interface ExpectedCurieStatus {
  curie: string;
  /** 'hit' if in top-N, 'deep' if in top-100 only, 'miss' if not in top-100, 'unknown' if no deep lookup yet. */
  status: 'hit' | 'deep' | 'miss' | 'unknown';
  /** 0-based rank in whichever list it was found; -1 otherwise. */
  rank: number;
  /** Total size of the list that the rank refers to. */
  of: number;
}

export function classifyExpectedCurie(
  curie: string,
  topN: NameResResult[] | undefined,
  deep: NameResResult[] | undefined,
): ExpectedCurieStatus {
  if (topN) {
    const i = topN.findIndex((r) => r.curie === curie);
    if (i !== -1) return { curie, status: 'hit', rank: i, of: topN.length };
  }
  if (deep) {
    const i = deep.findIndex((r) => r.curie === curie);
    if (i !== -1) return { curie, status: 'deep', rank: i, of: deep.length };
    return { curie, status: 'miss', rank: -1, of: deep.length };
  }
  return { curie, status: 'unknown', rank: -1, of: 0 };
}
