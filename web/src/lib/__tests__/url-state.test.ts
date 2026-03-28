import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_API_OPTIONS } from '../types';
import type { ApiOptions } from '../types';

// We need to stub window.location before importing, so we use dynamic imports
// inside each test group after setting up the stub.

// Helper: set window.location.search + pathname via stub
function setLocation(search: string, pathname = '/nodenorm') {
  Object.defineProperty(window, 'location', {
    value: { search, pathname, href: `http://localhost${pathname}${search}` },
    writable: true,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// readQueryState
// ---------------------------------------------------------------------------

describe('readQueryState', () => {
  beforeEach(() => {
    setLocation('');
  });

  it('returns empty arrays and no options when there are no params', async () => {
    setLocation('');
    const { readQueryState } = await import('../url-state');
    const state = readQueryState();
    expect(state.curies).toEqual([]);
    expect(state.targets).toEqual([]);
    expect(state.options).toEqual({});
  });

  it('parses repeated curie= params', async () => {
    setLocation('?curie=MONDO%3A0004979&curie=CHEBI%3A48947');
    const { readQueryState } = await import('../url-state');
    const state = readQueryState();
    expect(state.curies).toEqual(['MONDO:0004979', 'CHEBI:48947']);
  });

  it('parses a single target= param', async () => {
    setLocation('?curie=MONDO%3A0004979&target=dev');
    const { readQueryState } = await import('../url-state');
    const state = readQueryState();
    expect(state.targets).toEqual(['dev']);
  });

  it('parses multiple target= params (compare mode)', async () => {
    setLocation('?curie=MONDO%3A0004979&target=dev&target=prod');
    const { readQueryState } = await import('../url-state');
    const state = readQueryState();
    expect(state.targets.length).toBe(2);
    expect(state.targets).toContain('dev');
    expect(state.targets).toContain('prod');
  });

  it('parses conflate=false into options.conflate === false', async () => {
    setLocation('?curie=MONDO%3A0004979&target=dev&conflate=false');
    const { readQueryState } = await import('../url-state');
    const state = readQueryState();
    expect(state.options.conflate).toBe(false);
  });

  it('parses conflate=true into options.conflate === true', async () => {
    setLocation('?conflate=true');
    const { readQueryState } = await import('../url-state');
    const state = readQueryState();
    expect(state.options.conflate).toBe(true);
  });

  it('omits option keys that are absent from the URL', async () => {
    setLocation('?conflate=false');
    const { readQueryState } = await import('../url-state');
    const state = readQueryState();
    expect('drug_chemical_conflate' in state.options).toBe(false);
    expect('description' in state.options).toBe(false);
    expect('individual_types' in state.options).toBe(false);
    expect('include_taxa' in state.options).toBe(false);
  });

  it('parses all option keys when present', async () => {
    setLocation(
      '?conflate=false&drug_chemical_conflate=false&description=false&individual_types=false&include_taxa=false',
    );
    const { readQueryState } = await import('../url-state');
    const state = readQueryState();
    expect(state.options).toEqual({
      conflate: false,
      drug_chemical_conflate: false,
      description: false,
      individual_types: false,
      include_taxa: false,
    });
  });
});

// ---------------------------------------------------------------------------
// buildQueryUrl
// ---------------------------------------------------------------------------

describe('buildQueryUrl', () => {
  beforeEach(() => {
    setLocation('', '/nodenorm');
  });

  it('produces curie= and target= params', async () => {
    setLocation('', '/nodenorm');
    const { buildQueryUrl } = await import('../url-state');
    const url = buildQueryUrl(['MONDO:0004979', 'CHEBI:48947'], ['dev'], DEFAULT_API_OPTIONS);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.getAll('curie')).toEqual(['MONDO:0004979', 'CHEBI:48947']);
    expect(params.getAll('target')).toEqual(['dev']);
  });

  it('omits all API option params when using defaults', async () => {
    setLocation('', '/nodenorm');
    const { buildQueryUrl } = await import('../url-state');
    const url = buildQueryUrl(['MONDO:0004979'], ['dev'], DEFAULT_API_OPTIONS);
    const params = new URLSearchParams(url.split('?')[1] ?? '');
    for (const key of ['conflate', 'drug_chemical_conflate', 'description', 'individual_types', 'include_taxa']) {
      expect(params.has(key)).toBe(false);
    }
  });

  it('includes conflate=false when it differs from default', async () => {
    setLocation('', '/nodenorm');
    const { buildQueryUrl } = await import('../url-state');
    const opts: ApiOptions = { ...DEFAULT_API_OPTIONS, conflate: false };
    const url = buildQueryUrl(['MONDO:0004979'], ['dev'], opts);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('conflate')).toBe('false');
    // Other options are still default, so not included
    expect(params.has('drug_chemical_conflate')).toBe(false);
  });

  it('includes multiple target= params for compare mode', async () => {
    setLocation('', '/nodenorm');
    const { buildQueryUrl } = await import('../url-state');
    const url = buildQueryUrl(['MONDO:0004979'], ['dev', 'prod'], DEFAULT_API_OPTIONS);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.getAll('target')).toEqual(['dev', 'prod']);
  });

  it('uses current pathname as the base path', async () => {
    setLocation('', '/babel-explorer/nodenorm');
    const { buildQueryUrl } = await import('../url-state');
    const url = buildQueryUrl(['MONDO:0004979'], ['dev'], DEFAULT_API_OPTIONS);
    expect(url.startsWith('/babel-explorer/nodenorm?')).toBe(true);
  });

  it('returns just the pathname when curies and targets are empty', async () => {
    setLocation('', '/nodenorm');
    const { buildQueryUrl } = await import('../url-state');
    const url = buildQueryUrl([], [], DEFAULT_API_OPTIONS);
    expect(url).toBe('/nodenorm');
  });
});

