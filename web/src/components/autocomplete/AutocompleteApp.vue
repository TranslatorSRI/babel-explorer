<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import type { NameResInstance, NameResApiOptions } from '../../lib/nameres-types';
import { buildLookupUrl, fetchNameResLookup, MAX_RESULT_COUNT } from '../../lib/nameres-api';
import { buildInstances, instanceForUrl, sortInstances, urlToTarget } from '../../lib/instances';
import {
  DEFAULT_AUTOCOMPLETE_OPTIONS,
  DEFAULT_DEBOUNCE_MS,
  buildAutocompleteQueryUrl,
  readAutocompleteQueryState,
  parseExpectedCuries,
} from '../../lib/autocomplete-url-state';
import type { DebounceMs } from '../../lib/autocomplete-url-state';
import { debounce } from '../../lib/debounce';
import { emptyInstanceState } from '../../lib/autocomplete-state';
import type { InstanceState } from '../../lib/autocomplete-state';
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

const instances: NameResInstance[] = buildInstances('NameRes', endpoints.nameres);

function urlsToTargets(urls: string[]): string[] {
  return urls.map((url) => urlToTarget(instances, url));
}

function instanceFor(url: string): NameResInstance {
  return instanceForUrl(instances, url);
}

// ─── State ──────────────────────────────────────────────────────────────────

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

/**
 * The options every live lookup sends. Highlighting is requested only while it is shown:
 * it costs Solr time, and the latency badges should reflect what a plain autocomplete
 * request costs when the marks are not wanted.
 */
const lookupOptions = computed<NameResApiOptions>(() => ({
  ...options.value,
  highlighting: highlight.value,
}));

const perInstance = ref<Map<string, InstanceState>>(new Map());
const queriedInstances = computed<NameResInstance[]>(() =>
  sortInstances(selectedUrls.value.map(instanceFor))
);
const checking = ref(false);
const singleState = computed<InstanceState>(() =>
  perInstance.value.get(queriedInstances.value[0]?.url) ?? emptyInstanceState(),
);
const hasDeepResults = computed(() => {
  for (const s of perInstance.value.values()) if (s.deepResults) return true;
  return false;
});

// ─── Abort + debounce machinery ─────────────────────────────────────────────

let abortController: AbortController | null = null;
// The deep check has its own controller so it never cancels the live lookup.
let deepController: AbortController | null = null;
let lastFireId = 0;

function abortDeepCheck() {
  deepController?.abort();
  deepController = null;
  checking.value = false;
}

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
  abortDeepCheck();
  resetDeepResultsOnly();

  const q = query.value.trim();
  // Reset state for an empty query — clean, no fetch. Cancel and invalidate
  // any lookup still in flight so it cannot write into the cleared box.
  if (!q) {
    abortController?.abort();
    lastFireId++;
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

  // Nothing to query. The watcher that brought us here has already aborted any lookup
  // in flight, so drop its state too, or its inFlight flags keep the spinner and the
  // "Cancel lookup" button up for good.
  if (selectedUrls.value.length === 0) {
    prunePerInstance();
    return;
  }

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
    return fetchNameResLookup(url, q, lookupOptions.value, signal).then(
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

// Rebuild the debounced fire whenever the delay changes. A lookup still waiting out the
// old delay is re-scheduled under the new one, not dropped: the query watcher has
// already aborted the previous lookup, so dropping it left the old query's results on
// screen until the next keystroke.
let debouncedFire: ReturnType<typeof debounce<(...a: unknown[]) => void>> = debounce(fire, DEFAULT_DEBOUNCE_MS);
watch(
  debounceMs,
  (ms) => {
    const wasPending = debouncedFire.pending();
    debouncedFire.cancel();
    debouncedFire = debounce(fire, ms);
    if (wasPending) debouncedFire();
  },
  { immediate: true },
);

// Reactive triggers: any of these change → debounced fire. Invalidate the
// previous lookup and sync the URL at once rather than when the debounce
// expires, or a reply for the old query can still render under the new one.
watch(
  [query, selectedUrls, () => JSON.stringify(lookupOptions.value)],
  () => {
    abortController?.abort();
    lastFireId++;
    abortDeepCheck();
    syncUrl();
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
watch([preset, expectedRaw, debounceMs], syncUrl);

// ─── Expected-CURIE deep check ──────────────────────────────────────────────

async function runDeepCheck() {
  const q = query.value.trim();
  if (!q || expected.value.length === 0 || selectedUrls.value.length === 0) return;

  abortDeepCheck();
  checking.value = true;
  const controller = (deepController = new AbortController());
  const { signal } = controller;
  // Only ranks are read from the deep results, so they need no highlighting.
  const deepOpts = { ...options.value, limit: MAX_RESULT_COUNT, highlighting: false };

  const calls = selectedUrls.value.map((url) =>
    fetchNameResLookup(url, q, deepOpts, signal).then(
      (res) => ({ url, ok: true as const, res }),
      (err: Error) => ({ url, ok: false as const, err }),
    ),
  );
  const outcomes = await Promise.all(calls);
  // Stale-write guard: a newer query or deep check has replaced this one.
  if (deepController !== controller) return;
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
  deepController = null;
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
  abortDeepCheck();
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
    return buildLookupUrl(url, query.value.trim(), lookupOptions.value).toString();
  } catch {
    return url;
  }
}

const apiUrlsMap = computed(() => {
  const m = new Map<string, string>();
  for (const inst of queriedInstances.value) m.set(inst.url, apiUrlFor(inst.url));
  return m;
});

// ─── Lifecycle ──────────────────────────────────────────────────────────────

onMounted(() => {
  // If the URL contained a query, fire once selectedUrls has settled (InstanceSelector emits on mount).
  if (query.value && selectedUrls.value.length > 0) debouncedFire();
});

onBeforeUnmount(() => {
  abortController?.abort();
  deepController?.abort();
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
      :state="singleState"
      :highlight="highlight"
      :api-url="apiUrlFor(queriedInstances[0].url)"
    />
  </div>
  <div v-else-if="queriedInstances.length > 1">
    <AutocompleteComparisonView
      :queried-instances="queriedInstances"
      :per-instance="perInstance"
      :expected="expected"
      :highlight="highlight"
      :api-urls="apiUrlsMap"
    />
  </div>
  <div v-else class="alert alert-info">
    Select at least one NameRes instance to begin.
  </div>
</template>
