import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import NodeNormForm from '../NodeNormForm.vue';
import type { NodeNormInstance } from '../../../lib/types';

const instances: NodeNormInstance[] = [
  { name: 'Dev', env: 'dev', url: 'https://dev.example.com/' },
];

function mountForm(initialTargets?: string[]) {
  return mount(NodeNormForm, {
    props: { instances, loading: false, hasResults: true, initialTargets },
  });
}

async function submittedUrls(wrapper: ReturnType<typeof mountForm>) {
  await wrapper.find('form').trigger('submit');
  return wrapper.emitted('submit')!.at(-1)![0].instanceUrls;
}

describe('NodeNormForm — custom URLs', () => {
  it('gives every custom URL its own checkbox, so none is queried invisibly', async () => {
    const wrapper = mountForm();
    for (const url of ['https://a.example/', 'https://b.example/']) {
      await wrapper.find('input[type="url"]').setValue(url);
      await wrapper.find('input[type="url"] + button').trigger('click');
    }
    expect(wrapper.text()).toContain('https://a.example/');
    expect(wrapper.text()).toContain('https://b.example/');

    await wrapper.find('#inst-custom-0').trigger('change'); // untick A
    expect(await submittedUrls(wrapper)).toEqual(['https://dev.example.com/', 'https://b.example/']);
  });

  it('shows a checkbox for each custom target in the page URL', () => {
    const wrapper = mountForm(['dev', 'https://a.example/', 'https://b.example/']);
    expect(wrapper.findAll('[id^="inst-custom-"]')).toHaveLength(2);
  });

  it('disables Add for a malformed URL', async () => {
    const wrapper = mountForm();
    await wrapper.find('input[type="url"]').setValue('not a url');
    expect(wrapper.find('input[type="url"] + button').attributes('disabled')).toBeDefined();
  });
});

describe('NodeNormForm — share', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports failure when the clipboard write is rejected', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } });
    const wrapper = mountForm();
    const share = wrapper.findAll('button').find((b) => b.text() === 'Share')!;
    await share.trigger('click');
    await flushPromises();
    expect(share.text()).toBe('Copy failed');
  });
});