// ---------------------------------------------------------------------------
// Round-trip: buildQueryUrl → readQueryState
// ---------------------------------------------------------------------------

describe('round-trip', () => {
  it('recovers curies, targets, and non-default options through a URL round-trip', async () => {
    setLocation('', '/nodenorm');
    const { buildQueryUrl, readQueryState } = await import('../url-state');

    const curies = ['MONDO:0004979', 'CHEBI:48947'];
    const targets = ['dev', 'prod'];
    const opts: ApiOptions = { ...DEFAULT_API_OPTIONS, conflate: false };

    const url = buildQueryUrl(curies, targets, opts);

    // Simulate opening the URL
    const qs = url.includes('?') ? url.slice(url.indexOf('?')) : '';
    setLocation(qs, '/nodenorm');

    const state = readQueryState();
    expect(state.curies).toEqual(curies);
    expect(state.targets).toEqual(targets);
    expect(state.options.conflate).toBe(false);
    // Options that match defaults are not encoded and therefore not present
    expect('drug_chemical_conflate' in state.options).toBe(false);
  });

  it('round-trips correctly with all-default options (no option params in URL)', async () => {
    setLocation('', '/nodenorm');
    const { buildQueryUrl, readQueryState } = await import('../url-state');

    const url = buildQueryUrl(['MONDO:0004979'], ['dev'], DEFAULT_API_OPTIONS);
    const qs = url.includes('?') ? url.slice(url.indexOf('?')) : '';
    setLocation(qs, '/nodenorm');

    const state = readQueryState();
    expect(state.curies).toEqual(['MONDO:0004979']);
    expect(state.targets).toEqual(['dev']);
    expect(state.options).toEqual({});
    // Merging with defaults recovers full options
    const merged = { ...DEFAULT_API_OPTIONS, ...state.options };
    expect(merged).toEqual(DEFAULT_API_OPTIONS);
  });
});
