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

  // ── ES CI regression: target=es_ci must resolve to the ES CI base URL ─────────
  //
  // Bug: the comparison view showed an empty ES CI column even though clicking the
  // "API↗" link returned results. Root cause: a mismatch between the env key used
  // in the URL (`es_ci`) and how the instance URL was resolved / used as a key.

  it('resolves target=es_ci to the ES CI NameRes URL and queries it', async () => {
    const esCiResult = mkResult('MONDO:0004979', 'asthma');
    vi.mocked(nameresApi.fetchNameResLookup).mockResolvedValue([esCiResult]);

    setLocation('?q=asthma&target=es_ci');
    const wrapper = mount(AutocompleteApp);
    await flushPromises();
    vi.advanceTimersByTime(200);
    await flushPromises();

    // The fetch must have been called — not skipped because of an unrecognised env key.
    expect(nameresApi.fetchNameResLookup).toHaveBeenCalled();

    // The first argument to every call must be the ES CI base URL, not the bare
    // string 'es_ci' (which would happen if resolveTarget fell through to its fallback).
    const calls = vi.mocked(nameresApi.fetchNameResLookup).mock.calls;
    for (const [baseUrl] of calls) {
      expect(baseUrl).toContain('namelookup-es.ci.transltr.io');
      expect(baseUrl).not.toBe('es_ci');
    }
  });

  it('queries all four instances — including ES CI — when the URL lists target=dev&target=prod&target=ci&target=es_ci', async () => {
    vi.mocked(nameresApi.fetchNameResLookup).mockImplementation((baseUrl) => {
      if (baseUrl.includes('namelookup-es.ci.transltr.io')) {
        return Promise.resolve([mkResult('MONDO:ES', 'es-ci-only result')]);
      }
      return Promise.resolve([mkResult('MONDO:OTHER', 'shared result')]);
    });

    setLocation('?q=diabetes&target=dev&target=prod&target=ci&target=es_ci');
    const wrapper = mount(AutocompleteApp);
    await flushPromises();
    vi.advanceTimersByTime(200);
    await flushPromises();

    const calls = vi.mocked(nameresApi.fetchNameResLookup).mock.calls;

    // All four instances must have been queried.
    expect(calls.length).toBeGreaterThanOrEqual(4);

    // ES CI specifically must be queried with its real URL, not 'es_ci'.
    const esCiCall = calls.find(([baseUrl]) => baseUrl.includes('namelookup-es.ci.transltr.io'));
    expect(esCiCall).toBeDefined();
    expect(esCiCall![0]).not.toBe('es_ci');

    // The comparison view must be visible (4 queried instances → comparison, not single-instance).
    expect(wrapper.text()).toContain('Comparison —');

    // ES CI's unique result must appear in the rendered table.
    expect(wrapper.text()).toContain('MONDO:ES');
  });

  it('shows ES CI results in the comparison view column, not just an empty dash', async () => {
    vi.mocked(nameresApi.fetchNameResLookup).mockImplementation((baseUrl) => {
      if (baseUrl.includes('namelookup-es.ci.transltr.io')) {
        return Promise.resolve([mkResult('MONDO:ES_UNIQUE', 'ES CI only')]);
      }
      return Promise.resolve([]);
    });

    setLocation('?q=diabetes&target=dev&target=es_ci');
    const wrapper = mount(AutocompleteApp);
    await flushPromises();
    vi.advanceTimersByTime(200);
    await flushPromises();

    // The CURIE that only ES CI returned must be visible — it would be absent if the
    // ES CI URL key in `perInstance` didn't match the key used by the comparison view.
    expect(wrapper.text()).toContain('MONDO:ES_UNIQUE');
  });
});
