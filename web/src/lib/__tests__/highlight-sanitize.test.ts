import { describe, it, expect } from 'vitest';
import { sanitizeHighlight, stripHighlightTags, escapeHtml } from '../highlight-sanitize';

describe('sanitizeHighlight', () => {
  it('preserves bare <em> and </em>', () => {
    expect(sanitizeHighlight('<em>dia</em>betes')).toBe('<em>dia</em>betes');
  });

  it('preserves multiple em pairs', () => {
    expect(sanitizeHighlight('<em>a</em> and <em>b</em>')).toBe('<em>a</em> and <em>b</em>');
  });

  it('escapes <script> and its content', () => {
    const out = sanitizeHighlight('<em>hi</em><script>alert(1)</script>');
    expect(out).toContain('<em>hi</em>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes attributes on <em> (<em onclick=...> becomes inert)', () => {
    const out = sanitizeHighlight('<em onclick="alert(1)">x</em>');
    // The `<em>` with attributes should NOT survive as a tag.
    expect(out).not.toContain('<em onclick');
    expect(out).toContain('&lt;em onclick=');
    // The closing </em> is a bare tag, so it'll pass through — that's fine
    // because a stray </em> with no opener has no effect in the DOM.
    expect(out).toContain('</em>');
  });

  it('escapes <img> and other tags', () => {
    const out = sanitizeHighlight('<img src=x onerror=y>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('escapes quotes', () => {
    expect(sanitizeHighlight(`"hello"`)).toContain('&quot;');
    expect(sanitizeHighlight(`'world'`)).toContain('&#39;');
  });

  it('handles unterminated tags', () => {
    const out = sanitizeHighlight('<em>oops');
    expect(out).toBe('<em>oops');
  });

  it('escapes ampersands', () => {
    expect(sanitizeHighlight('a & b')).toBe('a &amp; b');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeHighlight('')).toBe('');
  });
});

describe('stripHighlightTags', () => {
  it('strips <em> and </em>', () => {
    expect(stripHighlightTags('<em>dia</em>betes')).toBe('diabetes');
  });

  it('leaves other content alone', () => {
    expect(stripHighlightTags('plain text')).toBe('plain text');
  });
});

describe('escapeHtml', () => {
  it('escapes the standard five characters', () => {
    expect(escapeHtml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
