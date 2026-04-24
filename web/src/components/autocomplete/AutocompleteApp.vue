<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import type { NameResInstance, NameResResult, NameResApiOptions } from '../../lib/nameres-types';
import { fetchNameResLookup } from '../../lib/nameres-api';
import { loadPrefixMap } from '../../lib/curie-links';
import {
  DEFAULT_AUTOCOMPLETE_OPTIONS,
  DEFAULT_DEBOUNCE_MS,
  buildAutocompleteQueryUrl,
  readAutocompleteQueryState,
  parseExpectedCuries,
} from '../../lib/autocomplete-url-state';
import type { DebounceMs } from '../../lib/autocomplete-url-state';
import { debounce } from '../../lib/debounce';
import {
  DEFAULT_PRESET_ID,
  getPreset,
} from '../../lib/autocomplete-presets';
import type { AutocompletePresetId } from '../../lib/autocomplete-presets';
import AutocompleteForm from './AutocompleteForm.vue';
import AutocompleteResults from './AutocompleteResults.vue';
import AutocompleteComparisonView from './AutocompleteComparisonView.vue';
import endpoints from '../../../../config/translator-endpoints.json';

// ─── Instance list (shared config) ───────────────────────────────────────────

const ENV_LABELS: Record<string, string> = {
  dev: 'Dev',
  exp: 'Exp',
  ci: 'CI',
  test: 'Test',
  prod: 'Production',
};

const instances: NameResInstance[] = Object.entries(endpoints.nameres).map(
  ([env, url]) => ({ name: `NameRes ${ENV_LABELS[env] ?? env}`, env, url: url as string }),
);

function urlsToTargets(urls: string[]): string[] {
  return urls.map((url) => instances.find((i) => i.url === url)?.env ?? url);
}

function instanceFor(url: string): NameResInstance {
  return instances.find((i) => i.url === url) ?? { name: url, env: url, url };
}

// ─── State ──────────────────────────────────────────────────────────────────

interface InstanceState {
  results: NameResResult[];
  deepResults?: NameResResult[];
  elapsedMs: number | null;
  error: string | null;
  inFlight: boolean;
  state: 'ok' | 'error' | 'cancelled' | 'idle';
}

function emptyInstanceState(): InstanceState {
  return { results: [], elapsedMs: null, error: null, inFlight: false, state: 'idle' };
}

// Read URL state synchronously so initial form matches the URL.
const urlState = typeof window !== 'undefined' ? readAutocompleteQueryState() : null;
const initialPreset = urlState?.preset ?? DEFAULT_PRESET_ID;
const initialPresetImplied = getPreset(initialPreset);

const query = ref<string>(urlState?.query ?? '');
const preset = ref<AutocompletePresetId>(initialPreset);
const options = ref<NameResApiOptions>({
  ...DEFAULT_AUTOCOMPLETE_OPTIONS,
  biolink_type: initialPresetImplied.biolink_type,
  only_prefixes: initialPresetImplied.only_prefixes,
  ...(urlState?.options ?? {}),
});
const selectedUrls = ref<string[]>([]);
const expectedRaw = ref<string>((urlState?.expected ?? []).join('\n'));
const expected = computed(() => parseExpectedCuries(expectedRaw.value));
const debounceMs = ref<DebounceMs>(urlState?.debounceMs ?? DEFAULT_DEBOUNCE_MS);
const highlight = ref<boolean>(urlState?.highlight ?? true);

const perInstance = ref<Map<string, InstanceState>>(new Map());
const queriedInstances = computed<NameResInstance[]>(() => selectedUrls.value.map(instanceFor));
const prefixMap = ref<Record<string, string>>({});
const checking = ref(false);
const hasDeepResults = computed(() => {
  for (const s of perInstance.value.values()) if (s.deepResults) return true;
  return false;
});

// ─── Abort + debounce machinery ─────────────────────────────────────────────

let abortController: AbortController | null = null;
let lastFireId = 0;

function ensureInstanceState(url: string): InstanceState {
  let s = perInstance.value.get(url);
  if (!s) {
    s = emptyInstanceState();
    perInstance.value.set(url, s);
  }
  return s;
}

