import { describe, it, expect } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mount } from '@vue/test-utils';
import ColumnVisibility from '../ColumnVisibility.vue';

// ── Rendering ─────────────────────────────────────────────────────────────────

describe('ColumnVisibility — rendering', () => {
  it('renders three toggle buttons with correct labels', () => {
    const wrapper = mount(ColumnVisibility, {
      props: { visibleColumns: new Set(['type']) },
    });
    const buttons = wrapper.findAll('button');
    expect(buttons.length).toBe(3);
    expect(buttons[0].text()).toBe('Biolink Type');
    expect(buttons[1].text()).toBe('Taxa');
    expect(buttons[2].text()).toBe('Description');
  });

  it('active column button has btn-secondary class', () => {
    const wrapper = mount(ColumnVisibility, {
      props: { visibleColumns: new Set(['type']) },
    });
    const buttons = wrapper.findAll('button');
    expect(buttons[0].classes()).toContain('btn-secondary');
    expect(buttons[0].classes()).not.toContain('btn-outline-secondary');
  });

  it('inactive column button has btn-outline-secondary class', () => {
    const wrapper = mount(ColumnVisibility, {
      props: { visibleColumns: new Set(['type']) },
    });
    const buttons = wrapper.findAll('button');
    expect(buttons[1].classes()).toContain('btn-outline-secondary');
    expect(buttons[1].classes()).not.toContain('btn-secondary');
    expect(buttons[2].classes()).toContain('btn-outline-secondary');
    expect(buttons[2].classes()).not.toContain('btn-secondary');
  });

  it('highlights multiple active columns correctly', () => {
    const wrapper = mount(ColumnVisibility, {
      props: { visibleColumns: new Set(['taxa', 'description']) },
    });
    const buttons = wrapper.findAll('button');
    expect(buttons[0].classes()).toContain('btn-outline-secondary'); // type hidden
    expect(buttons[1].classes()).toContain('btn-secondary');          // taxa visible
    expect(buttons[2].classes()).toContain('btn-secondary');          // description visible
  });

  it('shows all buttons as inactive when visibleColumns is empty', () => {
    const wrapper = mount(ColumnVisibility, {
      props: { visibleColumns: new Set<string>() },
    });
    for (const btn of wrapper.findAll('button')) {
      expect(btn.classes()).toContain('btn-outline-secondary');
      expect(btn.classes()).not.toContain('btn-secondary');
    }
  });

  it('shows all buttons as active when all columns are visible', () => {
    const wrapper = mount(ColumnVisibility, {
      props: { visibleColumns: new Set(['type', 'taxa', 'description']) },
    });
    for (const btn of wrapper.findAll('button')) {
      expect(btn.classes()).toContain('btn-secondary');
      expect(btn.classes()).not.toContain('btn-outline-secondary');
    }
  });
});

// ── Emits ─────────────────────────────────────────────────────────────────────

describe('ColumnVisibility — emits', () => {
  it('emits toggle with "type" when Biolink Type button clicked', async () => {
    const wrapper = mount(ColumnVisibility, {
      props: { visibleColumns: new Set(['type']) },
    });
    await wrapper.findAll('button')[0].trigger('click');
    expect(wrapper.emitted('toggle')).toEqual([['type']]);
  });

  it('emits toggle with "taxa" when Taxa button clicked', async () => {
    const wrapper = mount(ColumnVisibility, {
      props: { visibleColumns: new Set(['type']) },
    });
    await wrapper.findAll('button')[1].trigger('click');
    expect(wrapper.emitted('toggle')).toEqual([['taxa']]);
  });

  it('emits toggle with "description" when Description button clicked', async () => {
    const wrapper = mount(ColumnVisibility, {
      props: { visibleColumns: new Set(['type']) },
    });
    await wrapper.findAll('button')[2].trigger('click');
    expect(wrapper.emitted('toggle')).toEqual([['description']]);
  });
});

// ── Reactivity ────────────────────────────────────────────────────────────────

describe('ColumnVisibility — reactivity', () => {
  it('button classes update when visibleColumns prop is replaced with a new Set', async () => {
    const wrapper = mount(ColumnVisibility, {
      props: { visibleColumns: new Set(['type']) },
    });
    expect(wrapper.findAll('button')[0].classes()).toContain('btn-secondary');

    await wrapper.setProps({ visibleColumns: new Set<string>() });

    expect(wrapper.findAll('button')[0].classes()).toContain('btn-outline-secondary');
    expect(wrapper.findAll('button')[0].classes()).not.toContain('btn-secondary');
  });

  it('button classes update when a column is added via parent ref replacement', async () => {
    // This test exercises the correct fix: parent uses ref + replace-on-toggle.
    // It fails if the parent uses reactive(new Set()) + mutate-in-place, because
    // child props only update when the parent re-renders with a new prop value.
    const Parent = defineComponent({
      components: { ColumnVisibility },
      setup() {
        const visibleColumns = ref(new Set<string>(['type']));
        function toggle(col: string) {
          const next = new Set(visibleColumns.value);
          if (next.has(col)) next.delete(col);
          else next.add(col);
          visibleColumns.value = next;
        }
        return { visibleColumns, toggle };
      },
      template: '<ColumnVisibility :visible-columns="visibleColumns" @toggle="toggle" />',
    });

    const wrapper = mount(Parent);
    const buttons = () => wrapper.findAll('button');

    // Initially: type active, taxa inactive
    expect(buttons()[0].classes()).toContain('btn-secondary');
    expect(buttons()[1].classes()).toContain('btn-outline-secondary');

    // Click "Biolink Type" — should deactivate it
    await buttons()[0].trigger('click');
    expect(buttons()[0].classes()).toContain('btn-outline-secondary');
    expect(buttons()[0].classes()).not.toContain('btn-secondary');

    // Click "Taxa" — should activate it
    await buttons()[1].trigger('click');
    expect(buttons()[1].classes()).toContain('btn-secondary');
    expect(buttons()[1].classes()).not.toContain('btn-outline-secondary');
  });

});
