import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import NodeNormApp from '../NodeNormApp.vue';
import endpoints from '../../../../../config/translator-endpoints.json';

/** A NodeNorm response naming each requested CURIE as its own preferred ID. */
function respond(url: string) {
  const curies = new URL(url).searchParams.getAll('curie');
  const body = Object.fromEntries(
    curies.map((c) => [c, { id: { identifier: c }, equivalent_identifiers: [], type: [] }]),
  );
  return { ok: true, json: () => Promise.resolve(body) };
}

function setFragment(fragment: string) {
  window.history.replaceState(null, '', `/nodenorm${fragment}`);
}

function mountApp() {
  return mount(NodeNormApp, { attachTo: document.body });
}

enableAutoUnmount(afterEach);

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  setFragment('');
});

describe('NodeNormApp — share links', () => {
  it('does not fetch a share-link target that is not an http(s) URL', async () => {
    const fetchMock = vi.fn(async (url: string) => respond(url));
    vi.stubGlobal('fetch', fetchMock);
    setFragment('#curie=MONDO%3A0004979&target=ftp%3A%2F%2Fh%2F&target=%2F%2Fevil.example');

    const wrapper = mountApp();
    await flushPromises();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('ftp://h/');
    expect(wrapper.text()).toContain('neither a known instance nor an http(s)');
  });

  it('runs the new query when only the fragment changes', async () => {
    const fetchMock = vi.fn(async (url: string) => respond(url));
    vi.stubGlobal('fetch', fetchMock);
    setFragment('#curie=MONDO%3A0004979&target=prod');
    const wrapper = mountApp();
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    setFragment('#curie=CHEBI%3A48947&target=prod');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain(endpoints.nodenorm.prod);
    expect(wrapper.find('textarea').element.value).toBe('CHEBI:48947');
    expect(wrapper.text()).toContain('CHEBI:48947');
    expect(wrapper.text()).not.toContain('MONDO:0004979');
  });
});

describe('NodeNormApp — stop', () => {
  it('keeps the previous results and URL when a query is stopped', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => respond(url)));
    setFragment('#curie=MONDO%3A0004979&target=prod');
    const wrapper = mountApp();
    await flushPromises();
    const sharedUrl = window.location.hash;

    // The next query hangs until it is aborted.
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal!.addEventListener('abort', () =>
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      )),
    ));
    await wrapper.find('textarea').setValue('CHEBI:48947');
    await wrapper.find('form').trigger('submit');
    const stop = wrapper.findAll('button').find((b) => b.text() === 'Stop')!;
    await stop.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Query stopped');
    expect(wrapper.find('table').text()).toContain('MONDO:0004979');
    expect(window.location.hash).toBe(sharedUrl);
  });
});
