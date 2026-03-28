import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseCuries, fetchNormalizedNodes } from '../nodenorm-api';
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
