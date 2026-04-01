<script setup lang="ts">
import { computed } from 'vue';
import type { NodeNormResponse, NodeNormInstance } from '../../lib/types';

const props = defineProps<{
  resultsByInstance: Map<string, NodeNormResponse>;
  queriedInstances: NodeNormInstance[];
  curies: string[];
  selectedTypes: Set<string>;
}>();

const emit = defineEmits<{
  'toggle-type-filter': [type: string];
  'clear-type-filter': [];
}>();

// ── Helpers ──────────────────────────────────────────────────────────────────

/** CURIEs found (non-null) by every queried instance. */
const normalizedByAll = computed(() =>
  props.curies.filter((c) =>
    props.queriedInstances.every((inst) => {
      const resp = props.resultsByInstance.get(inst.url);
      return resp != null && resp[c] != null;
    }),
  ),
);

/** CURIEs not found by any instance. */
const notFoundByAny = computed(() =>
  props.curies.filter((c) =>
    props.queriedInstances.every((inst) => {
      const resp = props.resultsByInstance.get(inst.url);
      return resp == null || resp[c] == null;
    }),
  ),
);

/** CURIEs found by at least one instance but not all (partial hits). */
const partiallyFound = computed(() =>
  props.curies.filter(
    (c) => !normalizedByAll.value.includes(c) && !notFoundByAny.value.includes(c),
  ),
);

/**
 * CURIEs where instances disagree on the preferred ID.
 * Only relevant when 2+ instances are queried.
 */
const disagreements = computed(() => {
  if (props.queriedInstances.length < 2) return [];
  return props.curies.filter((c) => {
    const ids = new Set<string>();
    for (const inst of props.queriedInstances) {
      const resp = props.resultsByInstance.get(inst.url);
      ids.add(resp?.[c]?.id?.identifier ?? '(not found)');
    }
    return ids.size > 1;
  });
});

/**
 * Biolink types seen across all results, using the most-specific type (type[0])
 * per CURIE. Counts distinct CURIEs per type (not occurrences).
 * Returns array of [displayName, count] pairs sorted by count descending.
 */
const typeCounts = computed((): [string, number][] => {
  const curiesByType = new Map<string, Set<string>>();
  for (const curie of props.curies) {
    for (const inst of props.queriedInstances) {
      const t = props.resultsByInstance.get(inst.url)?.[curie]?.type?.[0];
      if (!t) continue;
      const label = t.replace('biolink:', '');
      if (!curiesByType.has(label)) curiesByType.set(label, new Set());
      curiesByType.get(label)!.add(curie);
      break; // one type per CURIE — take the first instance that finds it
    }
  }
  return [...curiesByType.entries()]
    .map(([type, set]) => [type, set.size] as [string, number])
    .sort((a, b) => b[1] - a[1]);
});

// ── Display helpers ───────────────────────────────────────────────────────────

const NOT_FOUND_INLINE_LIMIT = 3;

function formatCurieList(curies: string[]): string {
  if (curies.length <= NOT_FOUND_INLINE_LIMIT) return curies.join(', ');
  return `${curies.slice(0, NOT_FOUND_INLINE_LIMIT).join(', ')} +${curies.length - NOT_FOUND_INLINE_LIMIT} more`;
}
</script>

<template>
  <div class="d-flex flex-wrap gap-3 mb-3">

    <!-- Normalized tile -->
    <div class="card flex-fill" style="min-width: 160px">
      <div class="card-body py-2 px-3">
        <div class="text-muted small mb-1">Normalized</div>
        <div class="fs-5 fw-semibold">
          {{ normalizedByAll.length }}
          <span class="fs-6 fw-normal text-muted">/ {{ curies.length }}</span>
        </div>
        <div v-if="partiallyFound.length > 0" class="text-warning small mt-1">
          {{ partiallyFound.length }} partial
          <span class="text-muted">({{ formatCurieList(partiallyFound) }})</span>
        </div>
        <div v-if="notFoundByAny.length > 0" class="text-danger small mt-1">
          {{ notFoundByAny.length }} not found
          <span class="text-muted">({{ formatCurieList(notFoundByAny) }})</span>
        </div>
      </div>
    </div>

    <!-- Disagreements tile — only shown when 2+ instances queried -->
    <div v-if="queriedInstances.length > 1" class="card flex-fill" style="min-width: 160px">
      <div class="card-body py-2 px-3">
        <div class="text-muted small mb-1">Disagreements</div>
        <div
          class="fs-5 fw-semibold"
          :class="disagreements.length > 0 ? 'text-warning' : 'text-success'"
        >
          {{ disagreements.length }}
        </div>
        <div v-if="disagreements.length > 0" class="text-muted small mt-1">
          {{ formatCurieList(disagreements) }}
        </div>
        <div v-else class="text-muted small mt-1">All instances agree</div>
      </div>
    </div>

    <!-- Types tile -->
    <div v-if="typeCounts.length > 0" class="card flex-fill" style="min-width: 200px">
      <div class="card-body py-2 px-3">
        <div class="d-flex align-items-center gap-2 mb-1">
          <span class="text-muted small">Types</span>
          <button
            v-if="selectedTypes.size > 0"
            type="button"
            class="btn btn-link btn-sm p-0 text-muted small"
            @click="emit('clear-type-filter')"
          >clear</button>
        </div>
        <div class="d-flex flex-wrap gap-1 mt-1">
          <button
            v-for="[type, count] in typeCounts"
            :key="type"
            type="button"
            :class="['btn', 'btn-sm', selectedTypes.has(type) ? 'btn-secondary' : 'btn-outline-secondary']"
            :title="`Filter results to ${type}`"
            @click="emit('toggle-type-filter', type)"
          >{{ type }} <span class="badge bg-light text-dark">{{ count }}</span></button>
        </div>
      </div>
    </div>

  </div>
</template>
