import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import NameResApp from '../NameResApp.vue';
import { sessionPrefs } from '../../../lib/instance-prefs';
import endpoints from '../../../../../config/translator-endpoints.json';

function setSearch(search: string) {
  window.history.replaceState(null, '', `/nameres${search}`);
}

enableAutoUnmount(afterEach);

afterEach(() => {
  sessionPrefs.value = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  setSearch('');
});

describe('NameResApp — share links', () => {
  it('does not fetch a link target that is not an http(s) URL, and says so', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: () => Promise.resolve([]) }));
    vi.stubGlobal('fetch', fetchMock);
    setSearch('?term=asthma&target=ftp%3A%2F%2Fh%2F&target=%2F%2Fevil.example');

    const wrapper = mount(NameResApp, { attachTo: document.body });
    await flushPromises();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('ftp://h/');
    expect(wrapper.text()).toContain('neither a known instance nor an http(s)');
  });

  it('queries a known target from the link', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: () => Promise.resolve([]) }));
    vi.stubGlobal('fetch', fetchMock);
    setSearch('?term=asthma&target=prod');

    mount(NameResApp, { attachTo: document.body });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(endpoints.nameres.prod);
  });
});

/** A NameRes response naming one result, X:<search text>, for the requested term. */
function respond(url: string) {
  const text = new URL(url).searchParams.get('string')!;
  const body = [{ curie: `X:${text}`, label: text, types: [], taxa: [], synonyms: [], score: 1, clique_identifier_count: 1 }];
  return { ok: true, json: () => Promise.resolve(body) };
}

/**
 * A fetch that hangs until release() is called, then answers like respond(). An
 * aborted request rejects as fetch does.
 */
function heldFetch() {
  const pending: (() => void)[] = [];
  const fetchMock = vi.fn((url: string, init: RequestInit) =>
    new Promise((resolve, reject) => {
      init.signal!.addEventListener('abort', () =>
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      );
      pending.push(() => resolve(respond(url)));
    }),
  );
  return {
    fetchMock,
    release: async () => {
      pending.splice(0).forEach((r) => r());
      await flushPromises();
    },
  };
}

async function submit(wrapper: ReturnType<typeof mount>, terms: string) {
  await wrapper.find('textarea').setValue(terms);
  await wrapper.find('form').trigger('submit');
}

describe('NameResApp — stop and replaced queries', () => {
  it('keeps the previous results and URL when a query is stopped', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => respond(url)));
    setSearch('?term=asthma&target=prod');
    const wrapper = mount(NameResApp, { attachTo: document.body });
    await flushPromises();
    const shownUrl = window.location.search;

    vi.stubGlobal('fetch', heldFetch().fetchMock);
    await submit(wrapper, 'diabetes');
    await wrapper.findAll('button').find((b) => b.text() === 'Stop')!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Query stopped');
    expect(wrapper.find('table').text()).toContain('X:asthma');
    expect(wrapper.find('table').text()).not.toContain('diabetes');
    expect(window.location.search).toBe(shownUrl);
  });

  it('cancels the running query when a new one is submitted', async () => {
    const held = heldFetch();
    vi.stubGlobal('fetch', held.fetchMock);
    setSearch('?term=asthma&target=prod');
    const wrapper = mount(NameResApp, { attachTo: document.body });
    await flushPromises();

    vi.stubGlobal('fetch', vi.fn(async (url: string) => respond(url)));
    await submit(wrapper, 'diabetes');
    await flushPromises();
    await held.release();

    expect(wrapper.find('table').text()).toContain('X:diabetes');
    expect(wrapper.find('table').text()).not.toContain('asthma');
    expect(window.location.search).toContain('diabetes');
    expect(wrapper.text()).not.toContain('Looking up');
  });

  it('cancels the running query when a submission has no valid terms', async () => {
    const held = heldFetch();
    vi.stubGlobal('fetch', held.fetchMock);
    setSearch('?term=asthma&target=prod');
    const wrapper = mount(NameResApp, { attachTo: document.body });
    await flushPromises();

    await submit(wrapper, '# just a comment');
    await held.release();

    expect(wrapper.text()).toContain('No valid search terms provided.');
    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Looking up');
  });
});
