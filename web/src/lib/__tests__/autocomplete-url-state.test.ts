import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_AUTOCOMPLETE_OPTIONS,
  DEFAULT_DEBOUNCE_MS,
  parseExpectedCuries,
} from '../autocomplete-url-state';

function setLocation(search: string, pathname = '/autocomplete') {
  Object.defineProperty(window, 'location', {
    value: { search, pathname, href: `http://localhost${pathname}${search}` },
    writable: true,
    configurable: true,
  });
}

describe('readAutocompleteQueryState', () => {
  beforeEach(() => {
    setLocation('');
  });

  it('returns defaults for empty query string', async () => {
    setLocation('');
    const { readAutocompleteQueryState } = await import('../autocomplete-url-state');
    const s = readAutocompleteQueryState();
    expect(s.query).toBe('');
    expect(s.preset).toBe('disease');
    expect(s.targets).toEqual([]);
    expect(s.options).toEqual({});
    expect(s.expected).toEqual([]);
    expect(s.debounceMs).toBeUndefined();
    expect(s.highlight).toBeUndefined();
  });

  it('parses q, preset, targets, expected', async () => {
    setLocation('?q=diab&preset=gene&target=dev&target=prod&expected=NCBIGene:1234&expected=HGNC:5');
    const { readAutocompleteQueryState } = await import('../autocomplete-url-state');
    const s = readAutocompleteQueryState();
    expect(s.query).toBe('diab');
    expect(s.preset).toBe('gene');
    expect(s.targets).toEqual(['dev', 'prod']);
    expect(s.expected).toEqual(['NCBIGene:1234', 'HGNC:5']);
  });

  it('falls back to default preset for invalid values', async () => {
    setLocation('?preset=bogus');
    const { readAutocompleteQueryState } = await import('../autocomplete-url-state');
    expect((await (await import('../autocomplete-url-state')).readAutocompleteQueryState()).preset).toBe('disease');
  });

  it('parses option overrides', async () => {
    setLocation('?limit=20&autocomplete=false&biolink_type=Gene&only_prefixes=NCBIGene');
    const { readAutocompleteQueryState } = await import('../autocomplete-url-state');
    const s = readAutocompleteQueryState();
    expect(s.options.limit).toBe(20);
    expect(s.options.autocomplete).toBe(false);
    expect(s.options.biolink_type).toBe('Gene');
    expect(s.options.only_prefixes).toBe('NCBIGene');
  });

  it('parses debounce and highlight', async () => {
    setLocation('?debounce=300&highlight=false');
    const { readAutocompleteQueryState } = await import('../autocomplete-url-state');
    const s = readAutocompleteQueryState();
    expect(s.debounceMs).toBe(300);
    expect(s.highlight).toBe(false);
  });

  it('ignores debounce that is not in the allowlist', async () => {
    setLocation('?debounce=999');
    const { readAutocompleteQueryState } = await import('../autocomplete-url-state');
    const s = readAutocompleteQueryState();
    expect(s.debounceMs).toBeUndefined();
  });
});

describe('buildAutocompleteQueryUrl', () => {
  beforeEach(() => {
    setLocation('', '/autocomplete');
  });

  it('writes only q when everything else is default (disease preset)', async () => {
    const { buildAutocompleteQueryUrl } = await import('../autocomplete-url-state');
    const url = buildAutocompleteQueryUrl({
      query: 'diab',
      preset: 'disease',
      targets: [],
      options: { ...DEFAULT_AUTOCOMPLETE_OPTIONS, biolink_type: 'DiseaseOrPhenotypicFeature', only_prefixes: 'MONDO|HP' },
      expected: [],
      debounceMs: DEFAULT_DEBOUNCE_MS,
      highlight: true,
    });
    expect(url).toBe('/autocomplete?q=diab');
  });

  it('includes preset, targets, expected, and advanced flags when non-default', async () => {
    const { buildAutocompleteQueryUrl } = await import('../autocomplete-url-state');
    const url = buildAutocompleteQueryUrl({
      query: 'nea',
      preset: 'gene',
      targets: ['dev', 'prod'],
      options: { ...DEFAULT_AUTOCOMPLETE_OPTIONS, biolink_type: 'Gene' },
      expected: ['NCBIGene:1234'],
      debounceMs: 0,
      highlight: false,
    });
    expect(url).toContain('q=nea');
    expect(url).toContain('preset=gene');
    expect(url).toContain('target=dev');
    expect(url).toContain('target=prod');
    expect(url).toContain('expected=NCBIGene%3A1234');
    expect(url).toContain('debounce=0');
    expect(url).toContain('highlight=false');
    // Biolink_type matches the preset's implied value — should NOT be written.
    expect(url).not.toContain('biolink_type');
  });

  it('writes biolink_type/only_prefixes when they differ from preset-implied values', async () => {
    const { buildAutocompleteQueryUrl } = await import('../autocomplete-url-state');
    const url = buildAutocompleteQueryUrl({
      query: 'x',
      preset: 'disease',
      targets: [],
      // Override only_prefixes away from the preset's "MONDO|HP"
      options: { ...DEFAULT_AUTOCOMPLETE_OPTIONS, biolink_type: 'DiseaseOrPhenotypicFeature', only_prefixes: 'MONDO' },
      expected: [],
      debounceMs: DEFAULT_DEBOUNCE_MS,
      highlight: true,
    });
    expect(url).toContain('only_prefixes=MONDO');
    expect(url).not.toContain('biolink_type');
  });
});

describe('parseExpectedCuries', () => {
  it('splits on whitespace, commas, and newlines', () => {
    expect(parseExpectedCuries('MONDO:1 HP:2,CHEBI:3\nHGNC:4')).toEqual([
      'MONDO:1', 'HP:2', 'CHEBI:3', 'HGNC:4',
    ]);
  });

  it('normalizes prefix to upper case but preserves identifier casing', () => {
    expect(parseExpectedCuries('mondo:0004979')).toEqual(['MONDO:0004979']);
    expect(parseExpectedCuries('ncbigene:1234')).toEqual(['NCBIGENE:1234']);
  });

  it('deduplicates', () => {
    expect(parseExpectedCuries('MONDO:1\nMONDO:1')).toEqual(['MONDO:1']);
  });

  it('skips blank tokens', () => {
    expect(parseExpectedCuries('  \n  MONDO:1  \n  ')).toEqual(['MONDO:1']);
  });

  it('leaves CURIEs with no colon alone', () => {
    expect(parseExpectedCuries('plainword')).toEqual(['plainword']);
  });
});
