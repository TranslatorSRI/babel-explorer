<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import type { NodeNormResponse, NodeNormInstance, ApiOptions } from '../../lib/types';
import { fetchNormalizedNodes, parseCuries } from '../../lib/nodenorm-api';
import { loadPrefixMap } from '../../lib/curie-links';
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

// State
const mode = ref<'single' | 'compare'>('single');
const loading = ref(false);
const error = ref<string | null>(null);
const queriedCuries = ref<string[]>([]);
const visibleColumns = reactive(new Set(['type']));
const prefixMap = ref<Record<string, string>>({});

// Single-instance results
const singleResults = ref<NodeNormResponse | null>(null);

// Multi-instance comparison results
const comparisonResults = ref<Map<string, NodeNormResponse>>(new Map());
const comparisonInstances = ref<NodeNormInstance[]>([]);

onMounted(async () => {
  prefixMap.value = await loadPrefixMap();
});

function toggleColumn(col: string) {
  if (visibleColumns.has(col)) {
    visibleColumns.delete(col);
  } else {
    visibleColumns.add(col);
  }
}

async function handleSubmit(payload: { curies: string; instanceUrls: string[]; options: ApiOptions }) {
  const curies = parseCuries(payload.curies);
  if (curies.length === 0) {
    error.value = 'No valid CURIEs provided.';
    return;
  }

  loading.value = true;
  error.value = null;
  singleResults.value = null;
  comparisonResults.value = new Map();
  queriedCuries.value = curies;

  try {
    if (mode.value === 'single') {
      singleResults.value = await fetchNormalizedNodes(payload.instanceUrls[0], curies, payload.options);
    } else {
      // Compare mode: fetch from all selected instances in parallel
      const settled = await Promise.allSettled(
        payload.instanceUrls.map((url) => fetchNormalizedNodes(url, curies, payload.options)),
      );

      const resultMap = new Map<string, NodeNormResponse>();
      const errors: string[] = [];

      for (let i = 0; i < payload.instanceUrls.length; i++) {
        const result = settled[i];
        const url = payload.instanceUrls[i];
        if (result.status === 'fulfilled') {
          resultMap.set(url, result.value);
        } else {
          const inst = instances.find((inst) => inst.url === url);
          errors.push(`${inst?.name ?? url}: ${result.reason}`);
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
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
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
    @submit="handleSubmit"
    @update:mode="mode = $event"
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
