import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uniqueSearchTexts, parseSearchTerms, fetchNameResLookup, fetchNameResLookups, MAX_CONCURRENT_LOOKUPS, validateExpectedCuries } from '../nameres-api';
import { DEFAULT_NAMERES_OPTIONS } from '../nameres-types';
import type { NameResApiOptions, NameResResult } from '../nameres-types';
import asthmaFixture from '../../../../tests/fixtures/nameres_responses/asthma.json';
import diabetesFixture from '../../../../tests/fixtures/nameres_responses/diabetes.json';
import noResultsFixture from '../../../../tests/fixtures/nameres_responses/no_results.json';

// ---------------------------------------------------------------------------
// parseSearchTerms
// ---------------------------------------------------------------------------

describe('parseSearchTerms', () => {
  it('splits multi-line input into terms', () => {
    const terms = parseSearchTerms('asthma\ndiabetes');
    expect(terms).toHaveLength(2);
    expect(terms[0].text).toBe('asthma');
    expect(terms[1].text).toBe('diabetes');
  });

  it('skips blank lines', () => {
    const terms = parseSearchTerms('asthma\n\n\ndiabetes');
    expect(terms).toHaveLength(2);
  });

  it('skips # comment lines', () => {
    const terms = parseSearchTerms('# comment\nasthma\n# another\ndiabetes');
    expect(terms).toHaveLength(2);
    expect(terms[0].text).toBe('asthma');
  });

  it('trims whitespace from lines', () => {
    const terms = parseSearchTerms('  asthma  \n  diabetes  ');
    expect(terms[0].text).toBe('asthma');
    expect(terms[1].text).toBe('diabetes');
  });

  it('keeps one copy of a CURIE annotated twice on a line', () => {
    const [term] = parseSearchTerms('asthma [[MONDO:0004979]] [[MONDO:0004979]]');
    expect(term.expectedCuries).toEqual(['MONDO:0004979']);
  });

  it('deduplicates by search text preserving first occurrence', () => {
    const terms = parseSearchTerms('asthma\ndiabetes\nasthma');
    expect(terms).toHaveLength(2);
  });

  it('keeps a repeated search text that expects different CURIEs', () => {
    const terms = parseSearchTerms('diabetes [[MONDO:0005015]]\ndiabetes [[MONDO:0005148]]');
    expect(terms.map((t) => t.expectedCuries)).toEqual([['MONDO:0005015'], ['MONDO:0005148']]);
    expect(terms.map((t) => t.raw)).toEqual(['diabetes [[MONDO:0005015]]', 'diabetes [[MONDO:0005148]]']);
  });

  it('drops a repeat with the same text and the same expected CURIEs in any order', () => {
    const terms = parseSearchTerms('x [[A:1]] [[B:2]]\nx  [[B:2]][[A:1]]');
    expect(terms).toHaveLength(1);
  });

  it('keeps an annotated line after an unannotated one with the same text', () => {
    const terms = parseSearchTerms('diabetes\ndiabetes [[MONDO:0005015]]');
    expect(terms).toHaveLength(2);
    expect(uniqueSearchTexts(terms)).toEqual(['diabetes']);
  });

  it('returns empty array for empty input', () => {
    expect(parseSearchTerms('')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(parseSearchTerms('  \n  \n  ')).toEqual([]);
  });

  it('extracts single [[CURIE]] annotation', () => {
    const terms = parseSearchTerms('asthma [[MONDO:0004979]]');
    expect(terms).toHaveLength(1);
    expect(terms[0].text).toBe('asthma');
    expect(terms[0].expectedCuries).toEqual(['MONDO:0004979']);
    expect(terms[0].raw).toBe('asthma [[MONDO:0004979]]');
  });

  it('extracts multiple [[CURIE]] annotations', () => {
    const terms = parseSearchTerms('heart failure [[MONDO:0005252]] [[HP:0001635]]');
    expect(terms).toHaveLength(1);
    expect(terms[0].text).toBe('heart failure');
    expect(terms[0].expectedCuries).toEqual(['MONDO:0005252', 'HP:0001635']);
  });

  it('trims whitespace inside [[CURIE]] annotations', () => {
    const terms = parseSearchTerms('asthma [[ MONDO:0004979 ]]');
    expect(terms[0].expectedCuries).toEqual(['MONDO:0004979']);
  });

  it('returns empty expectedCuries for lines without annotations', () => {
    const terms = parseSearchTerms('asthma');
    expect(terms[0].expectedCuries).toEqual([]);
  });

  it('skips lines that become empty after stripping annotations', () => {
    const terms = parseSearchTerms('[[MONDO:0004979]]');
    expect(terms).toEqual([]);
  });

  it('preserves raw line including annotations', () => {
    const terms = parseSearchTerms('asthma [[MONDO:0004979]]');
    expect(terms[0].raw).toBe('asthma [[MONDO:0004979]]');
  });

  it('handles mixed annotated and unannotated lines', () => {
    const terms = parseSearchTerms('asthma [[MONDO:0004979]]\ndiabetes\nheart failure [[MONDO:0005252]]');
    expect(terms).toHaveLength(3);
    expect(terms[0].expectedCuries).toEqual(['MONDO:0004979']);
    expect(terms[1].expectedCuries).toEqual([]);
    expect(terms[2].expectedCuries).toEqual(['MONDO:0005252']);
  });
});

// ---------------------------------------------------------------------------
// fetchNameResLookup
// ---------------------------------------------------------------------------

describe('fetchNameResLookup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('constructs correct URL with default options', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(asthmaFixture),
    });
    vi.stubGlobal('fetch', mockFetch);

    await fetchNameResLookup(
      'https://name-resolution-sri.renci.org/',
      'asthma',
      DEFAULT_NAMERES_OPTIONS,
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.pathname).toBe('/lookup');
    expect(calledUrl.searchParams.get('string')).toBe('asthma');
    expect(calledUrl.searchParams.get('limit')).toBe('5');
    expect(calledUrl.searchParams.get('autocomplete')).toBe('false');
    // Advanced options should not be present when empty
    expect(calledUrl.searchParams.has('biolink_type')).toBe(false);
    expect(calledUrl.searchParams.has('only_prefixes')).toBe(false);
  });

  it('includes advanced options when set', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    vi.stubGlobal('fetch', mockFetch);

    const opts: NameResApiOptions = {
      ...DEFAULT_NAMERES_OPTIONS,
      biolink_type: 'Disease',
      only_prefixes: 'MONDO,HP',
    };
    await fetchNameResLookup('https://example.com/', 'asthma', opts);

    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.searchParams.get('biolink_type')).toBe('Disease');
    expect(calledUrl.searchParams.get('only_prefixes')).toBe('MONDO,HP');
  });

  it('returns parsed JSON array on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(asthmaFixture),
    }));

    const result = await fetchNameResLookup(
      'https://example.com/',
      'asthma',
      DEFAULT_NAMERES_OPTIONS,
    );
    expect(result).toEqual(asthmaFixture);
  });

  it('throws when a 200 response is not a list of results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ detail: 'Not Found' }),
    }));

    await expect(
      fetchNameResLookup('https://example.com/', 'asthma', DEFAULT_NAMERES_OPTIONS),
    ).rejects.toThrow('something other than a list');
  });

  it('throws on non-OK HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    }));

    await expect(
      fetchNameResLookup('https://example.com/', 'asthma', DEFAULT_NAMERES_OPTIONS),
    ).rejects.toThrow('NameRes returned HTTP 500');
  });

  it('throws AbortError when called with an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }),
    ));

    const err = await fetchNameResLookup(
      'https://example.com/', 'asthma', DEFAULT_NAMERES_OPTIONS, controller.signal,
    ).catch((e) => e);

    expect(err.name).toBe('AbortError');
  });
});

