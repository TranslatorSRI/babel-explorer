<script setup lang="ts">
import type { NodeNormResponse } from '../../lib/types';
import SummaryCard from './SummaryCard.vue';
import CurieResultCard from './CurieResultCard.vue';
import ColumnVisibility from './ColumnVisibility.vue';

defineProps<{
  results: NodeNormResponse;
  curies: string[];
  visibleColumns: Set<string>;
  prefixMap: Record<string, string>;
}>();

const emit = defineEmits<{
  toggleColumn: [column: string];
}>();
</script>

<template>
  <div>
    <SummaryCard :results="results" :curies="curies" />
    <ColumnVisibility :visible-columns="visibleColumns" @toggle="emit('toggleColumn', $event)" />

    <div class="accordion" id="results-accordion">
      <CurieResultCard
        v-for="(curie, idx) in curies"
        :key="curie"
        :input-curie="curie"
        :node="results[curie] ?? null"
        :index="idx"
        :visible-columns="visibleColumns"
        :prefix-map="prefixMap"
      />
    </div>
  </div>
</template>
