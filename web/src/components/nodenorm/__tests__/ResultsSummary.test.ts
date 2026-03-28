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
  };
}

function twoInstanceResults(devResp: NodeNormResponse, prodResp: NodeNormResponse) {
  return {
    resultsByInstance: new Map([
      [devInstance.url, devResp],
      [prodInstance.url, prodResp],
    ]),
    queriedInstances: [devInstance, prodInstance],
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
  it('shows types from results as badges', () => {
    const wrapper = mount(ResultsSummary, {
      props: {
        ...singleInstanceResults({ 'NCIT:C55060': ncitNode }),
        curies: ['NCIT:C55060'],
      },
    });
    expect(wrapper.text()).toContain('PhenotypicFeature');
  });

  it('aggregates type counts across multiple CURIEs', () => {
    const wrapper = mount(ResultsSummary, {
      props: {
        ...singleInstanceResults({
          'MONDO:0004979': mondoNode,
          'NCIT:C55060': ncitNode,
        }),
        curies: ['MONDO:0004979', 'NCIT:C55060'],
      },
    });
    // Both share NamedThing — it should appear with ×2
    expect(wrapper.text()).toContain('NamedThing ×2');
  });

  it('aggregates type counts across multiple instances', () => {
    const wrapper = mount(ResultsSummary, {
      props: {
        ...twoInstanceResults(
          { 'MONDO:0004979': mondoNode },
          { 'MONDO:0004979': mondoNode },
        ),
        curies: ['MONDO:0004979'],
      },
    });
    // The same types appear in both instances — counts should be doubled
    const diseaseCount = mondoNode.type.filter((t) => t === 'biolink:Disease').length;
    expect(wrapper.text()).toContain(`Disease ×${diseaseCount * 2}`);
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
});
