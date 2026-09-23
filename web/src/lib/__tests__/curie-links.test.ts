import { describe, it, expect, vi, beforeEach } from 'vitest';
import prefixMapSubset from '../../../../tests/fixtures/prefix_map_subset.json';

// Module-level cache in curie-links.ts requires re-importing after reset.
// Each describe block that tests loadPrefixMap uses vi.resetModules().

// ---------------------------------------------------------------------------
// parseCurie  (pure function — no module cache issues)
// ---------------------------------------------------------------------------

describe('parseCurie', () => {
  // Import once since parseCurie is pure.
  let parseCurie: typeof import('../curie-links').parseCurie;

  beforeEach(async () => {
    const mod = await import('../curie-links');
    parseCurie = mod.parseCurie;
  });

  it('parses a standard CURIE', () => {
    expect(parseCurie('MONDO:0004979')).toEqual({
      prefix: 'MONDO',
      localId: '0004979',
    });
  });

  it('splits only on first colon (multi-colon local ID)', () => {
    expect(parseCurie('GO:0008150')).toEqual({
      prefix: 'GO',
      localId: '0008150',
    });
  });

  it('returns null for string without colon', () => {
    expect(parseCurie('MONDO0004979')).toBeNull();
  });

  it('returns null for string starting with colon', () => {
    expect(parseCurie(':0004979')).toBeNull();
  });

  it('handles prefix with dots', () => {
    expect(parseCurie('biolink:Disease')).toEqual({
      prefix: 'biolink',
      localId: 'Disease',
    });
  });
});

// ---------------------------------------------------------------------------
// getCurieUrl  (pure function given a map)
// ---------------------------------------------------------------------------

describe('getCurieUrl', () => {
  let getCurieUrl: typeof import('../curie-links').getCurieUrl;

  beforeEach(async () => {
    const mod = await import('../curie-links');
    getCurieUrl = mod.getCurieUrl;
  });

  it('returns IRI URL for a known prefix', () => {
    expect(getCurieUrl('MONDO:0004979', prefixMapSubset)).toBe(
      'http://purl.obolibrary.org/obo/MONDO_0004979',
    );
  });

  it('returns IRI URL for CHEBI prefix', () => {
    expect(getCurieUrl('CHEBI:48947', prefixMapSubset)).toBe(
      'http://purl.obolibrary.org/obo/CHEBI_48947',
    );
  });

  it('returns IRI URL for HGNC (identifiers.org base)', () => {
    expect(getCurieUrl('HGNC:1234', prefixMapSubset)).toBe(
      'http://identifiers.org/hgnc/1234',
    );
  });

  it('returns null for unknown prefix', () => {
    expect(getCurieUrl('FAKE:9999', prefixMapSubset)).toBeNull();
  });

  it('returns null for unparseable CURIE', () => {
    expect(getCurieUrl('nocolon', prefixMapSubset)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// loadPrefixMap  (has module-level cache, needs vi.resetModules)
// ---------------------------------------------------------------------------

describe('loadPrefixMap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('returns map on successful fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(prefixMapSubset),
    }));

    const { loadPrefixMap } = await import('../curie-links');
    const map = await loadPrefixMap();
    expect(map).toEqual(prefixMapSubset);
  });

  it('returns empty map on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const { loadPrefixMap } = await import('../curie-links');
    const map = await loadPrefixMap();
    expect(map).toEqual({});
  });

  it('returns empty map on non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }));

    const { loadPrefixMap } = await import('../curie-links');
    const map = await loadPrefixMap();
    expect(map).toEqual({});
  });

  it('caches result — second call does not re-fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(prefixMapSubset),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { loadPrefixMap } = await import('../curie-links');
    await loadPrefixMap();
    await loadPrefixMap();
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});
