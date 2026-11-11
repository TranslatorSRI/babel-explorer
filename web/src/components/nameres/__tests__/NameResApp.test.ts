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
