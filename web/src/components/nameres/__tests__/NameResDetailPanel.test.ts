import { describe, it, expect } from 'vitest';
import { mount, enableAutoUnmount } from '@vue/test-utils';
import { afterEach } from 'vitest';
import NameResDetailPanel from '../NameResDetailPanel.vue';
import type { NameResResult } from '../../../lib/nameres-types';

enableAutoUnmount(afterEach);

const result: NameResResult = {
  curie: 'MONDO:0004979', label: 'asthma', types: [], taxa: [], synonyms: [], score: 1, clique_identifier_count: 1,
};

function mountPanel() {
  return mount(NameResDetailPanel, {
    props: { results: [result], expectedCuries: [] },
    attachTo: document.body,
  });
}

describe('NameResDetailPanel — full response dialog', () => {
  it('opens a modal dialog named by its title', async () => {
    const wrapper = mountPanel();
    await wrapper.find('button[title="View full response JSON"]').trigger('click');
    await wrapper.vm.$nextTick();

    const dialog = wrapper.find('dialog').element as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    const title = document.getElementById(dialog.getAttribute('aria-labelledby')!);
    expect(title?.textContent).toContain('MONDO:0004979');
    expect(wrapper.find('dialog pre').text()).toContain('"label": "asthma"');
  });

  it('closes from its labelled close button', async () => {
    const wrapper = mountPanel();
    await wrapper.find('button[title="View full response JSON"]').trigger('click');
    await wrapper.vm.$nextTick();

    await wrapper.find('dialog button[aria-label="Close"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect((wrapper.find('dialog').element as HTMLDialogElement).open).toBe(false);
    expect(wrapper.find('dialog pre').exists()).toBe(false);
  });
});
