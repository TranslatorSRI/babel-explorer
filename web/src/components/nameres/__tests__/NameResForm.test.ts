import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import NameResForm from '../NameResForm.vue';
import type { NameResInstance } from '../../../lib/nameres-types';

const instances: NameResInstance[] = [
  { name: 'NameRes Dev', env: 'dev', url: 'https://dev.example.com/' },
];

function mountForm(props: Record<string, unknown> = {}) {
  return mount(NameResForm, {
    props: { instances, loading: false, hasResults: true, ...props },
  });
}

/** The "Advanced options" section; InstanceSelector's "Extended environments" comes first. */
function advancedDetails(wrapper: ReturnType<typeof mountForm>) {
  return wrapper.findAll('details').find((d) => d.find('summary').text() === 'Advanced options')!
    .element as HTMLDetailsElement;
}

afterEach(() => vi.unstubAllGlobals());

describe('NameResForm — advanced options', () => {
  it('opens when the page URL changes an advanced option', () => {
    const wrapper = mountForm({ initialOptions: { biolink_type: 'Disease' } });
    expect(advancedDetails(wrapper).open).toBe(true);
  });

  it('stays open when the user restores the defaults', async () => {
    const wrapper = mountForm();
    const details = advancedDetails(wrapper);
    details.open = true;
    await wrapper.find('#opt-biolink-type').setValue('Disease');
    await wrapper.find('#opt-biolink-type').setValue('');
    expect(details.open).toBe(true);
  });
});

describe('NameResForm — share', () => {
  function shareButton(wrapper: ReturnType<typeof mountForm>) {
    return wrapper.findAll('button').find((b) => ['Share', '✓ Copied!', 'Copy failed'].includes(b.text()))!;
  }

  it('copies the page URL and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const wrapper = mountForm();
    await shareButton(wrapper).trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(shareButton(wrapper).text()).toBe('✓ Copied!');
  });

  it('reports failure when the clipboard write is rejected', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } });
    const wrapper = mountForm();
    await shareButton(wrapper).trigger('click');
    await flushPromises();
    expect(shareButton(wrapper).text()).toBe('Copy failed');
  });

  it('reports failure where there is no clipboard API', async () => {
    vi.stubGlobal('navigator', {});
    const wrapper = mountForm();
    await shareButton(wrapper).trigger('click');
    await flushPromises();
    expect(shareButton(wrapper).text()).toBe('Copy failed');
  });
});
