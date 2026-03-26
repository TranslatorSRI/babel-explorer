<script setup lang="ts">
import { computed } from 'vue';
import type { NodeNormResponse } from '../../lib/types';

const props = defineProps<{
  results: NodeNormResponse;
  curies: string[];
}>();

const normalized = computed(() =>
  props.curies.filter((c) => props.results[c] != null),
);
const notFound = computed(() =>
  props.curies.filter((c) => props.results[c] == null),
);

/** Aggregate biolink type counts across all results. */
const typeCounts = computed(() => {
  const counts: Record<string, number> = {};
  for (const curie of normalized.value) {
    const node = props.results[curie];
    if (!node) continue;
    for (const t of node.type) {
      counts[t] = (counts[t] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1]);
});

/** Find types shared by ALL normalized results. */
const sharedTypes = computed(() =>
  typeCounts.value
    .filter(([, count]) => count === normalized.value.length)
    .map(([type]) => type),
);
</script>

<template>
  <div class="card mb-3">
    <div class="card-body">
      <div class="d-flex flex-wrap gap-3 align-items-start">
        <div>
          <strong>{{ normalized.length }}</strong> of <strong>{{ curies.length }}</strong> CURIE{{ curies.length !== 1 ? 's' : '' }} normalized
          <span v-if="notFound.length > 0" class="text-danger ms-2">
            ({{ notFound.length }} not found: {{ notFound.join(', ') }})
          </span>
        </div>
      </div>

      <div v-if="sharedTypes.length > 0" class="mt-2">
        <span class="text-muted">All are:</span>
        <span v-for="t in sharedTypes" :key="t" class="badge bg-info text-dark ms-1">
          {{ t.replace('biolink:', '') }}
        </span>
      </div>

      <div v-if="typeCounts.length > 0" class="mt-2">
        <span class="text-muted">Type breakdown:</span>
        <span v-for="[type, count] in typeCounts" :key="type" class="ms-2 small">
          {{ type.replace('biolink:', '') }}: {{ count }}
        </span>
      </div>
    </div>
  </div>
</template>
