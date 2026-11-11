import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import NodeNormApp from '../NodeNormApp.vue';
import endpoints from '../../../../../config/translator-endpoints.json';
import { sessionPrefs } from '../../../lib/instance-prefs';

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
  sessionPrefs.value = null;
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

  it('queries the instances the form shows ticked when the link names none', async () => {
    const fetchMock = vi.fn(async (url: string) => respond(url));
    vi.stubGlobal('fetch', fetchMock);
    sessionPrefs.value = ['prod'];
    setFragment('#curie=MONDO%3A0004979');

    const wrapper = mountApp();
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(endpoints.nodenorm.prod);
    expect((wrapper.find('#inst-prod').element as HTMLInputElement).checked).toBe(true);
    expect((wrapper.find('#inst-dev').element as HTMLInputElement).checked).toBe(false);
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

/**
 * A fetch that hangs until release() is called, then answers like respond(). An
 * aborted request rejects as fetch does, so a test can tell a query that was cancelled
 * from one that finished.
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

async function navigateTo(fragment: string) {
  setFragment(fragment);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await flushPromises();
}

describe('NodeNormApp — a new link while a query is running', () => {
  it('cancels the running query when the link names only unusable targets', async () => {
    const { fetchMock, release } = heldFetch();
    vi.stubGlobal('fetch', fetchMock);
    setFragment('#curie=MONDO%3A0004979&target=prod');
    const wrapper = mountApp();
    await flushPromises();

    const pasted = '#curie=CHEBI%3A48947&target=ftp%3A%2F%2Fbad';
    await navigateTo(pasted);
    await release();

    expect(wrapper.text()).toContain('neither a known instance nor an http(s)');
    expect(wrapper.find('table').exists()).toBe(false);
    expect(window.location.hash).toBe(pasted);
  });

  it('does not report "Query stopped" for a link with no CURIEs', async () => {
    const { fetchMock, release } = heldFetch();
    vi.stubGlobal('fetch', fetchMock);
    setFragment('#curie=MONDO%3A0004979&target=prod');
    const wrapper = mountApp();
    await flushPromises();

    await navigateTo('#target=prod');
    await release();

    expect(wrapper.text()).not.toContain('Query stopped');
    expect(wrapper.text()).toContain('Normalize');
    expect(wrapper.text()).not.toContain('Normalizing');
  });

  it('cancels the running query when a submission has no valid CURIEs', async () => {
    const { fetchMock, release } = heldFetch();
    vi.stubGlobal('fetch', fetchMock);
    setFragment('#curie=MONDO%3A0004979&target=prod');
    const wrapper = mountApp();
    await flushPromises();

    await wrapper.find('textarea').setValue('# note');
    await wrapper.find('form').trigger('submit');
    await release();

    expect(wrapper.text()).toContain('No valid CURIEs provided.');
    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Normalizing');
  });
});

describe('NodeNormApp — stop after a new link', () => {
  it('puts back the URL of the results it keeps', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => respond(url)));
    setFragment('#curie=MONDO%3A0004979&target=prod');
    const wrapper = mountApp();
    await flushPromises();
    const shownUrl = window.location.hash;

    const { fetchMock } = heldFetch();
    vi.stubGlobal('fetch', fetchMock);
    await navigateTo('#curie=CHEBI%3A48947&target=prod');
    const stop = wrapper.findAll('button').find((b) => b.text() === 'Stop')!;
    await stop.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Query stopped');
    expect(wrapper.find('table').text()).toContain('MONDO:0004979');
    expect(window.location.hash).toBe(shownUrl);
  });
});
