<script setup lang="ts">
import { ref, shallowRef, reactive, computed, onMounted, onBeforeUnmount } from 'vue';
import type { NormalizedNode, NodeNormResponse, NodeNormInstance, ApiOptions } from '../../lib/types';
import { DEFAULT_API_OPTIONS } from '../../lib/types';
import { fetchNormalizedNodes, parseCuries } from '../../lib/nodenorm-api';
import { buildInstances, instanceForUrl, resolveTarget, urlToTarget } from '../../lib/instances';
import { readQueryState, buildQueryUrl } from '../../lib/url-state';
import NodeNormForm from './NodeNormForm.vue';
import ComparisonView from './ComparisonView.vue';
import ResultsSummary from './ResultsSummary.vue';
import ColumnVisibility from './ColumnVisibility.vue';
import endpoints from '../../../../config/translator-endpoints.json';

const instances: NodeNormInstance[] = buildInstances(endpoints.nodenorm);

// State
const loading = ref(false);
const error = ref<string | null>(null);
/** Informational message, such as "Query stopped". */
const notice = ref<string | null>(null);
/** Targets in the page URL that are neither known instances nor http(s) URLs. */
const ignoredTargets = ref<string[]>([]);
const queriedCuries = ref<string[]>([]);
const visibleColumns = reactive(new Set(['type', 'taxa']));

// Read URL state synchronously so NodeNormForm receives correct initial values
// on its first render (before onMounted fires). A later fragment change (a pasted
// share link, or Back) replaces it and remounts the form via formKey.
const urlState = ref(readQueryState());
const formKey = ref(0);

// Results keyed by instance URL. Only ever replaced whole, so shallowRef avoids
// deep-proxying every NodeNorm response.
const resultsByInstance = shallowRef(new Map<string, NodeNormResponse>());
const queriedInstances = ref<NodeNormInstance[]>([]);
const queriedOptions = ref<ApiOptions>(DEFAULT_API_OPTIONS);
const hasResults = computed(() => resultsByInstance.value.size > 0);
const typeFilter = reactive(new Set<string>());

// Controller for the query in flight, if any. A newer query aborts the older one.
let abortController: AbortController | null = null;

/** Run (or clear) the query that the page URL describes. */
async function applyUrlState() {
  const { curies, targets, options } = urlState.value;
  const resolved = targets.map((t) => resolveTarget(instances, t));
  ignoredTargets.value = targets.filter((_, i) => resolved[i] === null);
  const instanceUrls = [...new Set(resolved.filter((u): u is string => u !== null))];

  if (curies.length === 0) {
    abortController?.abort();
    resultsByInstance.value = new Map();
    error.value = null;
    notice.value = null;
    return;
  }
  // A link naming only unusable targets would otherwise silently query the default
  // instance instead; the warning below explains why nothing ran.
  if (targets.length > 0 && instanceUrls.length === 0) return;

  await handleSubmit({
    curies: curies.join('\n'),
    instanceUrls: instanceUrls.length > 0 ? instanceUrls : [instances[0].url],
    options: { ...DEFAULT_API_OPTIONS, ...options },
  });
}

// The fragment the page currently reflects, so a hashchange to the URL this page
// wrote itself is not run again. Browsers fire no hashchange for replaceState, but
// happy-dom (the test DOM) does.
let shownHash = window.location.hash;

// The browser does not reload for a fragment-only navigation, so a share link pasted
// into a tab already on this page, or Back, arrives only as a hashchange.
function onHashChange() {
  if (window.location.hash === shownHash) return;
  shownHash = window.location.hash;
  urlState.value = readQueryState();
  formKey.value++;
  void applyUrlState();
}

onMounted(() => {
  window.addEventListener('hashchange', onHashChange);
  void applyUrlState();
});

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', onHashChange);
  abortController?.abort();
});

function stopQuery() {
  abortController?.abort();
}

function toggle(set: Set<string>, key: string) {
  if (!set.delete(key)) set.add(key);
}

