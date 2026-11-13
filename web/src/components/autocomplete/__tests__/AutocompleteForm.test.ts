import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import AutocompleteForm from '../AutocompleteForm.vue';
import { DEFAULT_AUTOCOMPLETE_OPTIONS, DEFAULT_DEBOUNCE_MS } from '../../../lib/autocomplete-url-state';
import type { NameResInstance, NameResApiOptions } from '../../../lib/nameres-types';

const instances: NameResInstance[] = [
  { name: 'NameRes Dev', env: 'dev', url: 'https://dev.example.com/' },
  { name: 'NameRes Prod', env: 'prod', url: 'https://prod.example.com/' },
];

function makeProps(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    instances,
    query: '',
    preset: 'disease' as const,
    options: { ...DEFAULT_AUTOCOMPLETE_OPTIONS, biolink_type: 'DiseaseOrPhenotypicFeature', only_prefixes: 'MONDO|HP' } as NameResApiOptions,
    selectedUrls: [instances[0].url],
    expected: [],
    expectedRaw: '',
    debounceMs: DEFAULT_DEBOUNCE_MS,
    highlight: true,
    checking: false,
    perInstance: new Map(),
    queriedInstances: [instances[0]],
    hasDeepResults: false,
    ...overrides,
  };
}

describe('AutocompleteForm', () => {
  it('emits update:query on input', async () => {
    const wrapper = mount(AutocompleteForm, { props: makeProps() });
    await wrapper.find('#ac-query').setValue('diabe');
    const emitted = wrapper.emitted('update:query');
    expect(emitted).toBeTruthy();
    expect(emitted![emitted!.length - 1]).toEqual(['diabe']);
  });

  it.each([
    ['500', 100],
    ['0', 1],
    ['-3', 1],
    ['7.6', 8],
  ])('clamps a typed Limit of %s to %d', async (typed, expected) => {
    const wrapper = mount(AutocompleteForm, { props: makeProps() });
    const input = wrapper.find('#ac-limit');
    (input.element as HTMLInputElement).value = typed;
    await input.trigger('change');
    expect(wrapper.emitted('update:options')?.at(-1)?.[0]).toMatchObject({ limit: expected });
    expect((input.element as HTMLInputElement).value).toBe(String(expected));
  });

  it('puts the current Limit back when the field is emptied', async () => {
    const wrapper = mount(AutocompleteForm, { props: makeProps() });
    const input = wrapper.find('#ac-limit');
    (input.element as HTMLInputElement).value = '';
    await input.trigger('change');
    expect(wrapper.emitted('update:options')).toBeUndefined();
    expect((input.element as HTMLInputElement).value).toBe(String(DEFAULT_AUTOCOMPLETE_OPTIONS.limit));
  });

  it('opens Advanced options for a link that sets one of them', () => {
    const props = makeProps();
    const wrapper = mount(AutocompleteForm, {
      props: { ...props, options: { ...props.options, exclude_prefixes: 'UMLS' } },
    });
    expect((wrapper.find('#ac-advanced').element as HTMLDetailsElement).open).toBe(true);
    expect((mount(AutocompleteForm, { props: makeProps() }).find('#ac-advanced').element as HTMLDetailsElement).open).toBe(false);
  });

  it('keeps Advanced options open when its fields go back to their defaults', async () => {
    const props = makeProps();
    const wrapper = mount(AutocompleteForm, { props });
    const details = wrapper.find('#ac-advanced');
    (details.element as HTMLDetailsElement).open = true;
    await details.trigger('toggle');

    await wrapper.setProps({ options: { ...props.options, exclude_prefixes: 'UMLS' } });
    await wrapper.setProps({ options: { ...props.options, exclude_prefixes: '' } });
    await wrapper.setProps({ highlight: false });
    await wrapper.setProps({ highlight: true });

    expect((details.element as HTMLDetailsElement).open).toBe(true);
  });

  it('preset change emits update:options with preset-implied biolink_type + only_prefixes', async () => {
    const wrapper = mount(AutocompleteForm, { props: makeProps() });
    await wrapper.find('#ac-preset').setValue('gene');
    // First: update:preset. Second: update:options.
    const presetEmitted = wrapper.emitted('update:preset');
    const optionsEmitted = wrapper.emitted('update:options');
    expect(presetEmitted?.[0]).toEqual(['gene']);
    expect(optionsEmitted?.[0]?.[0]).toMatchObject({
      biolink_type: 'Gene',
      only_prefixes: '',
    });
  });

  it('preset change to custom does NOT emit update:options', async () => {
    const wrapper = mount(AutocompleteForm, { props: makeProps() });
    await wrapper.find('#ac-preset').setValue('custom');
    expect(wrapper.emitted('update:preset')?.[0]).toEqual(['custom']);
    expect(wrapper.emitted('update:options')).toBeFalsy();
  });

  it('hand-editing biolink_type away from preset switches preset to custom', async () => {
    const wrapper = mount(AutocompleteForm, { props: makeProps() });
    // Simulate parent updating options to a hand-edited value.
    await wrapper.setProps({
      options: {
        ...DEFAULT_AUTOCOMPLETE_OPTIONS,
        biolink_type: 'NotAPreset',
        only_prefixes: '',
      },
    });
    const presetEmitted = wrapper.emitted('update:preset');
    expect(presetEmitted?.[presetEmitted!.length - 1]).toEqual(['custom']);
  });

  it('renders the advanced options section (summary always visible)', () => {
    const wrapper = mount(AutocompleteForm, { props: makeProps() });
    const summaries = wrapper.findAll('summary').map((s) => s.text());
    expect(summaries.some((s) => s.includes('Advanced options'))).toBe(true);
  });

  it('debounce select emits update:debounceMs', async () => {
    const wrapper = mount(AutocompleteForm, { props: makeProps() });
    await wrapper.find('#ac-debounce').setValue('300');
    const emitted = wrapper.emitted('update:debounceMs');
    expect(emitted?.[0]).toEqual([300]);
  });

  it('highlight checkbox emits update:highlight', async () => {
    const wrapper = mount(AutocompleteForm, { props: makeProps() });
    await wrapper.find('#ac-highlight').setValue(false);
    expect(wrapper.emitted('update:highlight')?.[0]).toEqual([false]);
  });
});

describe('AutocompleteForm — Copy link', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function copyButton(wrapper: ReturnType<typeof mount>) {
    return wrapper.findAll('button').find((b) => ['Copy link', '✓ Copied!', 'Copy failed'].includes(b.text()))!;
  }

  it('copies the page URL and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const wrapper = mount(AutocompleteForm, { props: makeProps() });
    await copyButton(wrapper).trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(copyButton(wrapper).text()).toBe('✓ Copied!');
  });

  it('reports failure rather than doing nothing when the copy is refused', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } });
    const wrapper = mount(AutocompleteForm, { props: makeProps() });
    await copyButton(wrapper).trigger('click');
    await flushPromises();
    expect(copyButton(wrapper).text()).toBe('Copy failed');
  });
});
