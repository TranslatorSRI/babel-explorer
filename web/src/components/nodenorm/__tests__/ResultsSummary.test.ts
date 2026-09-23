import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ResultsSummary from '../ResultsSummary.vue';
import type { NodeNormResponse, NodeNormInstance } from '../../../lib/types';
import mondoFixture from '../../../../../tests/fixtures/nodenorm_responses/mondo_0004979.json';
import ncitFixture from '../../../../../tests/fixtures/nodenorm_responses/ncit_c55060.json';

const devInstance: NodeNormInstance = { name: 'Dev', env: 'dev', url: 'https://dev.example.com/' };
const prodInstance: NodeNormInstance = { name: 'Prod', env: 'prod', url: 'https://prod.example.com/' };

const mondoNode = mondoFixture['MONDO:0004979'];
const ncitNode = ncitFixture['NCIT:C55060'];

// ── Fixture helpers ───────────────────────────────────────────────────────────

function singleInstanceResults(resp: NodeNormResponse) {
  return {
    resultsByInstance: new Map([[devInstance.url, resp]]),
    queriedInstances: [devInstance],
    selectedTypes: new Set<string>(),
  };
}

function twoInstanceResults(devResp: NodeNormResponse, prodResp: NodeNormResponse) {
  return {
    resultsByInstance: new Map([
      [devInstance.url, devResp],
      [prodInstance.url, prodResp],
    ]),
    queriedInstances: [devInstance, prodInstance],
    selectedTypes: new Set<string>(),
  };
}

// ── Normalized tile ───────────────────────────────────────────────────────────

describe('ResultsSummary — normalized tile', () => {
  it('shows correct count when all CURIEs are found', () => {
    const wrapper = mount(ResultsSummary, {
      props: {
        ...singleInstanceResults({ 'MONDO:0004979': mondoNode }),
        curies: ['MONDO:0004979'],
      },
    });
    expect(wrapper.text()).toContain('1');
    expect(wrapper.text()).toContain('/ 1');
  });

  it('shows "not found" detail when a CURIE is missing from all instances', () => {
    const wrapper = mount(ResultsSummary, {
      props: {
        ...singleInstanceResults({ 'MONDO:0004979': mondoNode, 'FAKE:999': null }),
        curies: ['MONDO:0004979', 'FAKE:999'],
      },
    });
    expect(wrapper.text()).toContain('not found');
    expect(wrapper.text()).toContain('FAKE:999');
  });

  it('does not show "not found" when all CURIEs are found', () => {
    const wrapper = mount(ResultsSummary, {
      props: {
        ...singleInstanceResults({ 'MONDO:0004979': mondoNode }),
        curies: ['MONDO:0004979'],
      },
    });
    expect(wrapper.text()).not.toContain('not found');
  });

  it('shows "partial" when a CURIE is found by some instances but not all', () => {
    const wrapper = mount(ResultsSummary, {
      props: {
        ...twoInstanceResults(
          { 'MONDO:0004979': mondoNode },
          { 'MONDO:0004979': null },          // prod doesn't find it
        ),
        curies: ['MONDO:0004979'],
      },
    });
    expect(wrapper.text()).toContain('partial');
    expect(wrapper.text()).toContain('MONDO:0004979');
  });

  it('truncates long not-found list with "+N more"', () => {
    const resp: NodeNormResponse = {
      'FAKE:1': null, 'FAKE:2': null, 'FAKE:3': null, 'FAKE:4': null,
    };
    const wrapper = mount(ResultsSummary, {
      props: {
        ...singleInstanceResults(resp),
        curies: ['FAKE:1', 'FAKE:2', 'FAKE:3', 'FAKE:4'],
      },
    });
    expect(wrapper.text()).toContain('+1 more');
  });
});

// ── Disagreements tile ────────────────────────────────────────────────────────

describe('ResultsSummary — disagreements tile', () => {
  it('is not rendered for a single instance', () => {
    const wrapper = mount(ResultsSummary, {
      props: {
        ...singleInstanceResults({ 'MONDO:0004979': mondoNode }),
        curies: ['MONDO:0004979'],
      },
    });
    expect(wrapper.text()).not.toContain('Disagreements');
  });

  it('shows 0 disagreements and "All instances agree" when both agree', () => {
    const wrapper = mount(ResultsSummary, {
      props: {
        ...twoInstanceResults(
          { 'MONDO:0004979': mondoNode },
          { 'MONDO:0004979': mondoNode },
        ),
        curies: ['MONDO:0004979'],
      },
    });
    expect(wrapper.text()).toContain('Disagreements');
    expect(wrapper.text()).toContain('0');
    expect(wrapper.text()).toContain('All instances agree');
  });

  it('counts a disagreement when one instance returns null and another does not', () => {
    const wrapper = mount(ResultsSummary, {
      props: {
        ...twoInstanceResults(
          { 'MONDO:0004979': mondoNode },
          { 'MONDO:0004979': null },
        ),
        curies: ['MONDO:0004979'],
      },
    });
    expect(wrapper.text()).toContain('1');
    expect(wrapper.text()).toContain('MONDO:0004979');
  });

  it('counts a disagreement when instances return different preferred IDs', () => {
    // Simulate dev returning MONDO:0004979 and prod returning NCIT:C55060
    // as the preferred ID for the same input
    const modifiedProdNode = { ...mondoNode, id: { ...mondoNode.id, identifier: 'NCIT:C55060' } };
    const wrapper = mount(ResultsSummary, {
      props: {
        ...twoInstanceResults(
          { 'MONDO:0004979': mondoNode },
          { 'MONDO:0004979': modifiedProdNode },
        ),
        curies: ['MONDO:0004979'],
      },
    });
    expect(wrapper.text()).toContain('1');
  });
});

