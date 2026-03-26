<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import type { NodeNormResponse, NodeNormInstance, ApiOptions } from '../../lib/types';
import { fetchNormalizedNodes, parseCuries } from '../../lib/nodenorm-api';
import { loadPrefixMap } from '../../lib/curie-links';
import NodeNormForm from './NodeNormForm.vue';
import NodeNormResults from './NodeNormResults.vue';
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
const loading = ref(false);
const error = ref<string | null>(null);
const results = ref<NodeNormResponse | null>(null);
const queriedCuries = ref<string[]>([]);
const visibleColumns = reactive(new Set(['type']));
const prefixMap = ref<Record<string, string>>({});

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

async function handleSubmit(payload: { curies: string; instanceUrl: string; options: ApiOptions }) {
  const curies = parseCuries(payload.curies);
  if (curies.length === 0) {
    error.value = 'No valid CURIEs provided.';
    return;
  }

  loading.value = true;
  error.value = null;
  results.value = null;
  queriedCuries.value = curies;

  try {
    results.value = await fetchNormalizedNodes(payload.instanceUrl, curies, payload.options);
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
    @submit="handleSubmit"
  />

  <div v-if="error" class="alert alert-danger mt-3">{{ error }}</div>

  <div v-if="results" class="mt-4">
    <h5 class="mb-3">
      Results ({{ queriedCuries.length }} CURIE{{ queriedCuries.length !== 1 ? 's' : '' }})
    </h5>
    <NodeNormResults
      :results="results"
      :curies="queriedCuries"
      :visible-columns="visibleColumns"
      :prefix-map="prefixMap"
      @toggle-column="toggleColumn"
    />
  </div>
</template>
