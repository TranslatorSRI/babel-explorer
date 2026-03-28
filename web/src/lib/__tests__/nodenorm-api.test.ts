import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseCuries, fetchNormalizedNodes } from '../nodenorm-api';
import { DEFAULT_API_OPTIONS } from '../types';
import type { ApiOptions } from '../types';
import mondoFixture from '../../../../tests/fixtures/nodenorm_responses/mondo_0004979.json';

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

  it('appends multiple curie params for multiple CURIEs', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', mockFetch);

    await fetchNormalizedNodes(
      'https://example.com/',
      ['MONDO:0004979', 'CHEBI:48947'],
      DEFAULT_API_OPTIONS,
    );

    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.searchParams.getAll('curie')).toEqual([
      'MONDO:0004979',
      'CHEBI:48947',
    ]);
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
