import type { NameResApiOptions } from './nameres-types';
import { DEFAULT_NAMERES_OPTIONS } from './nameres-types';
import type { AutocompletePresetId } from './autocomplete-presets';
import { DEFAULT_PRESET_ID, getPreset } from './autocomplete-presets';
import { curieKey } from './autocomplete-diff';
import { isValidResultCount } from './nameres-api';

/** Defaults specific to the Autocomplete tool (differ from NameRes tool on `autocomplete`). */
export const DEFAULT_AUTOCOMPLETE_OPTIONS: NameResApiOptions = {
  ...DEFAULT_NAMERES_OPTIONS,
  autocomplete: true,
};

export type DebounceMs = 0 | 150 | 300 | 500;
export const ALLOWED_DEBOUNCE_MS: readonly DebounceMs[] = [0, 150, 300, 500] as const;
export const DEFAULT_DEBOUNCE_MS: DebounceMs = 150;

export interface AutocompleteQueryState {
  query: string;
  preset: AutocompletePresetId;
  targets: string[];
  options: Partial<NameResApiOptions>;
  expected: string[];
  debounceMs?: DebounceMs;
  highlight?: boolean;
}

const STRING_OPTION_KEYS: (keyof NameResApiOptions)[] = [
  'biolink_type',
  'only_prefixes',
  'exclude_prefixes',
  'only_taxa',
];

function parsePreset(raw: string | null): AutocompletePresetId {
  if (raw === 'disease' || raw === 'gene' || raw === 'small_molecule' || raw === 'custom') {
    return raw;
  }
  return DEFAULT_PRESET_ID;
}

function parseDebounce(raw: string | null): DebounceMs | undefined {
  if (raw === null) return undefined;
  const n = parseInt(raw, 10);
  return (ALLOWED_DEBOUNCE_MS as readonly number[]).includes(n) ? (n as DebounceMs) : undefined;
}

/**
 * Read the Autocomplete state from the current URL.
 *
 * Share links keep it in the fragment (#q=…&target=…), like every other tool's, so
 * `#target=` links work the same everywhere and a long `expected=` list never reaches a
 * server's URL length limit. A link that puts it in the query string is read when there
 * is no fragment.
 */
export function readAutocompleteQueryState(): AutocompleteQueryState {
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search);

  const query = params.get('q') ?? '';
  const preset = parsePreset(params.get('preset'));
  const targets = params.getAll('target');
  const expected = params.getAll('expected');

  const options: Partial<NameResApiOptions> = {};
  // A limit the form would refuse (0, negative, over MAX_RESULT_COUNT, not a whole
  // number) is ignored, falling back to the default, rather than sent on every keystroke.
  const limitVal = params.get('limit');
  if (limitVal !== null) {
    const n = Number(limitVal);
    if (isValidResultCount(n)) options.limit = n;
  }
  // Only true/1 and false/0, as in nameres-url-state.ts; `autocomplete=0` used to read
  // as true, since anything but the literal "false" counted.
  const autoVal = params.get('autocomplete');
  if (autoVal === 'true' || autoVal === '1') options.autocomplete = true;
  else if (autoVal === 'false' || autoVal === '0') options.autocomplete = false;
  for (const key of STRING_OPTION_KEYS) {
    const val = params.get(key);
    if (val !== null) (options as Record<string, unknown>)[key] = val;
  }

  const debounceMs = parseDebounce(params.get('debounce'));
  const highlightVal = params.get('highlight');
  const highlight = highlightVal === null ? undefined : highlightVal !== 'false';

  return { query, preset, targets, options, expected, debounceMs, highlight };
}

/** Build the shareable relative URL for the current state, in the fragment (see above). */
export function buildAutocompleteQueryUrl(state: {
  query: string;
  preset: AutocompletePresetId;
  targets: string[];
  options: NameResApiOptions;
  expected: string[];
  debounceMs: DebounceMs;
  highlight: boolean;
}): string {
  const params = new URLSearchParams();

  if (state.query) params.set('q', state.query);
  if (state.preset !== DEFAULT_PRESET_ID) params.set('preset', state.preset);
  for (const target of state.targets) params.append('target', target);
  for (const curie of state.expected) params.append('expected', curie);

  // Compare option values against the preset's implied values first,
  // then fall back to the default-options value for non-preset fields.
  const preset = getPreset(state.preset);
  const presetImplied: Partial<NameResApiOptions> = {
    biolink_type: preset.biolink_type,
    only_prefixes: preset.only_prefixes,
  };

  if (state.options.limit !== DEFAULT_AUTOCOMPLETE_OPTIONS.limit) {
    params.set('limit', String(state.options.limit));
  }
  if (state.options.autocomplete !== DEFAULT_AUTOCOMPLETE_OPTIONS.autocomplete) {
    params.set('autocomplete', String(state.options.autocomplete));
  }
  for (const key of STRING_OPTION_KEYS) {
    const implied =
      key in presetImplied
        ? (presetImplied as Record<string, string>)[key]
        : DEFAULT_AUTOCOMPLETE_OPTIONS[key];
    if (state.options[key] !== implied) {
      params.set(key, state.options[key] as string);
    }
  }

  if (state.debounceMs !== DEFAULT_DEBOUNCE_MS) {
    params.set('debounce', String(state.debounceMs));
  }
  if (!state.highlight) {
    params.set('highlight', 'false');
  }

  const qs = params.toString();
  return qs ? `${window.location.pathname}#${qs}` : window.location.pathname;
}

/** Parse a raw textarea string of expected CURIEs into a deduped list, kept as typed. */
export function parseExpectedCuries(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(/[\s,]+/)) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const key = curieKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}
