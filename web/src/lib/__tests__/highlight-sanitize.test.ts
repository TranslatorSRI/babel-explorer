import { describe, it, expect } from 'vitest';
import {
  decodeEntities,
  escapeHtml,
  highlightEntries,
  labelFragment,
  renderHighlight,
} from '../highlight-sanitize';
import type { NameResResult } from '../nameres-types';
import crohnFixture from '../../../../tests/fixtures/nameres_responses/crohn_highlighting.json';
import asthmaFixture from '../../../../tests/fixtures/nameres_responses/asthma.json';

const crohn = crohnFixture as NameResResult[];

describe('renderHighlight', () => {
  it("turns NameRes's <strong> marks into <mark>", () => {
    expect(renderHighlight('<strong>dia</strong>betes')).toBe('<mark>dia</mark>betes');
  });

  it('accepts <em> marks too', () => {
    expect(renderHighlight('<em>a</em> and <em>b</em>')).toBe('<mark>a</mark> and <mark>b</mark>');
  });

  it('decodes the entities Solr encodes, so they are not shown literally', () => {
    expect(renderHighlight('<strong>Crohn&#x27;s</strong> colitis')).toBe(
      '<mark>Crohn&#39;s</mark> colitis',
    );
    expect(renderHighlight('A &amp; B')).toBe('A &amp; B');
  });

  it('drops the marks when highlighting is off', () => {
    expect(renderHighlight('<strong>Crohn&#x27;s</strong> colitis', false)).toBe('Crohn&#39;s colitis');
  });

  it('keeps an encoded <script> inert', () => {
    const out = renderHighlight('<strong>hi</strong>&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toBe('<mark>hi</mark>&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes raw tags other than bare marks, attributes included', () => {
    expect(renderHighlight('<img src=x onerror=y>')).toBe('&lt;img src=x onerror=y&gt;');
    expect(renderHighlight('<strong onclick="alert(1)">x</strong>')).toBe(
      '&lt;strong onclick=&quot;alert(1)&quot;&gt;x',
    );
  });

  it('keeps marks balanced', () => {
    expect(renderHighlight('<strong>oops')).toBe('<mark>oops</mark>');
    expect(renderHighlight('stray</strong> close')).toBe('stray close');
    expect(renderHighlight('<strong><strong>x</strong>')).toBe('<mark>x</mark>');
  });

  it('returns empty string for empty input', () => {
    expect(renderHighlight('')).toBe('');
  });
});

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('&lt;&gt;&amp;&quot;&#39;&#x27;&#x2F;')).toBe('<>&"\'\'/');
  });

  it('leaves unknown or out-of-range entities alone', () => {
    expect(decodeEntities('&bogus; &#x110000;')).toBe('&bogus; &#x110000;');
  });
});

describe('labelFragment', () => {
  it("uses NameRes's highlighted label when the lookup asked for one", () => {
    const colitis = crohn.find((r) => r.label === "Crohn's colitis")!;
    expect(renderHighlight(labelFragment(colitis))).toBe('<mark>Crohn&#39;s</mark> colitis');
  });

  it('falls back to the plain label, encoded so it renders as typed', () => {
    const plain = (asthmaFixture as NameResResult[])[0];
    expect(plain.highlighting).toEqual({});
    expect(renderHighlight(labelFragment(plain))).toBe(escapeHtml(plain.label));
    expect(renderHighlight(labelFragment({ ...plain, label: 'A <b> & C' }))).toBe('A &lt;b&gt; &amp; C');
  });
});

describe('highlightEntries', () => {
  it('groups the recorded fragments by field', () => {
    const entries = highlightEntries(crohn[0]);
    expect(entries.map((e) => e.field)).toEqual(['labels', 'synonyms']);
    expect(entries[0].fragments[0]).toContain('<strong>Crohn</strong>');
  });

  it('is empty when NameRes returned no highlighting', () => {
    expect(highlightEntries((asthmaFixture as NameResResult[])[0])).toEqual([]);
  });
});

describe('escapeHtml', () => {
  it('escapes the standard five characters', () => {
    expect(escapeHtml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
