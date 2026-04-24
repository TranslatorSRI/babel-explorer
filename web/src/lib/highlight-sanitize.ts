/**
 * Sanitize a NameRes highlighting fragment so it contains only `<em>` tags.
 *
 * Strategy: fully HTML-escape the input, then selectively un-escape the two
 * exact sequences `&lt;em&gt;` and `&lt;/em&gt;`. Because the input is escaped
 * first, anything that isn't a literal `<em>` or `</em>` — attributes, other
 * tags, stray `<` — survives only as inert text.
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

/** Sanitize HTML so only `<em>`/`</em>` tags survive. */
export function sanitizeHighlight(input: string): string {
  const escaped = escapeHtml(input);
  return escaped.replace(/&lt;em&gt;/g, '<em>').replace(/&lt;\/em&gt;/g, '</em>');
}

/** Strip all tags (for when the user toggles highlighting off). */
export function stripHighlightTags(input: string): string {
  return input.replace(/<\/?em>/g, '');
}
