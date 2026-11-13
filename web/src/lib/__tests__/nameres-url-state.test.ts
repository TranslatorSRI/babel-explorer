import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_NAMERES_OPTIONS } from '../nameres-types';
import type { NameResApiOptions } from '../nameres-types';

function setLocation(search: string, pathname = '/nameres', hash = '') {
  Object.defineProperty(window, 'location', {
    value: { search, pathname, hash, href: `http://localhost${pathname}${search}${hash}` },
    writable: true,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// readNameResQueryState
// ---------------------------------------------------------------------------

describe('readNameResQueryState', () => {
  beforeEach(() => {
    setLocation('');
  });

  it('returns empty state when there are no params', async () => {
    setLocation('');
    const { readNameResQueryState } = await import('../nameres-url-state');
    const state = readNameResQueryState();
    expect(state.terms).toEqual([]);
    expect(state.targets).toEqual([]);
    expect(state.options).toEqual({});
    expect(state.threshold).toBeUndefined();
  });

  it('parses repeated term= params', async () => {
    setLocation('?term=asthma&term=diabetes');
    const { readNameResQueryState } = await import('../nameres-url-state');
    const state = readNameResQueryState();
    expect(state.terms).toEqual(['asthma', 'diabetes']);
  });

  it('parses terms with [[CURIE]] annotations', async () => {
    setLocation('?term=asthma+%5B%5BMONDO%3A0004979%5D%5D');
    const { readNameResQueryState } = await import('../nameres-url-state');
    const state = readNameResQueryState();
    expect(state.terms).toEqual(['asthma [[MONDO:0004979]]']);
  });

  it('parses target params', async () => {
    setLocation('?term=asthma&target=dev&target=prod');
    const { readNameResQueryState } = await import('../nameres-url-state');
    const state = readNameResQueryState();
    expect(state.targets).toEqual(['dev', 'prod']);
  });

  it('parses limit option', async () => {
    setLocation('?term=asthma&limit=10');
    const { readNameResQueryState } = await import('../nameres-url-state');
    const state = readNameResQueryState();
    expect(state.options.limit).toBe(10);
  });

  it('parses autocomplete option', async () => {
    setLocation('?term=asthma&autocomplete=true');
    const { readNameResQueryState } = await import('../nameres-url-state');
    const state = readNameResQueryState();
    expect(state.options.autocomplete).toBe(true);
  });

  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
  ])('reads autocomplete=%s as %s', async (value, expected) => {
    setLocation('', '/nameres', `#term=asthma&autocomplete=${value}`);
    const { readNameResQueryState } = await import('../nameres-url-state');
    expect(readNameResQueryState().options.autocomplete).toBe(expected);
  });

  it.each(['', 'no', 'yes'])('ignores autocomplete=%j', async (value) => {
    setLocation('', '/nameres', `#term=asthma&autocomplete=${value}`);
    const { readNameResQueryState } = await import('../nameres-url-state');
    expect(readNameResQueryState().options.autocomplete).toBeUndefined();
  });

  it('parses threshold', async () => {
    setLocation('?term=asthma&threshold=3');
    const { readNameResQueryState } = await import('../nameres-url-state');
    const state = readNameResQueryState();
    expect(state.threshold).toBe(3);
  });

  it('parses advanced string options', async () => {
    setLocation('?term=asthma&biolink_type=Disease&only_prefixes=MONDO%2CHP');
    const { readNameResQueryState } = await import('../nameres-url-state');
    const state = readNameResQueryState();
    expect(state.options.biolink_type).toBe('Disease');
    expect(state.options.only_prefixes).toBe('MONDO,HP');
  });
});

describe('readNameResQueryState — unusable numbers', () => {
  it.each(['0', '-3', '101', '2.5', 'abc', ''])('ignores %j as a limit or threshold', async (value) => {
    setLocation('', '/nameres', `#term=asthma&limit=${value}&threshold=${value}`);
    const { readNameResQueryState } = await import('../nameres-url-state');
    const state = readNameResQueryState();
    expect(state.options.limit).toBeUndefined();
    expect(state.threshold).toBeUndefined();
  });
});

describe('readNameResQueryState — threshold above the limit', () => {
  it('ignores a threshold above the limit', async () => {
    setLocation('', '/nameres', '#term=asthma&limit=5&threshold=10');
    const { readNameResQueryState } = await import('../nameres-url-state');
    expect(readNameResQueryState().threshold).toBeUndefined();
  });

  it('ignores a threshold above the default limit when the link sets none', async () => {
    const { DEFAULT_NAMERES_OPTIONS } = await import('../nameres-types');
    setLocation('', '/nameres', `#term=asthma&threshold=${DEFAULT_NAMERES_OPTIONS.limit + 1}`);
    const { readNameResQueryState } = await import('../nameres-url-state');
    expect(readNameResQueryState().threshold).toBeUndefined();
  });
});

describe('readNameResQueryState — fragment', () => {
  it('reads the state from the fragment', async () => {
    setLocation('', '/nameres', '#term=asthma&target=prod');
    const { readNameResQueryState } = await import('../nameres-url-state');
    const state = readNameResQueryState();
    expect(state.terms).toEqual(['asthma']);
    expect(state.targets).toEqual(['prod']);
  });

  it('prefers the fragment to the query string', async () => {
    setLocation('?term=old', '/nameres', '#term=new');
    const { readNameResQueryState } = await import('../nameres-url-state');
    expect(readNameResQueryState().terms).toEqual(['new']);
  });
});

// ---------------------------------------------------------------------------
// buildNameResQueryUrl
// ---------------------------------------------------------------------------

describe('buildNameResQueryUrl', () => {
  beforeEach(() => {
    setLocation('', '/nameres');
  });

  it('produces term= and target= params', async () => {
    setLocation('', '/nameres');
    const { buildNameResQueryUrl } = await import('../nameres-url-state');
    const url = buildNameResQueryUrl(['asthma', 'diabetes'], ['dev'], DEFAULT_NAMERES_OPTIONS);
    const params = new URLSearchParams(url.split('#')[1]);
    expect(params.getAll('term')).toEqual(['asthma', 'diabetes']);
    expect(params.getAll('target')).toEqual(['dev']);
  });

  it('omits options that match defaults', async () => {
    setLocation('', '/nameres');
    const { buildNameResQueryUrl } = await import('../nameres-url-state');
    const url = buildNameResQueryUrl(['asthma'], ['dev'], DEFAULT_NAMERES_OPTIONS);
    const params = new URLSearchParams(url.split('#')[1] ?? '');
    expect(params.has('limit')).toBe(false);
    expect(params.has('autocomplete')).toBe(false);
    expect(params.has('biolink_type')).toBe(false);
  });

  it('includes limit when non-default', async () => {
    setLocation('', '/nameres');
    const { buildNameResQueryUrl } = await import('../nameres-url-state');
    const opts: NameResApiOptions = { ...DEFAULT_NAMERES_OPTIONS, limit: 10 };
    const url = buildNameResQueryUrl(['asthma'], ['dev'], opts);
    const params = new URLSearchParams(url.split('#')[1]);
    expect(params.get('limit')).toBe('10');
  });

  it('includes threshold when it differs from limit', async () => {
    setLocation('', '/nameres');
    const { buildNameResQueryUrl } = await import('../nameres-url-state');
    const url = buildNameResQueryUrl(['asthma'], ['dev'], DEFAULT_NAMERES_OPTIONS, 3);
    const params = new URLSearchParams(url.split('#')[1]);
    expect(params.get('threshold')).toBe('3');
  });

  it('omits threshold when it equals limit', async () => {
    setLocation('', '/nameres');
    const { buildNameResQueryUrl } = await import('../nameres-url-state');
    const url = buildNameResQueryUrl(['asthma'], ['dev'], DEFAULT_NAMERES_OPTIONS, 5);
    const params = new URLSearchParams(url.split('#')[1] ?? '');
    expect(params.has('threshold')).toBe(false);
  });

  it('uses current pathname as the base path', async () => {
    setLocation('', '/babel-explorer/nameres');
    const { buildNameResQueryUrl } = await import('../nameres-url-state');
    const url = buildNameResQueryUrl(['asthma'], ['dev'], DEFAULT_NAMERES_OPTIONS);
    expect(url.startsWith('/babel-explorer/nameres#')).toBe(true);
  });

  it('returns just pathname when terms and targets are empty', async () => {
    setLocation('', '/nameres');
    const { buildNameResQueryUrl } = await import('../nameres-url-state');
    const url = buildNameResQueryUrl([], [], DEFAULT_NAMERES_OPTIONS);
    expect(url).toBe('/nameres');
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe('round-trip', () => {
  it('recovers terms, targets, and non-default options', async () => {
    setLocation('', '/nameres');
    const { buildNameResQueryUrl, readNameResQueryState } = await import('../nameres-url-state');

    const terms = ['asthma [[MONDO:0004979]]', 'diabetes'];
    const targets = ['dev', 'prod'];
    const opts: NameResApiOptions = { ...DEFAULT_NAMERES_OPTIONS, limit: 10 };

    const url = buildNameResQueryUrl(terms, targets, opts, 3);
    setLocation('', '/nameres', url.slice(url.indexOf('#')));

    const state = readNameResQueryState();
    expect(state.terms).toEqual(terms);
    expect(state.targets).toEqual(targets);
    expect(state.options.limit).toBe(10);
    expect(state.threshold).toBe(3);
  });

  it('round-trips with all-default options', async () => {
    setLocation('', '/nameres');
    const { buildNameResQueryUrl, readNameResQueryState } = await import('../nameres-url-state');

    const url = buildNameResQueryUrl(['asthma'], ['dev'], DEFAULT_NAMERES_OPTIONS);
    setLocation('', '/nameres', url.slice(url.indexOf('#')));

    const state = readNameResQueryState();
    expect(state.terms).toEqual(['asthma']);
    expect(state.targets).toEqual(['dev']);
    expect(state.options).toEqual({});
    const merged = { ...DEFAULT_NAMERES_OPTIONS, ...state.options };
    expect(merged).toEqual(DEFAULT_NAMERES_OPTIONS);
  });
});
