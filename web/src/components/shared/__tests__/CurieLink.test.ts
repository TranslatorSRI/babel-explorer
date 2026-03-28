import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import CurieLink from '../CurieLink.vue';
import prefixMapSubset from '../../../../../tests/fixtures/prefix_map_subset.json';

describe('CurieLink', () => {
  it('renders <a> with correct href when prefix is in map', () => {
    const wrapper = mount(CurieLink, {
      props: { curie: 'MONDO:0004979', prefixMap: prefixMapSubset },
    });
    const link = wrapper.find('a');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toBe('http://purl.obolibrary.org/obo/MONDO_0004979');
    expect(link.attributes('target')).toBe('_blank');
    expect(link.text()).toBe('MONDO:0004979');
  });

  it('renders <span> when prefix is not in map', () => {
    const wrapper = mount(CurieLink, {
      props: { curie: 'FAKE:9999', prefixMap: prefixMapSubset },
    });
    expect(wrapper.find('a').exists()).toBe(false);
    const span = wrapper.find('span');
    expect(span.exists()).toBe(true);
    expect(span.text()).toBe('FAKE:9999');
  });

  it('displays CURIE text in both linked and unlinked cases', () => {
    const linked = mount(CurieLink, {
      props: { curie: 'CHEBI:48947', prefixMap: prefixMapSubset },
    });
    expect(linked.text()).toBe('CHEBI:48947');

    const unlinked = mount(CurieLink, {
      props: { curie: 'UNKNOWN:123', prefixMap: prefixMapSubset },
    });
    expect(unlinked.text()).toBe('UNKNOWN:123');
  });
});
