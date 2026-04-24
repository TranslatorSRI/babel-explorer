import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import type { NameResResult } from '../../../lib/nameres-types';

// Mock the network layer before any component import.
vi.mock('../../../lib/nameres-api', () => ({
  parseSearchTerms: vi.fn(),
  fetchNameResLookup: vi.fn(),
  validateExpectedCuries: vi.fn(),
}));
vi.mock('../../../lib/curie-links', () => ({
  loadPrefixMap: vi.fn(async () => ({})),
  getCurieUrl: vi.fn(() => null),
}));

import AutocompleteApp from '../AutocompleteApp.vue';
import * as nameresApi from '../../../lib/nameres-api';

function setLocation(search: string, pathname = '/autocomplete') {
  Object.defineProperty(window, 'location', {
    value: {
      search,
      pathname,
      href: `http://localhost${pathname}${search}`,
    },
    writable: true,
    configurable: true,
  });
}

function mkResult(curie: string, label: string): NameResResult {
  return { curie, label, types: ['Disease'], taxa: [], synonyms: [], score: 1, clique_identifier_count: 1 };
}

describe('AutocompleteApp', () => {
  beforeEach(() => {
    setLocation('');
    vi.useFakeTimers();
    vi.mocked(nameresApi.fetchNameResLookup).mockReset();
    vi.mocked(nameresApi.fetchNameResLookup).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires a single lookup after the debounce window when typing', async () => {
    vi.mocked(nameresApi.fetchNameResLookup).mockResolvedValue([mkResult('MONDO:1', 'diabetes')]);

    const wrapper = mount(AutocompleteApp);
    // Let onMounted + InstanceSelector's immediate emit settle.
    await flushPromises();
    vi.mocked(nameresApi.fetchNameResLookup).mockClear();

    const input = wrapper.find('#ac-query');
    await input.setValue('d');
    await input.setValue('di');
    await input.setValue('dia');
    // Still inside the debounce window — no calls yet.
    expect(nameresApi.fetchNameResLookup).not.toHaveBeenCalled();

    vi.advanceTimersByTime(150);
    await flushPromises();

    expect(nameresApi.fetchNameResLookup).toHaveBeenCalled();
    // All calls should be for the latest query.
    for (const call of vi.mocked(nameresApi.fetchNameResLookup).mock.calls) {
      expect(call[1]).toBe('dia');
    }
  });

  it('aborts in-flight requests when a new keystroke fires', async () => {
    // Make fetchNameResLookup reject with AbortError when signal aborts.
    vi.mocked(nameresApi.fetchNameResLookup).mockImplementation((_url, _q, _opts, signal) => {
      return new Promise<NameResResult[]>((_resolve, reject) => {
        signal!.addEventListener('abort', () => {
          const err: Error & { name?: string } = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const wrapper = mount(AutocompleteApp);
    await flushPromises();
    vi.mocked(nameresApi.fetchNameResLookup).mockClear();

    const input = wrapper.find('#ac-query');
    await input.setValue('di');
    vi.advanceTimersByTime(150);
    await flushPromises();

    // First fire happened; capture its signal.
    const firstCall = vi.mocked(nameresApi.fetchNameResLookup).mock.calls[0];
    const firstSignal = firstCall?.[3] as AbortSignal;
    expect(firstSignal?.aborted).toBe(false);

    // Now type more, let debounce fire again.
    await input.setValue('diab');
    vi.advanceTimersByTime(150);
    await flushPromises();

    expect(firstSignal?.aborted).toBe(true);
  });

  it('passes limit=100 when Check button fires the deep lookup', async () => {
    vi.mocked(nameresApi.fetchNameResLookup).mockResolvedValue([mkResult('MONDO:1', 'x')]);

    setLocation('?q=diab&expected=MONDO%3A1');
    const wrapper = mount(AutocompleteApp);
    await flushPromises();
    vi.advanceTimersByTime(200);
    await flushPromises();

    // Clear the initial top-N call and then click Check.
    vi.mocked(nameresApi.fetchNameResLookup).mockClear();

    const btns = wrapper.findAll('button');
    const checkBtn = btns.find((b) => b.text().toLowerCase().includes('check'));
    expect(checkBtn).toBeTruthy();
    await checkBtn!.trigger('click');
    await flushPromises();

    expect(nameresApi.fetchNameResLookup).toHaveBeenCalled();
    const opts = vi.mocked(nameresApi.fetchNameResLookup).mock.calls[0][2];
    expect(opts.limit).toBe(100);
  });

  it('renders the single-instance Results view when only one instance is selected', async () => {
    vi.mocked(nameresApi.fetchNameResLookup).mockResolvedValue([mkResult('MONDO:1', 'diabetes')]);
    setLocation('?q=diab&target=dev');

    const wrapper = mount(AutocompleteApp);
    await flushPromises();
    vi.advanceTimersByTime(200);
    await flushPromises();

    // The comparison view has the "Comparison —" header; the single-instance view does not.
    expect(wrapper.text()).not.toContain('Comparison —');
    expect(wrapper.text()).toContain('Copy API URL');
  });
});
