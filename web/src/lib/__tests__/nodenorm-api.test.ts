import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseCuries,
  fetchNormalizedNodes,
  buildNodeNormUrl,
  preferredIdsDisagree,
  getDirectTypes,
  MAX_CONCURRENT_BATCHES,
  BATCH_TIMEOUT_MS,
} from '../nodenorm-api';
import { DEFAULT_API_OPTIONS } from '../types';
import type { ApiOptions, NormalizedNode } from '../types';
import mondoFixture from '../../../../tests/fixtures/nodenorm_responses/mondo_0004979.json';
import ncitFixture from '../../../../tests/fixtures/nodenorm_responses/ncit_c55060.json';
import batchFixture from '../../../../tests/fixtures/nodenorm_responses/batch_mixed.json';
import meshConflatedFixture from '../../../../tests/fixtures/nodenorm_responses/mesh_d014867_conflated.json';
import meshNoConflateFixture from '../../../../tests/fixtures/nodenorm_responses/mesh_d014867_no_conflate.json';
import ncbigeneFixture from '../../../../tests/fixtures/nodenorm_responses/ncbigene_1756.json';

// ---------------------------------------------------------------------------
// parseCuries
// ---------------------------------------------------------------------------

describe('parseCuries', () => {
  it('splits multi-line input into array', () => {
    expect(parseCuries('MONDO:0004979\nCHEBI:48947')).toEqual([
      'MONDO:0004979',
      'CHEBI:48947',
    ]);
  });

  it('skips blank lines', () => {
    expect(parseCuries('MONDO:0004979\n\n\nCHEBI:48947')).toEqual([
      'MONDO:0004979',
      'CHEBI:48947',
    ]);
  });

  it('skips # comment lines', () => {
    expect(parseCuries('# This is a comment\nMONDO:0004979\n# Another\nCHEBI:48947')).toEqual([
      'MONDO:0004979',
      'CHEBI:48947',
    ]);
  });

  it('deduplicates CURIEs preserving first occurrence', () => {
    expect(parseCuries('MONDO:0004979\nCHEBI:48947\nMONDO:0004979')).toEqual([
      'MONDO:0004979',
      'CHEBI:48947',
    ]);
  });

  it('trims whitespace from each line', () => {
    expect(parseCuries('  MONDO:0004979  \n  CHEBI:48947  ')).toEqual([
      'MONDO:0004979',
      'CHEBI:48947',
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(parseCuries('')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(parseCuries('   \n  \n  ')).toEqual([]);
  });

  it('handles the same format as Python tests/data/valid_curies.txt', () => {
    const raw = '# Valid CURIEs for integration tests.\nMONDO:0004979\nMONDO:0005044\nNCIT:C55060';
    expect(parseCuries(raw)).toEqual(['MONDO:0004979', 'MONDO:0005044', 'NCIT:C55060']);
  });
});

// ---------------------------------------------------------------------------
// fetchNormalizedNodes
// ---------------------------------------------------------------------------

describe('fetchNormalizedNodes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('constructs correct URL with query params', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mondoFixture),
    });
    vi.stubGlobal('fetch', mockFetch);

    await fetchNormalizedNodes(
      'https://nodenormalization-sri.renci.org/',
      ['MONDO:0004979'],
      DEFAULT_API_OPTIONS,
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.pathname).toBe('/get_normalized_nodes');
    expect(calledUrl.searchParams.getAll('curie')).toEqual(['MONDO:0004979']);
    expect(calledUrl.searchParams.get('conflate')).toBe('true');
    expect(calledUrl.searchParams.get('drug_chemical_conflate')).toBe('true');
    expect(calledUrl.searchParams.get('description')).toBe('true');
    expect(calledUrl.searchParams.get('individual_types')).toBe('true');
    expect(calledUrl.searchParams.get('include_taxa')).toBe('true');
  });

  it('sends multiple curie= params for a multi-CURIE request', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(batchFixture),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchNormalizedNodes(
      'https://nodenormalization-sri.renci.org/',
      ['MONDO:0004979', 'NCIT:C55060', 'FAKE:9999999'],
      DEFAULT_API_OPTIONS,
    );

    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.searchParams.getAll('curie')).toEqual([
      'MONDO:0004979',
      'NCIT:C55060',
      'FAKE:9999999',
    ]);
    // Response contains all three keys
    expect(Object.keys(result)).toEqual(expect.arrayContaining([
      'MONDO:0004979', 'NCIT:C55060', 'FAKE:9999999',
    ]));
    // Not-found CURIE is null
    expect(result['FAKE:9999999']).toBeNull();
    // Found CURIEs are non-null
    expect(result['MONDO:0004979']).not.toBeNull();
    expect(result['NCIT:C55060']).not.toBeNull();
  });

  it('sets boolean options as string values', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', mockFetch);

    const opts: ApiOptions = {
      conflate: false,
      drug_chemical_conflate: false,
      description: true,
      individual_types: false,
      include_taxa: true,
    };
    await fetchNormalizedNodes('https://example.com/', ['X:1'], opts);

    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.searchParams.get('conflate')).toBe('false');
    expect(calledUrl.searchParams.get('drug_chemical_conflate')).toBe('false');
    expect(calledUrl.searchParams.get('description')).toBe('true');
    expect(calledUrl.searchParams.get('individual_types')).toBe('false');
    expect(calledUrl.searchParams.get('include_taxa')).toBe('true');
  });

  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mondoFixture),
    }));

    const result = await fetchNormalizedNodes(
      'https://example.com/',
      ['MONDO:0004979'],
      DEFAULT_API_OPTIONS,
    );
    expect(result).toEqual(mondoFixture);
  });

  it('throws on non-OK HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    }));

    await expect(
      fetchNormalizedNodes('https://example.com/', ['X:1'], DEFAULT_API_OPTIONS),
    ).rejects.toThrow('NodeNorm returned HTTP 500');
  });

  it('splits a long CURIE list across several requests and merges the responses', async () => {
    const mockFetch = vi.fn((url: string) => {
      const curies = new URL(url).searchParams.getAll('curie');
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(Object.fromEntries(curies.map((c) => [c, null]))),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const curies = Array.from({ length: 1000 }, (_, i) => `MONDO:${String(i).padStart(7, '0')}`);
    const result = await fetchNormalizedNodes('https://example.com/', curies, DEFAULT_API_OPTIONS);

    expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
    for (const [url] of mockFetch.mock.calls) expect(url.length).toBeLessThan(8000);
    expect(Object.keys(result)).toEqual(curies);
  });

  // Enough CURIEs for several times MAX_CONCURRENT_BATCHES batches.
  const manyCuries = Array.from({ length: 3000 }, (_, i) => `NCBIGene:${100000 + i}`);

  it(`keeps at most ${MAX_CONCURRENT_BATCHES} batches in flight at once`, async () => {
    let inFlight = 0;
    let peak = 0;
    const mockFetch = vi.fn(async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return { ok: true, json: () => Promise.resolve({}) };
    });
    vi.stubGlobal('fetch', mockFetch);

    await fetchNormalizedNodes('https://example.com/', manyCuries, DEFAULT_API_OPTIONS);

    expect(mockFetch.mock.calls.length).toBeGreaterThan(MAX_CONCURRENT_BATCHES);
    expect(peak).toBe(MAX_CONCURRENT_BATCHES);
  });

  it('aborts the other batches once one fails, and reports the failure', async () => {
    const signals: AbortSignal[] = [];
    const mockFetch = vi.fn((_url: string, init: RequestInit) => {
      signals.push(init.signal!);
      if (signals.length === 1) {
        return Promise.resolve({ ok: false, status: 500, statusText: 'Internal Server Error' });
      }
      // Never resolves on its own; settles only when aborted.
      return new Promise((_, reject) =>
        init.signal!.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        ),
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    const err = await fetchNormalizedNodes(
      'https://example.com/', manyCuries, DEFAULT_API_OPTIONS,
    ).catch((e) => e);

    expect(err.message).toContain('HTTP 500');
    expect(signals.length).toBeLessThanOrEqual(MAX_CONCURRENT_BATCHES);
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it('fails an instance whose batch takes longer than the timeout, leaving the caller alone', async () => {
    vi.useFakeTimers();
    try {
      // Never resolves on its own; settles only when aborted.
      vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) =>
        new Promise((_, reject) => init.signal!.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        )),
      ));
      const caller = new AbortController();
      const result = fetchNormalizedNodes(
        'https://example.com/', manyCuries, DEFAULT_API_OPTIONS, caller.signal,
      ).catch((e) => e);

      await vi.advanceTimersByTimeAsync(BATCH_TIMEOUT_MS - 1);
      expect(caller.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      const err = await result;
      expect(err.message).toBe(`NodeNorm did not answer within ${BATCH_TIMEOUT_MS / 1000} s`);
      expect(caller.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives each batch its own deadline, not the whole lookup', async () => {
    vi.useFakeTimers();
    try {
      // Each batch answers just inside the timeout, so the lookup as a whole takes longer.
      vi.stubGlobal('fetch', vi.fn(() =>
        new Promise((resolve) => setTimeout(
          () => resolve({ ok: true, json: () => Promise.resolve({}) }),
          BATCH_TIMEOUT_MS - 1,
        )),
      ));
      const result = fetchNormalizedNodes('https://example.com/', manyCuries, DEFAULT_API_OPTIONS);
      await vi.runAllTimersAsync();
      await expect(result).resolves.toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws AbortError when called with an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }),
    ));

    const err = await fetchNormalizedNodes(
      'https://example.com/', ['X:1'], DEFAULT_API_OPTIONS, controller.signal,
    ).catch((e) => e);

    expect(err.name).toBe('AbortError');
  });
});

