import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import EquivalentIdTable from '../EquivalentIdTable.vue';
import mondoFixture from '../../../../../tests/fixtures/nodenorm_responses/mondo_0004979.json';
import prefixMapSubset from '../../../../../tests/fixtures/prefix_map_subset.json';

const identifiers = mondoFixture['MONDO:0004979'].equivalent_identifiers;

function headers(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('th').map((th) => th.text());
}

// ── Column presence ───────────────────────────────────────────────────────────

describe('EquivalentIdTable — column visibility', () => {
  it('always renders Identifier and Label columns', () => {
    const wrapper = mount(EquivalentIdTable, {
      props: { identifiers, visibleColumns: new Set<string>(), prefixMap: prefixMapSubset },
    });
    expect(headers(wrapper)).toContain('Identifier');
    expect(headers(wrapper)).toContain('Label');
  });

  it('shows Biolink Type column when "type" is visible', () => {
    const wrapper = mount(EquivalentIdTable, {
      props: { identifiers, visibleColumns: new Set(['type']), prefixMap: prefixMapSubset },
    });
    expect(headers(wrapper)).toContain('Biolink Type');
  });

  it('hides Biolink Type column when "type" is not visible', () => {
    const wrapper = mount(EquivalentIdTable, {
      props: { identifiers, visibleColumns: new Set<string>(), prefixMap: prefixMapSubset },
    });
    expect(headers(wrapper)).not.toContain('Biolink Type');
  });

  it('shows Taxa column when "taxa" is visible', () => {
    const wrapper = mount(EquivalentIdTable, {
      props: { identifiers, visibleColumns: new Set(['taxa']), prefixMap: prefixMapSubset },
    });
    expect(headers(wrapper)).toContain('Taxa');
  });

  it('hides Taxa column when "taxa" is not visible', () => {
    const wrapper = mount(EquivalentIdTable, {
      props: { identifiers, visibleColumns: new Set(['type']), prefixMap: prefixMapSubset },
    });
    expect(headers(wrapper)).not.toContain('Taxa');
  });

  it('shows Description column when "description" is visible', () => {
    const wrapper = mount(EquivalentIdTable, {
      props: { identifiers, visibleColumns: new Set(['description']), prefixMap: prefixMapSubset },
    });
    expect(headers(wrapper)).toContain('Description');
  });

  it('hides Description column when "description" is not visible', () => {
    const wrapper = mount(EquivalentIdTable, {
      props: { identifiers, visibleColumns: new Set(['type']), prefixMap: prefixMapSubset },
    });
    expect(headers(wrapper)).not.toContain('Description');
  });

  it('shows all three extra columns when all are visible', () => {
    const wrapper = mount(EquivalentIdTable, {
      props: {
        identifiers,
        visibleColumns: new Set(['type', 'taxa', 'description']),
        prefixMap: prefixMapSubset,
      },
    });
    const h = headers(wrapper);
    expect(h).toContain('Biolink Type');
    expect(h).toContain('Taxa');
    expect(h).toContain('Description');
  });

  it('shows only Identifier and Label when visibleColumns is empty', () => {
    const wrapper = mount(EquivalentIdTable, {
      props: { identifiers, visibleColumns: new Set<string>(), prefixMap: prefixMapSubset },
    });
    const h = headers(wrapper);
    expect(h).toEqual(['Identifier', 'Label']);
  });
});

// ── Data rows ────────────────────────────────────────────────────────────────

describe('EquivalentIdTable — data rows', () => {
  it('renders one row per identifier', () => {
    const wrapper = mount(EquivalentIdTable, {
      props: { identifiers, visibleColumns: new Set(['type']), prefixMap: prefixMapSubset },
    });
    expect(wrapper.findAll('tbody tr').length).toBe(identifiers.length);
  });

  it('renders no rows for empty identifier list', () => {
    const wrapper = mount(EquivalentIdTable, {
      props: { identifiers: [], visibleColumns: new Set(['type']), prefixMap: prefixMapSubset },
    });
    expect(wrapper.findAll('tbody tr').length).toBe(0);
  });
});

// ── Reactivity ───────────────────────────────────────────────────────────────

describe('EquivalentIdTable — reactivity', () => {
  it('adds column header when visibleColumns prop gains a key', async () => {
    const wrapper = mount(EquivalentIdTable, {
      props: { identifiers, visibleColumns: new Set<string>(), prefixMap: prefixMapSubset },
    });
    expect(headers(wrapper)).not.toContain('Biolink Type');

    await wrapper.setProps({ visibleColumns: new Set(['type']) });

    expect(headers(wrapper)).toContain('Biolink Type');
  });

  it('removes column header when visibleColumns prop loses a key', async () => {
    const wrapper = mount(EquivalentIdTable, {
      props: { identifiers, visibleColumns: new Set(['type']), prefixMap: prefixMapSubset },
    });
    expect(headers(wrapper)).toContain('Biolink Type');

    await wrapper.setProps({ visibleColumns: new Set<string>() });

    expect(headers(wrapper)).not.toContain('Biolink Type');
  });
});
