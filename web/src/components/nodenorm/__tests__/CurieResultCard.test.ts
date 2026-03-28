import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import CurieResultCard from '../CurieResultCard.vue';
import type { NormalizedNode } from '../../../lib/types';
import ncitFixture from '../../../../../tests/fixtures/nodenorm_responses/ncit_c55060.json';
import mondoFixture from '../../../../../tests/fixtures/nodenorm_responses/mondo_0004979.json';
import prefixMapSubset from '../../../../../tests/fixtures/prefix_map_subset.json';

// NCIT:C55060 has 2 equiv IDs (≤10, small clique)
const smallCliqueNode = ncitFixture['NCIT:C55060'] as NormalizedNode;
// MONDO:0004979 has 28 equiv IDs (>10, large clique)
const largeCliqueNode = mondoFixture['MONDO:0004979'] as NormalizedNode;

const defaultProps = {
  index: 0,
  visibleColumns: new Set(['type', 'taxa', 'description']),
  prefixMap: prefixMapSubset,
};

describe('CurieResultCard', () => {
  it('shows preferred ID and label for a found CURIE', () => {
    const wrapper = mount(CurieResultCard, {
      props: { inputCurie: 'NCIT:C55060', node: smallCliqueNode, ...defaultProps },
    });
    expect(wrapper.text()).toContain('NCIT:C55060');
    expect(wrapper.text()).toContain('Hypertension, CTCAE');
  });

  it('shows "not found" for a null node', () => {
    const wrapper = mount(CurieResultCard, {
      props: { inputCurie: 'FAKE:9999', node: null, ...defaultProps },
    });
    expect(wrapper.text()).toContain('FAKE:9999');
    expect(wrapper.text()).toContain('not found');
  });

  it('shows equiv ID count in header', () => {
    const wrapper = mount(CurieResultCard, {
      props: { inputCurie: 'NCIT:C55060', node: smallCliqueNode, ...defaultProps },
    });
    expect(wrapper.text()).toContain('2 equiv. IDs');
  });

  it('does not show expand button for small clique (≤10 equiv IDs)', () => {
    const wrapper = mount(CurieResultCard, {
      props: { inputCurie: 'NCIT:C55060', node: smallCliqueNode, ...defaultProps },
    });
    // Small clique should NOT have "Show all" button
    expect(wrapper.text()).not.toContain('Show all');
  });

  it('shows prefix summary and expand button for large clique (>10 equiv IDs)', () => {
    const wrapper = mount(CurieResultCard, {
      props: { inputCurie: 'MONDO:0004979', node: largeCliqueNode, ...defaultProps },
    });
    // Large clique should show prefix summary (e.g. "MONDO: 1, DOID: 1, UMLS: ...")
    expect(wrapper.text()).toContain('MONDO:');
    expect(wrapper.text()).toContain('Show all');
    expect(wrapper.text()).toContain(`${largeCliqueNode.equivalent_identifiers.length} identifiers`);
  });

  it('displays biolink type badges in header', () => {
    const wrapper = mount(CurieResultCard, {
      props: { inputCurie: 'NCIT:C55060', node: smallCliqueNode, ...defaultProps },
    });
    // First type should be shown as badge (without biolink: prefix)
    expect(wrapper.text()).toContain('PhenotypicFeature');
  });
});
