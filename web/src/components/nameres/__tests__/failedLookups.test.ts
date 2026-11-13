import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import NameResComparisonView from '../NameResComparisonView.vue';
import NameResResultsSummary from '../NameResResultsSummary.vue';
import type { NameResInstance, NameResResult, ParsedSearchTerm } from '../../../lib/nameres-types';

// A failed lookup has no entry in resultsByInstance; an empty one maps to [].

const dev: NameResInstance = { name: 'NameRes Dev', env: 'dev', url: 'https://dev.example/' };
const prod: NameResInstance = { name: 'NameRes Prod', env: 'prod', url: 'https://prod.example/' };

function result(curie: string): NameResResult {
  return { curie, label: curie, types: [], taxa: [], synonyms: [], score: 1, clique_identifier_count: 1 };
}

function term(text: string, expectedCuries: string[] = []): ParsedSearchTerm {
  return { text, raw: text, expectedCuries };
}

const terms = [term('asthma', ['MONDO:1']), term('nothing')];

// Dev answered both; Prod's "asthma" lookup failed and its "nothing" lookup found nothing.
const resultsByInstance = new Map([
  [dev.url, new Map([['asthma', [result('MONDO:1')]], ['nothing', []]])],
  [prod.url, new Map([['nothing', []]])],
]);

const props = { resultsByInstance, queriedInstances: [dev, prod], terms, threshold: 5 };

describe('NameResComparisonView — failed lookups', () => {
  it('shows a failed lookup as failed, not as finding nothing', () => {
    const rows = mount(NameResComparisonView, { props }).findAll('tbody tr');
    expect(rows[0].text()).toContain('Request failed');
    expect(rows[0].text()).not.toContain('No results');
    expect(rows[1].text()).toContain('No results');
    expect(rows[1].text()).not.toContain('Request failed');
  });

  it('judges a term only by the instances that answered', () => {
    const row = mount(NameResComparisonView, { props }).find('tbody tr');
    // Dev ranks the expected CURIE first; Prod's failure is neither a pass nor a fail.
    expect(row.classes()).toContain('table-success');
    expect(row.text()).not.toContain('not found');
  });

  it('says the lookup failed in the expanded detail', async () => {
    const wrapper = mount(NameResComparisonView, { props });
    await wrapper.find('tbody tr').trigger('click');
    expect(wrapper.text()).toContain('The lookup on this instance failed.');
  });
});

describe('NameResResultsSummary — failed lookups', () => {
  it('counts terms by the instances that answered, and reports failures separately', () => {
    const wrapper = mount(NameResResultsSummary, { props });
    const text = wrapper.text();
    expect(text).toMatch(/Resolved\s*1\s*\/ 2/);
    expect(text).toContain('1 no results (nothing)');
    expect(text).toContain('1 with a failed lookup (asthma)');
    expect(text).toMatch(/1\s*pass/);
    expect(wrapper.find('.badge.bg-danger').exists()).toBe(false); // no "fail" count
  });

  it('counts an annotated term that no instance answered as not checked', () => {
    const text = mount(NameResResultsSummary, {
      props: { ...props, terms: [...terms, term('unanswered', ['MONDO:2'])] },
    }).text();
    expect(text).toMatch(/1\s*pass/);
    expect(text).toMatch(/1\s*not checked/);
    expect(text).toContain('2 annotated terms');
  });

  it('does not count a failed lookup as a disagreement', () => {
    const text = mount(NameResResultsSummary, { props }).text();
    expect(text).toContain('All instances agree on #1');
  });
});
