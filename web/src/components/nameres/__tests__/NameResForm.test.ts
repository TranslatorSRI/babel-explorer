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

describe('NameResForm — Limit and "Fail if in top"', () => {
  it.each(['#opt-limit', '#opt-threshold'])('blocks the lookup while %s is empty', async (id) => {
    const wrapper = mountForm();
    await wrapper.find(id).setValue('');
    expect(wrapper.find(id).classes()).toContain('is-invalid');
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined();
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it.each(['0', '101', '2.5'])('blocks the lookup for a limit of %s', async (value) => {
    const wrapper = mountForm();
    await wrapper.find('#opt-limit').setValue(value);
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('submits valid numbers', async () => {
    const wrapper = mountForm();
    await wrapper.find('#opt-limit').setValue('10');
    await wrapper.find('#opt-threshold').setValue('3');
    expect(wrapper.find('#opt-limit').classes()).not.toContain('is-invalid');
    await wrapper.find('form').trigger('submit');
    const [payload] = wrapper.emitted<[{ options: { limit: number }; threshold: number }]>('submit')!.at(-1)!;
    expect(payload.options.limit).toBe(10);
    expect(payload.threshold).toBe(3);
  });

  it('keeps "Fail if in top" equal to the Limit until it is set', async () => {
    const wrapper = mountForm();
    await wrapper.find('#opt-limit').setValue('20');
    expect((wrapper.find('#opt-threshold').element as HTMLInputElement).value).toBe('20');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted<[{ threshold: number }]>('submit')!.at(-1)![0].threshold).toBe(20);
  });

  it('stops following the Limit once "Fail if in top" is set', async () => {
    const wrapper = mountForm();
    await wrapper.find('#opt-threshold').setValue('3');
    await wrapper.find('#opt-limit').setValue('20');
    expect((wrapper.find('#opt-threshold').element as HTMLInputElement).value).toBe('3');
  });

  it("starts from a share link's threshold rather than the Limit", () => {
    const wrapper = mountForm({ initialOptions: { limit: 10 }, initialThreshold: 3 });
    expect((wrapper.find('#opt-threshold').element as HTMLInputElement).value).toBe('3');
  });

  it('blocks the lookup when "Fail if in top" is above the Limit', async () => {
    const wrapper = mountForm();
    await wrapper.find('#opt-limit').setValue('5');
    await wrapper.find('#opt-threshold').setValue('10');
    expect(wrapper.find('#opt-threshold').classes()).toContain('is-invalid');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('submit')).toBeUndefined();
  });
});