function resetDeepResultsOnly() {
  for (const s of perInstance.value.values()) {
    s.deepResults = undefined;
  }
  // Trigger reactivity on the Map.
  perInstance.value = new Map(perInstance.value);
}

function prunePerInstance() {
  // Drop entries for instances the user has deselected.
  const keep = new Set(selectedUrls.value);
  for (const url of [...perInstance.value.keys()]) {
    if (!keep.has(url)) perInstance.value.delete(url);
  }
  for (const url of keep) ensureInstanceState(url);
  perInstance.value = new Map(perInstance.value);
}

async function fire() {
  // Invalidate deep results whenever the primary query fires.
  resetDeepResultsOnly();

  const q = query.value.trim();
  // Reset state for an empty query — clean, no fetch.
  if (!q) {
    for (const s of perInstance.value.values()) {
      s.results = [];
      s.elapsedMs = null;
      s.error = null;
      s.inFlight = false;
      s.state = 'idle';
    }
    perInstance.value = new Map(perInstance.value);
    syncUrl();
    return;
  }

  if (selectedUrls.value.length === 0) return;

  abortController?.abort();
  abortController = new AbortController();
  const { signal } = abortController;
  const myId = ++lastFireId;

  prunePerInstance();
  for (const url of selectedUrls.value) {
    const s = ensureInstanceState(url);
    s.inFlight = true;
    s.error = null;
  }
  perInstance.value = new Map(perInstance.value);

  syncUrl();

  const calls = selectedUrls.value.map((url) => {
    const t0 = performance.now();
    return fetchNameResLookup(url, q, options.value, signal).then(
      (res) => ({ url, ok: true as const, res, ms: performance.now() - t0 }),
      (err: Error) => ({ url, ok: false as const, err, ms: performance.now() - t0 }),
    );
  });

  const outcomes = await Promise.all(calls);
  // Stale-write guard.
  if (myId !== lastFireId) return;

  for (const o of outcomes) {
    const s = ensureInstanceState(o.url);
    s.elapsedMs = o.ms;
    s.inFlight = false;
    if (o.ok) {
      s.results = o.res;
      s.error = null;
      s.state = 'ok';
    } else if (o.err?.name === 'AbortError') {
      s.state = 'cancelled';
      s.error = null;
    } else {
      s.error = o.err?.message ?? String(o.err);
      s.results = [];
      s.state = 'error';
    }
  }
  perInstance.value = new Map(perInstance.value);
}

// Rebuild the debounced fire whenever the delay changes.
let debouncedFire: ReturnType<typeof debounce<(...a: unknown[]) => void>> = debounce(fire, DEFAULT_DEBOUNCE_MS);
watch(
  debounceMs,
  (ms) => {
    debouncedFire.cancel();
    debouncedFire = debounce(fire, ms);
  },
  { immediate: true },
);

// Reactive triggers: any of these change → debounced fire.
watch(
  [query, selectedUrls, () => JSON.stringify(options.value)],
  () => {
    debouncedFire();
  },
);

function syncUrl() {
  if (typeof window === 'undefined') return;
  const url = buildAutocompleteQueryUrl({
    query: query.value,
    preset: preset.value,
    targets: urlsToTargets(selectedUrls.value),
    options: options.value,
    expected: expected.value,
    debounceMs: debounceMs.value,
    highlight: highlight.value,
  });
  window.history.replaceState(null, '', url);
}

// Non-fetch state changes still update the URL so "Copy link" reflects them.
watch([preset, expectedRaw, debounceMs, highlight], syncUrl);

// ─── Expected-CURIE deep check ──────────────────────────────────────────────

async function runDeepCheck() {
  const q = query.value.trim();
  if (!q || expected.value.length === 0 || selectedUrls.value.length === 0) return;

  checking.value = true;
  abortController?.abort();
  abortController = new AbortController();
  const { signal } = abortController;
  const deepOpts = { ...options.value, limit: 100 };

  const calls = selectedUrls.value.map((url) =>
    fetchNameResLookup(url, q, deepOpts, signal).then(
      (res) => ({ url, ok: true as const, res }),
      (err: Error) => ({ url, ok: false as const, err }),
    ),
  );
  const outcomes = await Promise.all(calls);
  for (const o of outcomes) {
    const s = ensureInstanceState(o.url);
    if (o.ok) {
      s.deepResults = o.res;
    } else if (o.err?.name !== 'AbortError') {
      // Don't overwrite the primary error — this is a secondary check.
      s.deepResults = [];
    }
  }
  perInstance.value = new Map(perInstance.value);
  checking.value = false;
}

