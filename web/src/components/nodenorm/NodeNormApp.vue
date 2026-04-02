<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import type { NormalizedNode, NodeNormResponse, NodeNormInstance, ApiOptions } from '../../lib/types';
import { DEFAULT_API_OPTIONS } from '../../lib/types';
import { fetchNormalizedNodes, parseCuries } from '../../lib/nodenorm-api';
import { loadPrefixMap } from '../../lib/curie-links';
import { readQueryState, buildQueryUrl } from '../../lib/url-state';
import NodeNormForm from './NodeNormForm.vue';
import ComparisonView from './ComparisonView.vue';
import ResultsSummary from './ResultsSummary.vue';
import ColumnVisibility from './ColumnVisibility.vue';
import endpoints from '../../../../config/translator-endpoints.json';

// Build instance list from shared config
const ENV_LABELS: Record<string, string> = {
  dev: 'Dev',
  exp: 'Exp',
  ci: 'CI',
  test: 'Test',
  prod: 'Production',
};

const instances: NodeNormInstance[] = Object.entries(endpoints.nodenorm).map(
  ([env, url]) => ({
    name: `NodeNorm ${ENV_LABELS[env] ?? env}`,
    env,
    url: url as string,
  }),
);

/** Resolve a target (env key or full URL) to an instance URL. */
function resolveTarget(target: string): string {
  return instances.find((i) => i.env === target || i.url === target)?.url ?? target;
}

/** Convert instance URLs back to env keys (or full URL if custom) for the URL bar. */
function urlsToTargets(urls: string[]): string[] {
  return urls.map((url) => instances.find((i) => i.url === url)?.env ?? url);
}

// State
const loading = ref(false);
const error = ref<string | null>(null);
const queriedCuries = ref<string[]>([]);
const visibleColumns = reactive(new Set(['type', 'taxa']));
const prefixMap = ref<Record<string, string>>({});

// Read URL state synchronously so NodeNormForm receives correct initial values
// on its first render (before onMounted fires).
const urlState = typeof window !== 'undefined' ? readQueryState() : null;
const initialCuries = ref<string | undefined>(
  urlState?.curies.length ? urlState.curies.join('\n') : undefined,
);
const initialTargets = ref<string[] | undefined>(
  urlState?.targets.length ? urlState.targets : undefined,
);
const initialOptions = ref<Partial<ApiOptions> | undefined>(
  urlState?.options && Object.keys(urlState.options).length ? urlState.options : undefined,
);

// Results keyed by instance URL
const resultsByInstance = ref<Map<string, NodeNormResponse>>(new Map());
const queriedInstances = ref<NodeNormInstance[]>([]);
const hasResults = computed(() => resultsByInstance.value.size > 0);
const typeFilter = ref(new Set<string>());

// Abort controller for in-flight requests
let abortController: AbortController | null = null;

onMounted(async () => {
  prefixMap.value = await loadPrefixMap();

  if (urlState?.curies.length) {
    const instanceUrls = urlState.targets.length > 0
      ? urlState.targets.map(resolveTarget)
      : [instances[0].url];
    await handleSubmit({
      curies: urlState.curies.join('\n'),
      instanceUrls,
      options: { ...DEFAULT_API_OPTIONS, ...urlState.options },
    });
  }
});

function stopQuery() {
  abortController?.abort();
}

function toggleColumn(col: string) {
  if (visibleColumns.has(col)) {
    visibleColumns.delete(col);
  } else {
    visibleColumns.add(col);
  }
}

function toggleTypeFilter(type: string) {
  const next = new Set(typeFilter.value);
  if (next.has(type)) next.delete(type); else next.add(type);
  typeFilter.value = next;
}

function clearTypeFilter() { typeFilter.value = new Set(); }

async function handleShare() {
  await navigator.clipboard.writeText(window.location.href);
}

