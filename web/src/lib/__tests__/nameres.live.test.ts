/**
 * Live contract test: does NameRes still answer the lookups the NameRes and
 * Autocomplete pages make, in the shape they read? Run with `npm run test:live`; see
 * web/tests/README.md.
 */
import { describe, it, expect } from 'vitest';
import { buildLookupUrl, fetchNameResLookup } from '../nameres-api';
import { DEFAULT_NAMERES_OPTIONS, type NameResApiOptions } from '../nameres-types';
import { labelFragment, renderHighlight } from '../highlight-sanitize';
import { expectCorsAllowsSite, liveInstances } from './live';

const opts = (overrides: Partial<NameResApiOptions> = {}): NameResApiOptions => ({
  ...DEFAULT_NAMERES_OPTIONS,
  limit: 10,
  ...overrides,
});

describe.each(liveInstances('nameres'))('$name', (instance) => {
  const lookup = (text: string, overrides?: Partial<NameResApiOptions>) =>
    fetchNameResLookup(instance.url, text, opts(overrides));

  it('lets the published site read its responses (CORS)', async () => {
    await expectCorsAllowsSite(buildLookupUrl(instance.url, 'asthma', opts()).toString());
  });

  it('returns results with the fields the result tables read', async () => {
    const results = await lookup('asthma', { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);
    for (const r of results) {
      expect(typeof r.curie).toBe('string');
      expect(typeof r.label).toBe('string');
      expect(r.types.length, r.curie).toBeGreaterThan(0);
      for (const t of r.types) expect(t).toMatch(/^biolink:/);
      expect(Array.isArray(r.taxa)).toBe(true);
      expect(Array.isArray(r.synonyms)).toBe(true);
      expect(typeof r.score).toBe('number');
      expect(typeof r.clique_identifier_count).toBe('number');
    }
  });

  it('still finds asthma (a sanity check, not a data test)', async () => {
    const results = await lookup('asthma', { limit: 5 });
    expect(results.map((r) => r.curie)).toContain('MONDO:0004979');
  });

  it('completes a prefix with autocomplete=true', async () => {
    const results = await lookup('diabe', { autocomplete: true });
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => /diabe/i.test(r.label))).toBe(true);
  });

  it('applies biolink_type, only_prefixes and exclude_prefixes', async () => {
    const [byType, onlyMondo, noMondo] = await Promise.all([
      lookup('diabetes', { biolink_type: 'Disease' }),
      lookup('diabetes', { only_prefixes: 'MONDO' }),
      lookup('diabetes', { exclude_prefixes: 'MONDO' }),
    ]);
    for (const [results, name] of [[byType, 'biolink_type'], [onlyMondo, 'only_prefixes'], [noMondo, 'exclude_prefixes']] as const) {
      expect(results.length, name).toBeGreaterThan(0);
    }
    for (const r of byType) expect(r.types, r.curie).toContain('biolink:Disease');
    for (const r of onlyMondo) expect(r.curie).toMatch(/^MONDO:/);
    for (const r of noMondo) expect(r.curie).not.toMatch(/^MONDO:/);
  });

  // NameRes also returns results that are not taxon-specific (empty taxa), by design.
  it('applies only_taxa', async () => {
    const results = await lookup('BRCA1', { biolink_type: 'Gene', only_taxa: 'NCBITaxon:9606' });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      if (r.taxa.length > 0) expect(r.taxa, r.curie).toContain('NCBITaxon:9606');
    }
    expect(results.some((r) => r.taxa.includes('NCBITaxon:9606'))).toBe(true);
  });

  it('returns highlighting in the format renderHighlight understands', async () => {
    const results = await lookup('asthma', { limit: 5, highlighting: true });
    for (const r of results) {
      for (const field of ['labels', 'synonyms']) {
        const fragments = r.highlighting?.[field];
        expect(Array.isArray(fragments), `${r.curie} highlighting.${field}`).toBe(true);
        for (const f of fragments as unknown[]) expect(typeof f).toBe('string');
      }
    }
    // The marks must come through as <mark>, with no tag or entity left as text.
    const rendered = renderHighlight(labelFragment(results[0]));
    expect(rendered).toContain('<mark>');
    expect(rendered).not.toMatch(/&lt;|&#x|&amp;#/);
  });

  it('returns no highlighting unless asked, so the Autocomplete page must ask', async () => {
    const results = await lookup('asthma', { limit: 3 });
    for (const r of results) expect(r.highlighting ?? {}).toEqual({});
  });
});
