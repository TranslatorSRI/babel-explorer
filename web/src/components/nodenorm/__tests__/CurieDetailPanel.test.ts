import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import CurieDetailPanel from '../CurieDetailPanel.vue';
import type { NormalizedNode } from '../../../lib/types';
import ncitFixture from '../../../../../tests/fixtures/nodenorm_responses/ncit_c55060.json';
import mondoFixture from '../../../../../tests/fixtures/nodenorm_responses/mondo_0004979.json';
import prefixMapSubset from '../../../../../tests/fixtures/prefix_map_subset.json';

// NCIT:C55060 has 2 equiv IDs (≤10, small clique)
const smallCliqueNode = ncitFixture['NCIT:C55060'] as NormalizedNode;
// MONDO:0004979 has 28 equiv IDs (>10, large clique)
const largeCliqueNode = mondoFixture['MONDO:0004979'] as NormalizedNode;

const defaultProps = {
  visibleColumns: new Set(['type', 'taxa', 'description']),
  prefixMap: prefixMapSubset,
};

describe('CurieDetailPanel', () => {
  it('shows "not found" message when node is null', () => {
    const wrapper = mount(CurieDetailPanel, {
      props: { node: null, ...defaultProps },
    });
    expect(wrapper.text()).toContain('not found in NodeNorm');
  });

  it('shows description when available', () => {
    const wrapper = mount(CurieDetailPanel, {
      props: { node: smallCliqueNode, ...defaultProps },
    });
    // NCIT:C55060 has descriptions
    expect(wrapper.text()).toContain('Description:');
  });

  it('shows biolink type badges', () => {
    const wrapper = mount(CurieDetailPanel, {
      props: { node: smallCliqueNode, ...defaultProps },
    });
    expect(wrapper.text()).toContain('PhenotypicFeature');
  });

  it('shows information content when available', () => {
    const wrapper = mount(CurieDetailPanel, {
      props: { node: smallCliqueNode, ...defaultProps },
    });
    if (smallCliqueNode.information_content) {
      expect(wrapper.text()).toContain('Information Content:');
    }
  });

  it('shows equiv ID count heading', () => {
    const wrapper = mount(CurieDetailPanel, {
      props: { node: smallCliqueNode, ...defaultProps },
    });
    expect(wrapper.text()).toContain(`Equivalent Identifiers (${smallCliqueNode.equivalent_identifiers.length})`);
  });

  it('shows full equiv ID table immediately for small clique (≤10 IDs)', () => {
    const wrapper = mount(CurieDetailPanel, {
      props: { node: smallCliqueNode, ...defaultProps },
    });
    // Should not show "Show all" button for small clique
    expect(wrapper.text()).not.toContain('Show all');
    // Table should be present
    expect(wrapper.find('table').exists()).toBe(true);
  });

  it('shows prefix summary and "Show all" button for large clique (>10 IDs)', () => {
    const wrapper = mount(CurieDetailPanel, {
      props: { node: largeCliqueNode, ...defaultProps },
    });
    expect(wrapper.text()).toContain('Show all');
    expect(wrapper.text()).toContain(`${largeCliqueNode.equivalent_identifiers.length} identifiers`);
    // Prefix summary shows prefix: count entries
    expect(wrapper.text()).toContain('MONDO:');
  });

  it('does not show full table before expanding large clique', () => {
    const wrapper = mount(CurieDetailPanel, {
      props: { node: largeCliqueNode, ...defaultProps },
    });
    expect(wrapper.find('table').exists()).toBe(false);
  });

  it('reveals equiv ID table after clicking "Show all"', async () => {
    const wrapper = mount(CurieDetailPanel, {
      props: { node: largeCliqueNode, ...defaultProps },
    });
    await wrapper.find('button').trigger('click');
    expect(wrapper.find('table').exists()).toBe(true);
    expect(wrapper.text()).toContain('Collapse');
  });

  it('collapses table after clicking "Collapse"', async () => {
    const wrapper = mount(CurieDetailPanel, {
      props: { node: largeCliqueNode, ...defaultProps },
    });
    // Expand
    await wrapper.find('button').trigger('click');
    // Collapse
    const collapseBtn = wrapper.findAll('button').find((b) => b.text() === 'Collapse');
    await collapseBtn!.trigger('click');
    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.text()).toContain('Show all');
  });
});
