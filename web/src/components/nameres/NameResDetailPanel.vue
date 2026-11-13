<script setup lang="ts">
import { ref, nextTick, useId } from 'vue';
import type { NameResResult } from '../../lib/nameres-types';
import BiolinkTypeLink from '../shared/BiolinkTypeLink.vue';
import CurieLink from '../shared/CurieLink.vue';

const props = defineProps<{
  results: NameResResult[];
  expectedCuries: string[];
}>();

const modalResult = ref<NameResResult | null>(null);
const dialog = ref<HTMLDialogElement | null>(null);
// Several panels are on the page at once (one per instance per expanded row).
const titleId = useId();

function isExpected(curie: string): boolean {
  return props.expectedCuries.includes(curie);
}

/**
 * Open the full response in a native modal <dialog>. showModal() is what makes it
 * accessible: it moves focus inside, makes the rest of the page inert so Tab cannot
 * reach it, closes on Escape, and returns focus to the JSON button when it closes. A
 * Bootstrap-styled <div> overlay does none of that without its JavaScript.
 */
async function showFullResponse(result: NameResResult) {
  modalResult.value = result;
  await nextTick();
  dialog.value?.showModal();
}

function closeModal() {
  dialog.value?.close();
}

/** A click on the dialog element itself, not its content, is a click on the backdrop. */
function onDialogClick(event: MouseEvent) {
  if (event.target === dialog.value) closeModal();
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
              <CurieLink :curie="r.curie" />
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

  <!-- Full response; every way of closing it ends in the close event. -->
  <dialog
    ref="dialog"
    class="nameres-json-dialog p-0 border-0 rounded"
    :aria-labelledby="titleId"
    @click="onDialogClick"
    @close="modalResult = null"
  >
    <!-- A card, not .modal-content: Bootstrap sets that one's colours and padding as
         variables on a .modal parent, which a <dialog> does not have. -->
    <div v-if="modalResult" class="card">
      <div class="card-header d-flex align-items-center justify-content-between gap-2">
        <h5 :id="titleId" class="mb-0">Full Response — {{ modalResult.curie }}</h5>
        <button type="button" class="btn-close" aria-label="Close" @click="closeModal"></button>
      </div>
      <div class="card-body">
        <pre class="mb-0" style="white-space: pre-wrap; word-break: break-all">{{ JSON.stringify(modalResult, null, 2) }}</pre>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.nameres-json-dialog {
  width: min(800px, calc(100vw - 2rem));
}

.nameres-json-dialog .card-body {
  max-height: calc(100vh - 8rem);
  overflow-y: auto;
}

.nameres-json-dialog::backdrop {
  background: rgba(0, 0, 0, 0.5);
}
</style>
