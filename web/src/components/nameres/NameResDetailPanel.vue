<script setup lang="ts">
import { ref } from 'vue';
import type { NameResResult } from '../../lib/nameres-types';
import BiolinkTypeLink from '../shared/BiolinkTypeLink.vue';
import CurieLink from '../shared/CurieLink.vue';

const props = defineProps<{
  results: NameResResult[];
  expectedCuries: string[];
  prefixMap: Record<string, string>;
}>();

const modalResult = ref<NameResResult | null>(null);

function isExpected(curie: string): boolean {
  return props.expectedCuries.includes(curie);
}

function showFullResponse(result: NameResResult) {
  modalResult.value = result;
}

function closeModal() {
  modalResult.value = null;
}
</script>

<template>
  <template v-if="results.length > 0">
    <div class="table-responsive">
      <table class="table table-sm table-striped mb-0">
        <thead>
          <tr>
            <th style="width: 2rem">#</th>
            <th>CURIE</th>
            <th>Label</th>
            <th>Types</th>
            <th style="width: 5rem">Score</th>
            <th style="width: 4rem"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(r, i) in results"
            :key="r.curie"
            :class="isExpected(r.curie) ? 'table-info' : ''"
          >
            <td>{{ i + 1 }}</td>
            <td>
              <CurieLink :curie="r.curie" :prefix-map="prefixMap" />
              <span v-if="isExpected(r.curie)" class="badge bg-success ms-1" style="font-size: 0.65em">expected</span>
            </td>
            <td>{{ r.label }}</td>
            <td>
              <span
                v-for="t in r.types"
                :key="t"
                class="badge bg-info text-dark me-1"
                style="font-size: 0.7em"
              ><BiolinkTypeLink :type="t" /></span>
            </td>
            <td>{{ r.score.toFixed(1) }}</td>
            <td>
              <button
                type="button"
                class="btn btn-sm btn-outline-secondary py-0 px-1"
                style="font-size: 0.75em"
                title="View full response JSON"
                @click="showFullResponse(r)"
              >JSON</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
  <template v-else>
    <p class="text-muted mb-0">No results found.</p>
  </template>

  <!-- Full response modal (Bootstrap 5) -->
  <Teleport to="body">
    <div
      v-if="modalResult"
      class="modal d-block"
      tabindex="-1"
      style="background: rgba(0,0,0,0.5)"
      @click.self="closeModal"
    >
      <div class="modal-dialog modal-lg modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Full Response — {{ modalResult.curie }}</h5>
            <button type="button" class="btn-close" @click="closeModal"></button>
          </div>
          <div class="modal-body">
            <pre class="mb-0" style="white-space: pre-wrap; word-break: break-all">{{ JSON.stringify(modalResult, null, 2) }}</pre>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
