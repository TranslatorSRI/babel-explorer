import { describe, it, expect } from 'vitest';
import { parseCurie, getCurieUrl } from '../curie-links';
import prefixMapSubset from '../../../../tests/fixtures/prefix_map_subset.json';

// ---------------------------------------------------------------------------
// parseCurie
// ---------------------------------------------------------------------------

describe('parseCurie', () => {
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

  it('defaults to the vendored biolink prefix map', () => {
    expect(getCurieUrl('MONDO:0004979')).toBe('http://purl.obolibrary.org/obo/MONDO_0004979');
  });
});
