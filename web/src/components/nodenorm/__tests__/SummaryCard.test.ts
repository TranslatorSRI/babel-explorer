import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import SummaryCard from '../SummaryCard.vue';
import type { NodeNormResponse } from '../../../lib/types';
import mondoFixture from '../../../../../tests/fixtures/nodenorm_responses/mondo_0004979.json';
import ncitFixture from '../../../../../tests/fixtures/nodenorm_responses/ncit_c55060.json';

// Build a mixed response: two found, one not found.
const mixedResults: NodeNormResponse = {
  'MONDO:0004979': mondoFixture['MONDO:0004979'],
  'NCIT:C55060': ncitFixture['NCIT:C55060'],
  'FAKE:9999': null,
};
const mixedCuries = ['MONDO:0004979', 'NCIT:C55060', 'FAKE:9999'];

describe('SummaryCard', () => {
  it('displays correct normalized count', () => {
    const wrapper = mount(SummaryCard, {
      props: { results: mixedResults, curies: mixedCuries },
    });
    // "2 of 3 CURIEs normalized"
    expect(wrapper.text()).toContain('2');
    expect(wrapper.text()).toContain('3');
    expect(wrapper.text()).toContain('normalized');
  });

  it('lists not-found CURIEs', () => {
    const wrapper = mount(SummaryCard, {
      props: { results: mixedResults, curies: mixedCuries },
    });
    expect(wrapper.text()).toContain('FAKE:9999');
    expect(wrapper.text()).toContain('not found');
  });

  it('does not show not-found message when all are found', () => {
    const allFound: NodeNormResponse = {
      'MONDO:0004979': mondoFixture['MONDO:0004979'],
    };
    const wrapper = mount(SummaryCard, {
      props: { results: allFound, curies: ['MONDO:0004979'] },
    });
    expect(wrapper.text()).not.toContain('not found');
  });

  it('shows type breakdown', () => {
    const wrapper = mount(SummaryCard, {
      props: { results: mixedResults, curies: mixedCuries },
    });
    // MONDO has biolink:Disease, NCIT has biolink:PhenotypicFeature
    // Both share biolink:NamedThing (and others)
    expect(wrapper.text()).toContain('NamedThing');
  });

  it('shows shared types when all normalized results share a type', () => {
    // Both MONDO:0004979 and NCIT:C55060 have biolink:NamedThing
    const wrapper = mount(SummaryCard, {
      props: { results: mixedResults, curies: mixedCuries },
    });
    // "All are:" section should show NamedThing
    expect(wrapper.text()).toContain('All are');
    expect(wrapper.text()).toContain('NamedThing');
  });

  it('handles edge case: all CURIEs not found', () => {
    const allMissing: NodeNormResponse = {
      'FAKE:1': null,
      'FAKE:2': null,
    };
    const wrapper = mount(SummaryCard, {
      props: { results: allMissing, curies: ['FAKE:1', 'FAKE:2'] },
    });
    expect(wrapper.text()).toContain('0');
    expect(wrapper.text()).toContain('2');
    // No type breakdown when nothing is normalized
    expect(wrapper.text()).not.toContain('Type breakdown');
  });
});