function handleExport() {
  // A failed instance has no results to export; list it separately rather than
  // writing null for every CURIE, which would read as "not found".
  const answered = queriedInstances.value.filter((i) => resultsByInstance.value.has(i.url));
  const data: Record<string, Record<string, NormalizedNode | null>> = {};
  for (const curie of queriedCuries.value) {
    data[curie] = {};
    for (const inst of answered) {
      data[curie][inst.name] = resultsByInstance.value.get(inst.url)![curie] ?? null;
    }
  }
  const payload = {
    queried_curies: queriedCuries.value,
    instances: answered.map((i) => i.name),
    failed_instances: queriedInstances.value.filter((i) => !answered.includes(i)).map((i) => i.name),
    results: data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nodenorm.json';
  // Firefox ignores click() on a detached anchor, and Firefox and Safari read the blob
  // after click() returns, so revoking it at once can cancel the download. 40 s is the
  // delay FileSaver.js settled on.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 40_000);
}

function onFormSubmit(payload: { curies: string; instanceUrls: string[]; options: ApiOptions }) {
  ignoredTargets.value = [];
  void handleSubmit(payload);
}

async function handleSubmit(payload: { curies: string; instanceUrls: string[]; options: ApiOptions }) {
  const curies = parseCuries(payload.curies);
  if (curies.length === 0) {
    error.value = 'No valid CURIEs provided.';
    return;
  }

  abortController?.abort();
  const controller = new AbortController();
  abortController = controller;
  const { signal } = controller;

  loading.value = true;
  error.value = null;
  notice.value = null;

  try {
    // Fetch from all selected instances in parallel (handles single instance too)
    const settled = await Promise.allSettled(
      payload.instanceUrls.map((url) =>
        fetchNormalizedNodes(url, curies, payload.options, signal),
      ),
    );

    // A newer query replaced this one; it owns the page now.
    if (abortController !== controller) return;

    // Stopped: leave the previous query's results, and the URL that describes them,
    // in place rather than a blank page or a comparison missing some instances.
    if (signal.aborted) {
      notice.value = hasResults.value
        ? 'Query stopped. Showing the results of the previous query.'
        : 'Query stopped.';
      return;
    }

    const resultMap = new Map<string, NodeNormResponse>();
    const errors: string[] = [];

    for (let i = 0; i < payload.instanceUrls.length; i++) {
      const result = settled[i];
      const url = payload.instanceUrls[i];
      if (result.status === 'fulfilled') {
        resultMap.set(url, result.value);
      } else {
        errors.push(`${instanceForUrl(instances, url).name}: ${result.reason}`);
      }
    }

    resultsByInstance.value = resultMap;
    queriedCuries.value = curies;
    queriedOptions.value = payload.options;
    queriedInstances.value = payload.instanceUrls.map((url) => instanceForUrl(instances, url));
    typeFilter.clear();

    if (errors.length > 0) {
      error.value = `Some instances failed: ${errors.join('; ')}`;
    }

    // Update URL to reflect the submitted query. replaceState fires no hashchange.
    const targets = payload.instanceUrls.map((url) => urlToTarget(instances, url));
    const queryUrl = buildQueryUrl(curies, targets, payload.options);
    shownHash = queryUrl.includes('#') ? queryUrl.slice(queryUrl.indexOf('#')) : '';
    window.history.replaceState(null, '', queryUrl);
  } finally {
    if (abortController === controller) {
      abortController = null;
      loading.value = false;
    }
  }
}
</script>

<template>
  <div class="card mb-4">
    <div class="card-header">Query</div>
    <div class="card-body">
      <NodeNormForm
        :key="formKey"
        :instances="instances"
        :loading="loading"
        :has-results="hasResults"
        :initial-curies="urlState.curies.join('\n') || undefined"
        :initial-targets="urlState.targets"
        :initial-options="urlState.options"
        @submit="onFormSubmit"
        @stop="stopQuery"
      />
    </div>
  </div>

  <div v-if="ignoredTargets.length" class="alert alert-warning">
    Ignored {{ ignoredTargets.length === 1 ? 'a target' : 'targets' }} in the link that
    {{ ignoredTargets.length === 1 ? 'is' : 'are' }} neither a known instance nor an http(s)
    URL: {{ ignoredTargets.join(', ') }}
  </div>
  <div v-if="error" class="alert alert-danger">{{ error }}</div>
  <div v-if="notice" class="alert alert-secondary">{{ notice }}</div>

  <div v-if="hasResults" class="card">
    <div class="card-header d-flex align-items-center justify-content-between flex-wrap gap-2">
      <span>
        Results — {{ queriedCuries.length }} CURIE{{ queriedCuries.length !== 1 ? 's' : '' }},
        {{ queriedInstances.length }} instance{{ queriedInstances.length !== 1 ? 's' : '' }}
      </span>
      <ColumnVisibility :visible-columns="visibleColumns" @toggle="toggle(visibleColumns, $event)" />
    </div>
    <div class="card-body">
      <ResultsSummary
        :results-by-instance="resultsByInstance"
        :queried-instances="queriedInstances"
        :curies="queriedCuries"
        :selected-types="typeFilter"
        @toggle-type-filter="toggle(typeFilter, $event)"
        @clear-type-filter="typeFilter.clear()"
      />
      <ComparisonView
        :results-by-instance="resultsByInstance"
        :queried-instances="queriedInstances"
        :curies="queriedCuries"
        :visible-columns="visibleColumns"
        :type-filter="typeFilter"
        :api-options="queriedOptions"
      />
    </div>
    <div class="card-footer">
      <button type="button" class="btn btn-sm btn-outline-secondary" @click="handleExport">
        Download JSON
      </button>
    </div>
  </div>
</template>