function handleExport() {
  const data: Record<string, Record<string, NormalizedNode | null>> = {};
  for (const curie of queriedCuries.value) {
    data[curie] = {};
    for (const inst of queriedInstances.value) {
      data[curie][inst.name] = resultsByInstance.value.get(inst.url)?.[curie] ?? null;
    }
  }
  const payload = {
    queried_curies: queriedCuries.value,
    instances: queriedInstances.value.map((i) => i.name),
    results: data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nodenorm.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function handleSubmit(payload: { curies: string; instanceUrls: string[]; options: ApiOptions }) {
  const curies = parseCuries(payload.curies);
  if (curies.length === 0) {
    error.value = 'No valid CURIEs provided.';
    return;
  }

  abortController = new AbortController();
  const { signal } = abortController;

  loading.value = true;
  error.value = null;
  resultsByInstance.value = new Map();
  queriedCuries.value = curies;
  typeFilter.value = new Set();

  try {
    // Fetch from all selected instances in parallel (handles single instance too)
    const settled = await Promise.allSettled(
      payload.instanceUrls.map((url) =>
        fetchNormalizedNodes(url, curies, payload.options, signal),
      ),
    );

    const resultMap = new Map<string, NodeNormResponse>();
    const errors: string[] = [];

    for (let i = 0; i < payload.instanceUrls.length; i++) {
      const result = settled[i];
      const url = payload.instanceUrls[i];
      if (result.status === 'fulfilled') {
        resultMap.set(url, result.value);
      } else {
        if ((result.reason as Error)?.name !== 'AbortError') {
          const inst = instances.find((inst) => inst.url === url);
          errors.push(`${inst?.name ?? url}: ${result.reason}`);
        }
      }
    }

    resultsByInstance.value = resultMap;
    queriedInstances.value = payload.instanceUrls
      .map((url) => instances.find((inst) => inst.url === url) ?? { name: url, env: url, url })
      .filter((inst): inst is NodeNormInstance => inst != null);

    if (errors.length > 0) {
      error.value = `Some instances failed: ${errors.join('; ')}`;
    }

    // Update URL to reflect the submitted query (only if not aborted)
    if (!signal.aborted) {
      const targets = urlsToTargets(payload.instanceUrls);
      window.history.replaceState(null, '', buildQueryUrl(curies, targets, payload.options));
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      // User clicked Stop — clear loading silently
    } else {
      error.value = e instanceof Error ? e.message : String(e);
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="card mb-4">
    <div class="card-header">Query</div>
    <div class="card-body">
      <NodeNormForm
        :instances="instances"
        :loading="loading"
        :has-results="hasResults"
        :initial-curies="initialCuries"
        :initial-targets="initialTargets"
        :initial-options="initialOptions"
        @submit="handleSubmit"
        @stop="stopQuery"
        @share="handleShare"
      />
    </div>
  </div>

  <div v-if="error" class="alert alert-danger">{{ error }}</div>

  <div v-if="resultsByInstance.size > 0" class="card">
    <div class="card-header d-flex align-items-center justify-content-between flex-wrap gap-2">
      <span>
        Results — {{ queriedCuries.length }} CURIE{{ queriedCuries.length !== 1 ? 's' : '' }},
        {{ queriedInstances.length }} instance{{ queriedInstances.length !== 1 ? 's' : '' }}
      </span>
      <ColumnVisibility :visible-columns="visibleColumns" @toggle="toggleColumn" />
    </div>
    <div class="card-body">
      <ResultsSummary
        :results-by-instance="resultsByInstance"
        :queried-instances="queriedInstances"
        :curies="queriedCuries"
        :selected-types="typeFilter"
        @toggle-type-filter="toggleTypeFilter"
        @clear-type-filter="clearTypeFilter"
      />
      <ComparisonView
        :results-by-instance="resultsByInstance"
        :queried-instances="queriedInstances"
        :curies="queriedCuries"
        :visible-columns="visibleColumns"
        :prefix-map="prefixMap"
        :type-filter="typeFilter"
      />
    </div>
    <div class="card-footer">
      <button type="button" class="btn btn-sm btn-outline-secondary" @click="handleExport">
        Download JSON
      </button>
    </div>
  </div>
</template>