// ── Types tile ────────────────────────────────────────────────────────────────

describe('ResultsSummary — types tile', () => {
  it('shows most-specific type as a button', () => {
    const wrapper = mount(ResultsSummary, {
      props: {
        ...singleInstanceResults({ 'NCIT:C55060': ncitNode }),
        curies: ['NCIT:C55060'],
      },
    });
    const buttons = wrapper.findAll('button');
    expect(buttons.some((b) => b.text().includes('PhenotypicFeature'))).toBe(true);
  });

  it('uses only the most-specific type per CURIE — no ancestor types', () => {
    const wrapper = mount(ResultsSummary, {
      props: {
        ...singleInstanceResults({
          'MONDO:0004979': mondoNode,
          'NCIT:C55060': ncitNode,
        }),
        curies: ['MONDO:0004979', 'NCIT:C55060'],
      },
    });
    expect(wrapper.text()).toContain('Disease');
    expect(wrapper.text()).toContain('PhenotypicFeature');
    expect(wrapper.text()).not.toContain('NamedThing');
  });

  it('counts each CURIE once even when queried on multiple instances', () => {
    const wrapper = mount(ResultsSummary, {
      props: {
        ...twoInstanceResults(
          { 'MONDO:0004979': mondoNode },
          { 'MONDO:0004979': mondoNode },
        ),
        curies: ['MONDO:0004979'],
      },
    });
    // Same CURIE on 2 instances should still count as 1 distinct CURIE
    expect(wrapper.text()).toContain('Disease');
    expect(wrapper.text()).not.toContain('Disease 2');
  });

  it('does not render types tile when no results are found', () => {
    const wrapper = mount(ResultsSummary, {
      props: {
        ...singleInstanceResults({ 'FAKE:999': null }),
        curies: ['FAKE:999'],
      },
    });
    expect(wrapper.text()).not.toContain('Types');
  });

  it('inactive type button has btn-outline-secondary class', () => {
    const wrapper = mount(ResultsSummary, {
      props: {
        ...singleInstanceResults({ 'MONDO:0004979': mondoNode }),
        curies: ['MONDO:0004979'],
        selectedTypes: new Set<string>(),
      },
    });
    const typeBtn = wrapper.findAll('button').find((b) => b.text().includes('Disease'))!;
    expect(typeBtn.classes()).toContain('btn-outline-secondary');
    expect(typeBtn.classes()).not.toContain('btn-secondary');
  });

  it('active type button has btn-secondary class', () => {
    const wrapper = mount(ResultsSummary, {
      props: {
        ...singleInstanceResults({ 'MONDO:0004979': mondoNode }),
        curies: ['MONDO:0004979'],
        selectedTypes: new Set(['Disease']),
      },
    });
    const typeBtn = wrapper.findAll('button').find((b) => b.text().includes('Disease'))!;
    expect(typeBtn.classes()).toContain('btn-secondary');
    expect(typeBtn.classes()).not.toContain('btn-outline-secondary');
  });

  it('emits toggle-type-filter with the type name when a button is clicked', async () => {
    const wrapper = mount(ResultsSummary, {
      props: {
        ...singleInstanceResults({ 'MONDO:0004979': mondoNode }),
        curies: ['MONDO:0004979'],
      },
    });
    const typeBtn = wrapper.findAll('button').find((b) => b.text().includes('Disease'))!;
    await typeBtn.trigger('click');
    expect(wrapper.emitted('toggle-type-filter')).toEqual([['Disease']]);
  });

  it('"clear" button is absent when no types are selected', () => {
    const wrapper = mount(ResultsSummary, {
      props: {
        ...singleInstanceResults({ 'MONDO:0004979': mondoNode }),
        curies: ['MONDO:0004979'],
        selectedTypes: new Set<string>(),
      },
    });
    expect(wrapper.text()).not.toContain('clear');
  });

  it('"clear" button appears when selectedTypes is non-empty', () => {
    const wrapper = mount(ResultsSummary, {
      props: {
        ...singleInstanceResults({ 'MONDO:0004979': mondoNode }),
        curies: ['MONDO:0004979'],
        selectedTypes: new Set(['Disease']),
      },
    });
    expect(wrapper.text()).toContain('clear');
  });

  it('emits clear-type-filter when "clear" button is clicked', async () => {
    const wrapper = mount(ResultsSummary, {
      props: {
        ...singleInstanceResults({ 'MONDO:0004979': mondoNode }),
        curies: ['MONDO:0004979'],
        selectedTypes: new Set(['Disease']),
      },
    });
    const clearBtn = wrapper.findAll('button').find((b) => b.text() === 'clear')!;
    await clearBtn.trigger('click');
    expect(wrapper.emitted('clear-type-filter')).toBeTruthy();
  });
});