// ─── Copy-link ──────────────────────────────────────────────────────────────

async function handleShare() {
  try {
    await navigator.clipboard.writeText(window.location.href);
  } catch { /* noop */ }
}

function handleStop() {
  abortController?.abort();
  for (const s of perInstance.value.values()) {
    if (s.inFlight) {
      s.inFlight = false;
      s.state = 'cancelled';
    }
  }
  perInstance.value = new Map(perInstance.value);
}

// Build the per-instance NameRes /lookup URL for display/copy.
function apiUrlFor(url: string): string {
  try {
    const u = new URL('lookup', url);
    u.searchParams.set('string', query.value.trim());
    u.searchParams.set('limit', String(options.value.limit));
    u.searchParams.set('autocomplete', String(options.value.autocomplete));
    if (options.value.biolink_type) u.searchParams.set('biolink_type', options.value.biolink_type);
    if (options.value.only_prefixes) u.searchParams.set('only_prefixes', options.value.only_prefixes);
    if (options.value.exclude_prefixes) u.searchParams.set('exclude_prefixes', options.value.exclude_prefixes);
    if (options.value.only_taxa) u.searchParams.set('only_taxa', options.value.only_taxa);
    return u.toString();
  } catch {
    return url;
  }
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

onMounted(async () => {
  prefixMap.value = await loadPrefixMap();
  // If the URL contained a query, fire once selectedUrls has settled (InstanceSelector emits on mount).
  if (query.value && selectedUrls.value.length > 0) debouncedFire();
});

onBeforeUnmount(() => {
  abortController?.abort();
  debouncedFire.cancel();
});

const initialTargets = computed<string[] | undefined>(() =>
  urlState?.targets.length ? urlState.targets : undefined,
);
</script>

<template>
  <div class="card mb-4">
    <div class="card-header">Autocomplete Playground</div>
    <div class="card-body">
      <AutocompleteForm
        :instances="instances"
        :query="query"
        :preset="preset"
        :options="options"
        :selected-urls="selectedUrls"
        :expected="expected"
        :expected-raw="expectedRaw"
        :debounce-ms="debounceMs"
        :highlight="highlight"
        :initial-targets="initialTargets"
        :checking="checking"
        :per-instance="perInstance"
        :queried-instances="queriedInstances"
        :prefix-map="prefixMap"
        :has-deep-results="hasDeepResults"
        @update:query="(v) => (query = v)"
        @update:preset="(v) => (preset = v)"
        @update:options="(v) => (options = v)"
        @update:selected-urls="(v) => (selectedUrls = v)"
        @update:expected-raw="(v) => (expectedRaw = v)"
        @update:debounce-ms="(v) => (debounceMs = v)"
        @update:highlight="(v) => (highlight = v)"
        @check="runDeepCheck"
        @share="handleShare"
        @stop="handleStop"
      />
    </div>
  </div>

  <div v-if="queriedInstances.length === 1">
    <AutocompleteResults
      :instance="queriedInstances[0]"
      :state="perInstance.get(queriedInstances[0].url) ?? { results: [], elapsedMs: null, error: null, inFlight: false, state: 'idle' }"
      :highlight="highlight"
      :prefix-map="prefixMap"
      :api-url="apiUrlFor(queriedInstances[0].url)"
    />
  </div>
  <div v-else-if="queriedInstances.length > 1">
    <AutocompleteComparisonView
      :queried-instances="queriedInstances"
      :per-instance="perInstance"
      :expected="expected"
      :highlight="highlight"
      :prefix-map="prefixMap"
    />
  </div>
  <div v-else class="alert alert-info">
    Select at least one NameRes instance to begin.
  </div>
</template>
