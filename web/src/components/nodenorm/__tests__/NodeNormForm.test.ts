import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import NodeNormForm from '../NodeNormForm.vue';
import type { NodeNormInstance, NodeNormQuery } from '../../../lib/types';

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
  return wrapper.emitted<[NodeNormQuery]>('submit')!.at(-1)![0].instanceUrls;
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

  it('drops targets from the page URL that are not http(s) URLs', () => {
    const wrapper = mountForm(['ftp://h/', '//evil.example', 'https://a.example/']);
    expect(wrapper.findAll('[id^="inst-custom-"]')).toHaveLength(1);
    expect(wrapper.text()).not.toContain('ftp://');
  });

  it('ticks a known instance typed without its trailing slash instead of adding it again', async () => {
    const wrapper = mountForm([]);
    await wrapper.find('#inst-dev').trigger('change'); // untick, so the Add is what ticks it
    await wrapper.find('input[type="url"]').setValue('https://dev.example.com');
    await wrapper.find('input[type="url"] + button').trigger('click');
    expect(wrapper.findAll('[id^="inst-custom-"]')).toHaveLength(0);
    expect(await submittedUrls(wrapper)).toEqual(['https://dev.example.com/']);
  });

  it('adds the custom URL on Enter instead of submitting the query', async () => {
    const wrapper = mountForm();
    await wrapper.find('input[type="url"]').setValue('https://a.example/');
    await wrapper.find('input[type="url"]').trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.findAll('[id^="inst-custom-"]')).toHaveLength(1);
  });

  it('leaves the browser no reason to block Normalize over a half-typed custom URL', async () => {
    const wrapper = mountForm();
    await wrapper.find('input[type="url"]').setValue('nodenorm.example');
    expect(wrapper.find('form').attributes('novalidate')).toBeDefined();
    expect(await submittedUrls(wrapper)).toEqual(['https://dev.example.com/']);
  });

  it.each(['not a url', 'foo:bar'])('disables Add for %s, which is not an http(s) URL', async (url) => {
    const wrapper = mountForm();
    await wrapper.find('input[type="url"]').setValue(url);
    expect(wrapper.find('input[type="url"] + button').attributes('disabled')).toBeDefined();
  });
});

/** The "Advanced options" section; InstanceSelector's "Extended environments" comes first. */
function advancedDetails(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('details').find((d) => d.find('summary').text() === 'Advanced options')!
    .element as HTMLDetailsElement;
}

describe('NodeNormForm — advanced options', () => {
  it('opens when the page URL changes an advanced option', () => {
    const wrapper = mount(NodeNormForm, {
      props: { instances, loading: false, hasResults: false, initialOptions: { description: false } },
    });
    expect(advancedDetails(wrapper).open).toBe(true);
  });

  it('stays open when the user restores the defaults', async () => {
    const wrapper = mountForm();
    const details = advancedDetails(wrapper);
    details.open = true;
    await wrapper.find('#opt-desc').setValue(false);
    await wrapper.find('#opt-desc').setValue(true);
    expect(details.open).toBe(true);
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
