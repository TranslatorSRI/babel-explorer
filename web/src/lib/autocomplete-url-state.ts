import type { NameResApiOptions } from './nameres-types';
import { DEFAULT_NAMERES_OPTIONS } from './nameres-types';
import type { AutocompletePresetId } from './autocomplete-presets';
import { DEFAULT_PRESET_ID, getPreset } from './autocomplete-presets';

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

export function readAutocompleteQueryState(): AutocompleteQueryState {
  const params = new URLSearchParams(window.location.search);

  const query = params.get('q') ?? '';
  const preset = parsePreset(params.get('preset'));
  const targets = params.getAll('target');
  const expected = params.getAll('expected');

  const options: Partial<NameResApiOptions> = {};
  const limitVal = params.get('limit');
  if (limitVal !== null) {
    const n = parseInt(limitVal, 10);
    if (!isNaN(n)) options.limit = n;
  }
  const autoVal = params.get('autocomplete');
  if (autoVal !== null) options.autocomplete = autoVal !== 'false';
  for (const key of STRING_OPTION_KEYS) {
    const val = params.get(key);
    if (val !== null) (options as Record<string, unknown>)[key] = val;
  }

  const debounceMs = parseDebounce(params.get('debounce'));
  const highlightVal = params.get('highlight');
  const highlight = highlightVal === null ? undefined : highlightVal !== 'false';

  return { query, preset, targets, options, expected, debounceMs, highlight };
}

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
  return qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
}

/** Parse a raw textarea string of expected CURIEs into a deduped, normalized list. */
export function parseExpectedCuries(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(/[\s,]+/)) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    // Normalize: upper-case the prefix half before the first colon, preserve the rest.
    const idx = trimmed.indexOf(':');
    const normalized =
      idx > 0 ? trimmed.slice(0, idx).toUpperCase() + trimmed.slice(idx) : trimmed;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}