// ---------------------------------------------------------------------------
// validateExpectedCuries
// ---------------------------------------------------------------------------

describe('validateExpectedCuries', () => {
  const makeResults = (...curies: string[]): NameResResult[] =>
    curies.map((curie, i) => ({
      curie,
      label: curie.toLowerCase(),
      types: ['biolink:Disease'],
      taxa: [],
      synonyms: [],
      score: 100 - i,
      clique_identifier_count: 10,
    }));

  it('returns none when no expected CURIEs', () => {
    const result = validateExpectedCuries(makeResults('MONDO:001'), [], 5);
    expect(result.status).toBe('none');
  });

  it('returns success when expected CURIE is #1 result', () => {
    const results = makeResults('MONDO:001', 'MONDO:002', 'MONDO:003');
    const result = validateExpectedCuries(results, ['MONDO:001'], 5);
    expect(result.status).toBe('success');
    expect(result.rank).toBe(0);
    expect(result.matchedCurie).toBe('MONDO:001');
  });

  it('returns partial when expected CURIE is within threshold but not #1', () => {
    const results = makeResults('MONDO:001', 'MONDO:002', 'MONDO:003');
    const result = validateExpectedCuries(results, ['MONDO:002'], 5);
    expect(result.status).toBe('partial');
    expect(result.rank).toBe(1);
  });

  it('returns failure when expected CURIE is beyond threshold', () => {
    const results = makeResults('MONDO:001', 'MONDO:002', 'MONDO:003', 'MONDO:004', 'MONDO:005');
    const result = validateExpectedCuries(results, ['MONDO:005'], 3);
    expect(result.status).toBe('failure');
    expect(result.rank).toBe(4);
  });

  it('returns failure when expected CURIE is not in results', () => {
    const results = makeResults('MONDO:001', 'MONDO:002');
    const result = validateExpectedCuries(results, ['FAKE:999'], 5);
    expect(result.status).toBe('failure');
    expect(result.rank).toBe(-1);
  });

  it('returns failure when results are empty', () => {
    const result = validateExpectedCuries([], ['MONDO:001'], 5);
    expect(result.status).toBe('failure');
    expect(result.rank).toBe(-1);
  });

  it('uses any-match semantics: success if any annotation is #1', () => {
    const results = makeResults('MONDO:001', 'MONDO:002');
    const result = validateExpectedCuries(results, ['HP:999', 'MONDO:001'], 5);
    expect(result.status).toBe('success');
    expect(result.matchedCurie).toBe('MONDO:001');
    expect(result.rank).toBe(0);
  });

  it('uses any-match semantics: best rank wins among annotations', () => {
    const results = makeResults('MONDO:001', 'MONDO:002', 'MONDO:003');
    const result = validateExpectedCuries(results, ['MONDO:003', 'MONDO:002'], 5);
    expect(result.status).toBe('partial');
    expect(result.matchedCurie).toBe('MONDO:002');
    expect(result.rank).toBe(1);
  });

  it('threshold of 1 means only #1 is partial (but rank 0 is success)', () => {
    const results = makeResults('MONDO:001', 'MONDO:002');
    // rank 0 is success, not partial
    expect(validateExpectedCuries(results, ['MONDO:001'], 1).status).toBe('success');
    // rank 1 is failure when threshold is 1
    expect(validateExpectedCuries(results, ['MONDO:002'], 1).status).toBe('failure');
  });

  it('exact CURIE matching (case-sensitive)', () => {
    const results = makeResults('MONDO:0004979');
    const result = validateExpectedCuries(results, ['mondo:0004979'], 5);
    expect(result.status).toBe('failure');
  });
});