describe('buildNodeNormUrl', () => {
  it('keeps the last path segment of a base URL without a trailing slash', () => {
    const url = new URL(buildNodeNormUrl('https://host/nodenorm', ['X:1'], DEFAULT_API_OPTIONS));
    expect(url.pathname).toBe('/nodenorm/get_normalized_nodes');
  });
});

// ---------------------------------------------------------------------------
// NodeNorm response shape (documented via fixture assertions)
//
// These tests serve as executable documentation of the API contract.
// They verify the exact field types returned by NodeNorm, catching any
// future API changes that break our type assumptions.
// ---------------------------------------------------------------------------

describe('NodeNorm API response shape', () => {
  it('id.description is a plain string (not an array)', () => {
    const node = ncitFixture['NCIT:C55060'] as NormalizedNode;
    expect(typeof node.id.description).toBe('string');
    expect(node.id.description).toBe('A disorder characterized by a pathological increase in blood pressure.');
  });

  it('top-level descriptions is an array of strings', () => {
    const node = mondoFixture['MONDO:0004979'] as NormalizedNode;
    expect(Array.isArray(node.descriptions)).toBe(true);
    expect(node.descriptions!.length).toBeGreaterThan(1);
    node.descriptions!.forEach(d => expect(typeof d).toBe('string'));
  });

  it('equivalent_identifiers[].description is a plain string when present', () => {
    const node = ncitFixture['NCIT:C55060'] as NormalizedNode;
    const withDesc = node.equivalent_identifiers.filter(ei => ei.description != null);
    expect(withDesc.length).toBeGreaterThan(0);
    withDesc.forEach(ei => expect(typeof ei.description).toBe('string'));
  });

  it('id.description matches the first (longest) entry in top-level descriptions', () => {
    // NodeNorm sets id.description to the best/longest description
    const node = mondoFixture['MONDO:0004979'] as NormalizedNode;
    expect(node.id.description).toBe(node.descriptions![0]);
  });

  it('not-found CURIE returns null (not a missing key)', () => {
    expect('FAKE:9999999' in batchFixture).toBe(true);
    expect(batchFixture['FAKE:9999999']).toBeNull();
  });

  it('gene node (NCBIGene:1756) has taxa on its identifiers', () => {
    const node = ncbigeneFixture['NCBIGene:1756'] as NormalizedNode;
    const withTaxa = node.equivalent_identifiers.filter(ei => ei.taxa && ei.taxa.length > 0);
    expect(withTaxa.length).toBeGreaterThan(0);
    withTaxa.forEach(ei => {
      expect(Array.isArray(ei.taxa)).toBe(true);
      ei.taxa!.forEach(t => expect(typeof t).toBe('string'));
    });
  });
});

