/**
 * Live contract test: does NodeNorm still answer the requests the NodeNorm page makes
 * in the shape the page reads? Run with `npm run test:live`; see web/tests/README.md.
 */
import { describe, it, expect } from 'vitest';
import { buildNodeNormUrl, fetchNormalizedNodes, getDirectTypes } from '../nodenorm-api';
import { DEFAULT_API_OPTIONS, type NodeNormResponse } from '../types';
import { expectCorsAllowsSite, liveInstances } from './live';

describe.each(liveInstances('nodenorm'))('$name', (instance) => {
  // The page's default request: every option on, as DEFAULT_API_OPTIONS has them.
  let cached: Promise<NodeNormResponse> | undefined;
  const batch = () =>
    (cached ??= fetchNormalizedNodes(
      instance.url,
      ['MONDO:0004979', 'NCBIGene:1756', 'FAKE:9999999'],
      DEFAULT_API_OPTIONS,
    ));

  it('lets the published site read its responses (CORS)', async () => {
    await expectCorsAllowsSite(buildNodeNormUrl(instance.url, ['MONDO:0004979'], DEFAULT_API_OPTIONS));
  });

  it('answers a GET batch with one key per CURIE, null for an unknown one', async () => {
    const res = await batch();
    expect(Object.keys(res).sort()).toEqual(['FAKE:9999999', 'MONDO:0004979', 'NCBIGene:1756']);
    expect(res['FAKE:9999999']).toBeNull();
  });

  it('returns the preferred identifier, Biolink types and information content', async () => {
    const node = (await batch())['MONDO:0004979']!;
    expect(node.id.identifier).toBe('MONDO:0004979');
    expect(typeof node.id.label).toBe('string');
    expect(node.type.length).toBeGreaterThan(0);
    for (const t of node.type) expect(t).toMatch(/^biolink:/);
    expect(typeof node.information_content).toBe('number');
  });

  it('types each equivalent identifier (individual_types), as getDirectTypes reads', async () => {
    const node = (await batch())['MONDO:0004979']!;
    for (const eq of node.equivalent_identifiers) {
      expect(typeof eq.identifier).toBe('string');
      expect(eq.type, eq.identifier).toMatch(/^biolink:/);
    }
    expect(getDirectTypes(node).length).toBeGreaterThan(0);
  });

  it('returns descriptions (description=true)', async () => {
    const node = (await batch())['MONDO:0004979']!;
    expect(typeof node.id.description).toBe('string');
    expect(node.descriptions?.length).toBeGreaterThan(0);
    for (const d of node.descriptions!) expect(typeof d).toBe('string');
  });

  // KNOWN GAP: the equivalent-identifier table's Taxa column reads `taxa` on each
  // identifier, as Redis-backed NodeNorm returned it. NodeNorm-ES ignores include_taxa
  // and returns taxa only on the node (src/nodenorm/handlers/normalized_nodes.py), so
  // that column is empty on every ElasticSearch deployment. it.fails keeps this green
  // while the gap lasts and turns it red once per-identifier taxa return: then make it
  // a plain `it`.
  it.fails('puts taxa on a gene\'s equivalent identifiers (include_taxa)', async () => {
    const gene = (await batch())['NCBIGene:1756']!;
    expect(gene.equivalent_identifiers.some((eq) => (eq.taxa ?? []).length > 0)).toBe(true);
  });

  it('gives a different clique for water with conflation on and off', async () => {
    const off = { ...DEFAULT_API_OPTIONS, conflate: false, drug_chemical_conflate: false };
    const [on, without] = await Promise.all([
      fetchNormalizedNodes(instance.url, ['MESH:D014867'], DEFAULT_API_OPTIONS),
      fetchNormalizedNodes(instance.url, ['MESH:D014867'], off),
    ]);
    expect(on['MESH:D014867']!.equivalent_identifiers.length).toBeGreaterThan(
      without['MESH:D014867']!.equivalent_identifiers.length,
    );
  });
});