// ---------------------------------------------------------------------------
// NameRes response shape (documented via fixture assertions)
// ---------------------------------------------------------------------------

describe('NameRes API response shape', () => {
  it('asthma response is an array of results', () => {
    expect(Array.isArray(asthmaFixture)).toBe(true);
    expect(asthmaFixture.length).toBe(5);
  });

  it('each result has curie, label, types, score', () => {
    const first = asthmaFixture[0] as NameResResult;
    expect(typeof first.curie).toBe('string');
    expect(typeof first.label).toBe('string');
    expect(Array.isArray(first.types)).toBe(true);
    expect(typeof first.score).toBe('number');
  });

  it('results are ordered by descending score', () => {
    for (let i = 1; i < asthmaFixture.length; i++) {
      expect((asthmaFixture[i - 1] as NameResResult).score)
        .toBeGreaterThanOrEqual((asthmaFixture[i] as NameResResult).score);
    }
  });

  it('top result for asthma is MONDO:0004979', () => {
    expect((asthmaFixture[0] as NameResResult).curie).toBe('MONDO:0004979');
  });

  it('no_results fixture is an empty array', () => {
    expect(noResultsFixture).toEqual([]);
  });

  it('results have synonyms array', () => {
    const first = asthmaFixture[0] as NameResResult;
    expect(Array.isArray(first.synonyms)).toBe(true);
    expect(first.synonyms.length).toBeGreaterThan(0);
  });

  it('results have clique_identifier_count', () => {
    const first = asthmaFixture[0] as NameResResult;
    expect(typeof first.clique_identifier_count).toBe('number');
    expect(first.clique_identifier_count).toBeGreaterThan(0);
  });
});

describe('fetchNameResLookups', () => {
  afterEach(() => vi.unstubAllGlobals());

  it(`never has more than MAX_CONCURRENT_LOOKUPS requests in flight`, async () => {
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return { ok: true, json: () => Promise.resolve([]) };
    }));
    const texts = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const settled = await fetchNameResLookups('https://nr.example/', texts, DEFAULT_NAMERES_OPTIONS);
    expect(settled).toHaveLength(20);
    expect(settled.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(peak).toBe(MAX_CONCURRENT_LOOKUPS);
  });

  it('fails only the lookup that failed, keeping results in order', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      new URL(url).searchParams.get('string') === 'bad'
        ? { ok: false, status: 500, statusText: 'Internal Server Error' }
        : { ok: true, json: () => Promise.resolve([{ curie: new URL(url).searchParams.get('string') }]) },
    ));
    const settled = await fetchNameResLookups('https://nr.example/', ['a', 'bad', 'c'], DEFAULT_NAMERES_OPTIONS);
    expect(settled.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect((settled[2] as PromiseFulfilledResult<{ curie: string }[]>).value[0].curie).toBe('c');
  });
});

describe('fetchNameResLookups — abort', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('starts no further lookups once the signal is aborted', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      controller.abort();
      return { ok: true, json: () => Promise.resolve([]) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const texts = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const settled = await fetchNameResLookups('https://nr.example/', texts, DEFAULT_NAMERES_OPTIONS, controller.signal);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(MAX_CONCURRENT_LOOKUPS);
    expect(settled).toHaveLength(20);
    expect(settled.at(-1)!.status).toBe('rejected');
  });
});
