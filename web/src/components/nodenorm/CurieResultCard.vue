<script setup lang="ts">
import { computed } from 'vue';
import type { NormalizedNode } from '../../lib/types';
import CurieLink from '../shared/CurieLink.vue';
import CurieDetailPanel from './CurieDetailPanel.vue';

const props = defineProps<{
  inputCurie: string;
  node: NormalizedNode | null;
  index: number;
  visibleColumns: Set<string>;
  prefixMap: Record<string, string>;
}>();

const accordionId = computed(() => `curie-${props.index}`);
const equivIds = computed(() => props.node?.equivalent_identifiers ?? []);
const uniqueTaxa = computed(() => {
  const all = props.node?.equivalent_identifiers.flatMap(id => id.taxa ?? []) ?? [];
  return [...new Set(all)];
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
          <span v-if="visibleColumns.has('taxa') && uniqueTaxa.length > 0" class="ms-2 text-muted small">
            {{ uniqueTaxa.join(', ') }}
          </span>
          <span class="ms-2 text-muted small">
            {{ equivIds.length }} equivalent ID{{ equivIds.length !== 1 ? 's' : '' }}
          </span>
        </span>
        <span v-else class="text-danger">
          <strong>{{ inputCurie }}</strong> — not found
        </span>
      </button>
    </h2>
    <div :id="`collapse-${accordionId}`" class="accordion-collapse collapse">
      <div class="accordion-body">
        <CurieDetailPanel
          :node="node"
          :visible-columns="visibleColumns"
          :prefix-map="prefixMap"
        />
      </div>
    </div>
  </div>
</template>
