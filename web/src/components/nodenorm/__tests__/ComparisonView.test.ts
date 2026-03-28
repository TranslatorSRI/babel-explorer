import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ComparisonView from '../ComparisonView.vue';
import type { NodeNormResponse, NodeNormInstance } from '../../../lib/types';
import mondoFixture from '../../../../../tests/fixtures/nodenorm_responses/mondo_0004979.json';
import prefixMapSubset from '../../../../../tests/fixtures/prefix_map_subset.json';

const devInstance: NodeNormInstance = { name: 'Dev', env: 'dev', url: 'https://dev.example.com/' };
const prodInstance: NodeNormInstance = { name: 'Prod', env: 'prod', url: 'https://prod.example.com/' };

// Both instances agree on MONDO:0004979
const agreeResults = new Map<string, NodeNormResponse>([
  [devInstance.url, { 'MONDO:0004979': mondoFixture['MONDO:0004979'] }],
  [prodInstance.url, { 'MONDO:0004979': mondoFixture['MONDO:0004979'] }],
]);

// Instances disagree: dev normalizes, prod returns null
const disagreeResults = new Map<string, NodeNormResponse>([
  [devInstance.url, { 'MONDO:0004979': mondoFixture['MONDO:0004979'] }],
  [prodInstance.url, { 'MONDO:0004979': null }],
]);

const defaultProps = {
  curies: ['MONDO:0004979'],
  queriedInstances: [devInstance, prodInstance],
  prefixMap: prefixMapSubset,
};

describe('ComparisonView', () => {
  it('renders instance names as column headers', () => {
    const wrapper = mount(ComparisonView, {
      props: { ...defaultProps, resultsByInstance: agreeResults },
    });
    expect(wrapper.text()).toContain('Dev');
    expect(wrapper.text()).toContain('Prod');
  });

  it('shows preferred ID and label when instances agree', () => {
    const wrapper = mount(ComparisonView, {
      props: { ...defaultProps, resultsByInstance: agreeResults },
    });
    // Both cells should show MONDO:0004979 and "asthma"
    const text = wrapper.text();
    expect(text).toContain('MONDO:0004979');
    expect(text).toContain('asthma');
  });

  it('does not highlight row when all instances agree', () => {
    const wrapper = mount(ComparisonView, {
      props: { ...defaultProps, resultsByInstance: agreeResults },
    });
    const rows = wrapper.findAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].classes()).not.toContain('table-warning');
  });

  it('highlights row with table-warning when instances disagree', () => {
    const wrapper = mount(ComparisonView, {
      props: { ...defaultProps, resultsByInstance: disagreeResults },
    });
    const rows = wrapper.findAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].classes()).toContain('table-warning');
  });

  it('shows "Not found" for instances that return null', () => {
    const wrapper = mount(ComparisonView, {
      props: { ...defaultProps, resultsByInstance: disagreeResults },
    });
    expect(wrapper.text()).toContain('Not found');
  });

  it('shows equiv ID count for found results', () => {
    const wrapper = mount(ComparisonView, {
      props: { ...defaultProps, resultsByInstance: agreeResults },
    });
    const equivCount = mondoFixture['MONDO:0004979'].equivalent_identifiers.length;
    expect(wrapper.text()).toContain(`${equivCount} equiv. IDs`);
  });

  it('does not highlight row when only one instance queried', () => {
    const singleInstance = new Map<string, NodeNormResponse>([
      [devInstance.url, { 'MONDO:0004979': mondoFixture['MONDO:0004979'] }],
    ]);
    const wrapper = mount(ComparisonView, {
      props: {
        ...defaultProps,
        queriedInstances: [devInstance],
        resultsByInstance: singleInstance,
      },
    });
    const rows = wrapper.findAll('tbody tr');
    expect(rows[0].classes()).not.toContain('table-warning');
  });
});
