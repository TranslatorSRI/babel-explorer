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
  visibleColumns: new Set(['type']),
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
    const text = wrapper.text();
    expect(text).toContain('MONDO:0004979');
    expect(text).toContain('asthma');
  });

  it('does not highlight row when all instances agree', () => {
    const wrapper = mount(ComparisonView, {
      props: { ...defaultProps, resultsByInstance: agreeResults },
    });
    // Summary row is the first tr in the first tbody
    const summaryRow = wrapper.findAll('tbody')[0].find('tr');
    expect(summaryRow.classes()).not.toContain('table-warning');
  });

  it('highlights row with table-warning when instances disagree', () => {
    const wrapper = mount(ComparisonView, {
      props: { ...defaultProps, resultsByInstance: disagreeResults },
    });
    const summaryRow = wrapper.findAll('tbody')[0].find('tr');
    expect(summaryRow.classes()).toContain('table-warning');
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
    const summaryRow = wrapper.findAll('tbody')[0].find('tr');
    expect(summaryRow.classes()).not.toContain('table-warning');
  });

  it('summary row has cursor:pointer style', () => {
    const wrapper = mount(ComparisonView, {
      props: { ...defaultProps, resultsByInstance: agreeResults },
    });
    const summaryRow = wrapper.findAll('tbody')[0].find('tr');
    expect(summaryRow.attributes('style')).toContain('cursor: pointer');
  });

  it('detail row is not rendered before clicking the summary row', () => {
    const wrapper = mount(ComparisonView, {
      props: { ...defaultProps, resultsByInstance: agreeResults },
    });
    const rows = wrapper.findAll('tbody')[0].findAll('tr');
    expect(rows.length).toBe(1);
  });

  it('renders detail row after clicking the summary row', async () => {
    const wrapper = mount(ComparisonView, {
      props: { ...defaultProps, resultsByInstance: agreeResults },
    });
    const tbody = wrapper.findAll('tbody')[0];
    await tbody.find('tr').trigger('click');
    expect(tbody.findAll('tr').length).toBe(2);
  });

  it('detail row contains instance name in expanded panel', async () => {
    const wrapper = mount(ComparisonView, {
      props: { ...defaultProps, resultsByInstance: agreeResults },
    });
    await wrapper.findAll('tbody')[0].find('tr').trigger('click');
    expect(wrapper.text()).toContain('Dev');
    expect(wrapper.text()).toContain('Prod');
  });

// ── Column visibility in main row ─────────────────────────────────────────────

describe('ComparisonView — column visibility', () => {
  const singleInstance = new Map<string, NodeNormResponse>([
    [devInstance.url, { 'MONDO:0004979': mondoFixture['MONDO:0004979'] }],
  ]);
  const singleInstanceProps = {
    curies: ['MONDO:0004979'],
    queriedInstances: [devInstance],
    prefixMap: prefixMapSubset,
    resultsByInstance: singleInstance,
  };

  it('shows type badges in main row when "type" is visible', () => {
    const wrapper = mount(ComparisonView, {
      props: { ...singleInstanceProps, visibleColumns: new Set(['type']) },
    });
    expect(wrapper.find('.badge').exists()).toBe(true);
  });

  it('hides type badges in main row when "type" is not visible', () => {
    const wrapper = mount(ComparisonView, {
      props: { ...singleInstanceProps, visibleColumns: new Set<string>() },
    });
    expect(wrapper.find('.badge').exists()).toBe(false);
  });

  it('updates type badge visibility when visibleColumns prop changes', async () => {
    const wrapper = mount(ComparisonView, {
      props: { ...singleInstanceProps, visibleColumns: new Set(['type']) },
    });
    expect(wrapper.find('.badge').exists()).toBe(true);

    await wrapper.setProps({ visibleColumns: new Set<string>() });
    expect(wrapper.find('.badge').exists()).toBe(false);

    await wrapper.setProps({ visibleColumns: new Set(['type']) });
    expect(wrapper.find('.badge').exists()).toBe(true);
  });
});

  it('collapses detail row on second click', async () => {
    const wrapper = mount(ComparisonView, {
      props: { ...defaultProps, resultsByInstance: agreeResults },
    });
    const tbody = wrapper.findAll('tbody')[0];
    const summaryRow = tbody.find('tr');
    await summaryRow.trigger('click');
    await summaryRow.trigger('click');
    expect(tbody.findAll('tr').length).toBe(1);
  });
});
