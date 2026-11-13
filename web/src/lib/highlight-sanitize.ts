import type { NameResResult } from './nameres-types';

/**
 * Rendering NameRes highlighting fragments safely.
 *
 * NameRes returns highlighting only when a lookup sends `highlighting=true`, as
 * `{ labels: [...], synonyms: [...] }`. Each fragment is Solr output with
 * `hl.encoder=html`: its text is HTML-encoded (`Crohn&#x27;s`) and each match is wrapped
 * in `<strong>…</strong>` (see `lookup()` in NameRes's api/server.py). This module once
 * passed through only `<em>`, so every real mark showed up as literal `<strong>` text.
 */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decode the entities an HTML encoder produces; anything unrecognised is left as typed. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const hex = entity[1] === 'x' || entity[1] === 'X';
      const codePoint = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** The tags a highlighter wraps a match in: Solr's `<strong>`, and `<em>` for safety. */
const MARK_TAG = /<(\/?)(?:strong|em)>/gi;

/**
 * Turn an HTML-encoded highlighting fragment into HTML for `v-html` that contains no
 * markup except `<mark>` around each match (or none at all when `highlight` is false).
 *
 * Only the bare mark tags are recognised. All other text is decoded and then re-escaped,
 * so an attribute, another tag or an encoded `&lt;script&gt;` survives only as inert
 * text. Marks are kept balanced, so a stray closing tag cannot close an outer element.
 */
export function renderHighlight(fragment: string, highlight = true): string {
  let out = '';
  let open = false;
  let last = 0;
  for (const m of fragment.matchAll(MARK_TAG)) {
    out += escapeHtml(decodeEntities(fragment.slice(last, m.index)));
    last = m.index + m[0].length;
    if (!highlight) continue;
    const closing = m[1] === '/';
    if (!closing && !open) {
      out += '<mark>';
      open = true;
    } else if (closing && open) {
      out += '</mark>';
      open = false;
    }
  }
  out += escapeHtml(decodeEntities(fragment.slice(last)));
  if (open) out += '</mark>';
  return out;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * The fragment to show as a result's label: NameRes's highlighted copy of it when the
 * lookup asked for highlighting, otherwise the plain label, encoded the same way so
 * either can go to renderHighlight.
 */
export function labelFragment(r: NameResResult): string {
  return stringList(r.highlighting?.labels)[0] ?? escapeHtml(r.label);
}

/** The highlighted fragments of a result, grouped by the field NameRes matched them in. */
export function highlightEntries(r: NameResResult): { field: string; fragments: string[] }[] {
  const out: { field: string; fragments: string[] }[] = [];
  for (const [field, value] of Object.entries(r.highlighting ?? {})) {
    const fragments = stringList(value);
    if (fragments.length > 0) out.push({ field, fragments });
  }
  return out;
}
