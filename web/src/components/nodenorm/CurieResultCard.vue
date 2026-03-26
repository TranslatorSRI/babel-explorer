<script setup lang="ts">
import { ref, computed } from 'vue';
import type { NormalizedNode } from '../../lib/types';
import CurieLink from '../shared/CurieLink.vue';
import EquivalentIdTable from './EquivalentIdTable.vue';

const EXPAND_THRESHOLD = 10;

const props = defineProps<{
  inputCurie: string;
  node: NormalizedNode | null;
  index: number;
  visibleColumns: Set<string>;
  prefixMap: Record<string, string>;
}>();

const expanded = ref(false);
const accordionId = computed(() => `curie-${props.index}`);

const equivIds = computed(() => props.node?.equivalent_identifiers ?? []);
const isLargeClique = computed(() => equivIds.value.length > EXPAND_THRESHOLD);
const showTable = computed(() => !isLargeClique.value || expanded.value);

/** Summarize equivalent IDs by prefix count. e.g. "MONDO: 2, UMLS: 5" */
const prefixSummary = computed(() => {
  const counts: Record<string, number> = {};
  for (const id of equivIds.value) {
    const idx = id.identifier.indexOf(':');
    const prefix = idx > 0 ? id.identifier.substring(0, idx) : '(unknown)';
    counts[prefix] = (counts[prefix] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([prefix, count]) => `${prefix}: ${count}`)
    .join(', ');
});
</script>

<template>
  <div class="accordion-item">
    <h2 class="accordion-header">
      <button
        class="accordion-button collapsed"
        type="button"
        data-bs-toggle="collapse"
        :data-bs-target="`#collapse-${accordionId}`"
      >
        <span v-if="node">
          <strong>
            <CurieLink :curie="node.id.identifier" :prefix-map="prefixMap" />
          </strong>
          <span v-if="node.id.label" class="ms-2 text-muted">{{ node.id.label }}</span>
          <span class="ms-2">
            <span
              v-for="t in node.type.slice(0, 2)"
              :key="t"
              class="badge bg-info text-dark me-1"
            >{{ t.replace('biolink:', '') }}</span>
            <span v-if="node.type.length > 2" class="badge bg-secondary">+{{ node.type.length - 2 }}</span>
          </span>
          <span class="ms-2 text-muted small">
            {{ equivIds.length }} equiv. ID{{ equivIds.length !== 1 ? 's' : '' }}
          </span>
        </span>
        <span v-else class="text-danger">
          <strong>{{ inputCurie }}</strong> — not found
        </span>
      </button>
    </h2>
    <div :id="`collapse-${accordionId}`" class="accordion-collapse collapse">
      <div class="accordion-body">
        <template v-if="node">
          <!-- Top-level summary -->
          <div class="mb-3">
            <div v-if="node.descriptions && node.descriptions.length > 0" class="mb-2">
              <strong>Description:</strong> {{ node.descriptions[0] }}
            </div>
            <div class="mb-1">
              <strong>Types:</strong>
              <span v-for="t in node.type" :key="t" class="badge bg-info text-dark me-1">
                {{ t.replace('biolink:', '') }}
              </span>
            </div>
            <div v-if="node.information_content" class="mb-1">
              <strong>Information Content:</strong> {{ node.information_content.toFixed(1) }}
            </div>
          </div>

          <!-- Equivalent identifiers -->
          <h6>Equivalent Identifiers ({{ equivIds.length }})</h6>

          <template v-if="isLargeClique && !expanded">
            <p class="text-muted small mb-2">{{ prefixSummary }}</p>
            <button class="btn btn-sm btn-outline-primary" @click="expanded = true">
              Show all {{ equivIds.length }} identifiers
            </button>
          </template>

          <template v-if="showTable">
            <button
              v-if="isLargeClique"
              class="btn btn-sm btn-outline-secondary mb-2"
              @click="expanded = false"
            >
              Collapse
            </button>
            <EquivalentIdTable
              :identifiers="equivIds"
              :visible-columns="visibleColumns"
              :prefix-map="prefixMap"
            />
          </template>
        </template>
        <template v-else>
          <p class="text-muted">This CURIE was not found in NodeNorm.</p>
        </template>
      </div>
    </div>
  </div>
</template>
