<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import type { NodeNormResponse, NodeNormInstance, ApiOptions } from '../../lib/types';
import { DEFAULT_API_OPTIONS } from '../../lib/types';
import { fetchNormalizedNodes, parseCuries } from '../../lib/nodenorm-api';
import { loadPrefixMap } from '../../lib/curie-links';
import { readQueryState, buildQueryUrl } from '../../lib/url-state';
import NodeNormForm from './NodeNormForm.vue';
import NodeNormResults from './NodeNormResults.vue';
import ComparisonView from './ComparisonView.vue';
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
const mode = ref<'single' | 'compare'>('single');
const loading = ref(false);
const error = ref<string | null>(null);
const queriedCuries = ref<string[]>([]);
const hasResults = ref(false);
const visibleColumns = reactive(new Set(['type']));
const prefixMap = ref<Record<string, string>>({});

// Initial values from URL (passed down to NodeNormForm)
const initialCuries = ref<string | undefined>(undefined);
const initialTargets = ref<string[] | undefined>(undefined);
const initialOptions = ref<Partial<ApiOptions> | undefined>(undefined);

// Single-instance results
const singleResults = ref<NodeNormResponse | null>(null);

// Multi-instance comparison results
const comparisonResults = ref<Map<string, NodeNormResponse>>(new Map());
const comparisonInstances = ref<NodeNormInstance[]>([]);

// Abort controller for in-flight requests
let abortController: AbortController | null = null;

onMounted(async () => {
  prefixMap.value = await loadPrefixMap();

  const state = readQueryState();
  if (state.curies.length > 0) {
    initialCuries.value = state.curies.join('\n');
    initialTargets.value = state.targets;
    initialOptions.value = state.options;

    // Infer mode from target count
    if (state.targets.length > 1) mode.value = 'compare';

    // Auto-submit the query encoded in the URL
    const instanceUrls = state.targets.length > 0
      ? state.targets.map(resolveTarget)
      : [instances[0].url];
    await handleSubmit({
      curies: initialCuries.value,
      instanceUrls,
      options: { ...DEFAULT_API_OPTIONS, ...state.options },
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

async function handleShare() {
  await navigator.clipboard.writeText(window.location.href);
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
  singleResults.value = null;
  comparisonResults.value = new Map();
  queriedCuries.value = curies;

  try {
    if (mode.value === 'single') {
      singleResults.value = await fetchNormalizedNodes(
        payload.instanceUrls[0], curies, payload.options, signal,
      );
    } else {
      // Compare mode: fetch from all selected instances in parallel
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
          // Don't report abort errors — user clicked Stop intentionally
          if ((result.reason as Error)?.name !== 'AbortError') {
            const inst = instances.find((inst) => inst.url === url);
            errors.push(`${inst?.name ?? url}: ${result.reason}`);
          }
        }
      }

      comparisonResults.value = resultMap;
      comparisonInstances.value = payload.instanceUrls
        .map((url) => instances.find((inst) => inst.url === url))
        .filter((inst): inst is NodeNormInstance => inst != null);

      if (errors.length > 0) {
        error.value = `Some instances failed: ${errors.join('; ')}`;
      }
    }

    // Update URL to reflect the submitted query (only if not aborted)
    if (!signal.aborted) {
      const targets = urlsToTargets(payload.instanceUrls);
      window.history.replaceState(null, '', buildQueryUrl(curies, targets, payload.options));
      hasResults.value = true;
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
  <NodeNormForm
    :instances="instances"
    :loading="loading"
    :mode="mode"
    :has-results="hasResults"
    :initial-curies="initialCuries"
    :initial-targets="initialTargets"
    :initial-options="initialOptions"
    @submit="handleSubmit"
    @update:mode="mode = $event"
    @stop="stopQuery"
    @share="handleShare"
  />

  <div v-if="error" class="alert alert-danger mt-3">{{ error }}</div>

  <!-- Single instance results -->
  <div v-if="singleResults && mode === 'single'" class="mt-4">
    <h5 class="mb-3">
      Results ({{ queriedCuries.length }} CURIE{{ queriedCuries.length !== 1 ? 's' : '' }})
    </h5>
    <NodeNormResults
      :results="singleResults"
      :curies="queriedCuries"
      :visible-columns="visibleColumns"
      :prefix-map="prefixMap"
      @toggle-column="toggleColumn"
    />
  </div>

  <!-- Comparison results -->
  <div v-if="comparisonResults.size > 0 && mode === 'compare'" class="mt-4">
    <h5 class="mb-3">
      Comparison ({{ queriedCuries.length }} CURIE{{ queriedCuries.length !== 1 ? 's' : '' }}
      across {{ comparisonInstances.length }} instance{{ comparisonInstances.length !== 1 ? 's' : '' }})
    </h5>
    <ComparisonView
      :results-by-instance="comparisonResults"
      :queried-instances="comparisonInstances"
      :curies="queriedCuries"
      :prefix-map="prefixMap"
    />
  </div>
</template>