// ---------------------------------------------------------------------------
// Conflation effects
//
// conflate=true merges Chemical/SmallMolecule cliques and Drug cliques.
// MESH:D014867 (water) is a good test case: conflated produces a much larger
// clique (206 equiv IDs) than non-conflated (30 equiv IDs).
// ---------------------------------------------------------------------------

describe('conflation', () => {
  it('conflated MESH:D014867 has more equivalent identifiers than non-conflated', () => {
    const conflated = meshConflatedFixture['MESH:D014867'] as NormalizedNode;
    const noConflate = meshNoConflateFixture['MESH:D014867'] as NormalizedNode;
    expect(conflated.equivalent_identifiers.length).toBeGreaterThan(
      noConflate.equivalent_identifiers.length,
    );
  });

  it('conflated MESH:D014867 has more descriptions than non-conflated', () => {
    const conflated = meshConflatedFixture['MESH:D014867'] as NormalizedNode;
    const noConflate = meshNoConflateFixture['MESH:D014867'] as NormalizedNode;
    expect(conflated.descriptions!.length).toBeGreaterThan(noConflate.descriptions!.length);
  });

  it('conflated and non-conflated share the same preferred ID', () => {
    // Conflation may change which clique "wins" in other cases, but for water
    // both resolve to the same canonical CHEBI ID
    const conflated = meshConflatedFixture['MESH:D014867'] as NormalizedNode;
    const noConflate = meshNoConflateFixture['MESH:D014867'] as NormalizedNode;
    expect(conflated.id.identifier).toBe(noConflate.id.identifier);
  });

  it('fetchNormalizedNodes sends conflate=false correctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(meshNoConflateFixture),
    }));

    await fetchNormalizedNodes(
      'https://example.com/',
      ['MESH:D014867'],
      { ...DEFAULT_API_OPTIONS, conflate: false, drug_chemical_conflate: false },
    );

    const calledUrl = new URL((vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl.searchParams.get('conflate')).toBe('false');
    expect(calledUrl.searchParams.get('drug_chemical_conflate')).toBe('false');

    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// preferredIdsDisagree
// ---------------------------------------------------------------------------

describe('preferredIdsDisagree', () => {
  const a = { name: 'A', env: 'a', url: 'https://a/' };
  const b = { name: 'B', env: 'b', url: 'https://b/' };
  const node = (identifier: string) =>
    ({ id: { identifier }, equivalent_identifiers: [], type: [] }) as NormalizedNode;

  it('is false when every instance that answered agrees', () => {
    const results = new Map([[a.url, { X: node('P:1') }], [b.url, { X: node('P:1') }]]);
    expect(preferredIdsDisagree('X', [a, b], results)).toBe(false);
  });

  it('counts an instance that answered null as disagreeing', () => {
    const results = new Map([[a.url, { X: node('P:1') }], [b.url, { X: null }]]);
    expect(preferredIdsDisagree('X', [a, b], results)).toBe(true);
  });

  it('skips an instance whose request failed', () => {
    const results = new Map([[a.url, { X: node('P:1') }]]);
    expect(preferredIdsDisagree('X', [a, b], results)).toBe(false);
  });
});

describe('getDirectTypes', () => {
  const conflated = meshConflatedFixture['MESH:D014867'] as NormalizedNode;

  it('lists each identifier type once, in first-appearance order', () => {
    const types = getDirectTypes(conflated);
    expect(new Set(types)).toEqual(new Set(['biolink:SmallMolecule', 'biolink:Drug', 'biolink:ChemicalEntity']));
    expect(types).toHaveLength(3);
  });

  it('falls back to the most specific clique type when identifiers carry none', () => {
    const node: NormalizedNode = {
      id: { identifier: 'X:1' },
      equivalent_identifiers: [{ identifier: 'X:1' }],
      type: ['biolink:Gene', 'biolink:NamedThing'],
    };
    expect(getDirectTypes(node)).toEqual(['biolink:Gene']);
  });

  it('computes a node once, however many components ask', () => {
    const node = structuredClone(conflated);
    expect(getDirectTypes(node)).toBe(getDirectTypes(node));
  });
});
