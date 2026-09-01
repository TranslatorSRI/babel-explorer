<script setup lang="ts">
import { computed } from 'vue';
import type { NameResResult, NameResInstance } from '../../lib/nameres-types';
import { classifyExpectedCurie } from '../../lib/autocomplete-diff';
import CurieLink from '../shared/CurieLink.vue';

interface InstanceState {
  results: NameResResult[];
  deepResults?: NameResResult[];
}

const props = defineProps<{
  expected: string[];
  expectedRaw: string;
  perInstance: Map<string, InstanceState>;
  queriedInstances: NameResInstance[];
  prefixMap: Record<string, string>;
  checking: boolean;
  canCheck: boolean;
  hasDeepResults: boolean;
}>();

const emit = defineEmits<{
  'update:expectedRaw': [value: string];
  check: [];
}>();

function statusFor(curie: string, url: string) {
  const state = props.perInstance.get(url);
  return classifyExpectedCurie(curie, state?.results, state?.deepResults);
}

function statusClass(status: string): string {
  switch (status) {
    case 'hit': return 'text-success';
    case 'deep': return 'text-warning';
    case 'miss': return 'text-danger';
    default: return 'text-muted';
  }
}

function statusText(s: ReturnType<typeof classifyExpectedCurie>): string {
  switch (s.status) {
    case 'hit': return `rank ${s.rank + 1}/${s.of}`;
    case 'deep': return `rank ${s.rank + 1}/${s.of}`;
    case 'miss': return `not in top ${s.of}`;
    case 'unknown': return '—';
  }
}

const hasAnyInstance = computed(() => props.queriedInstances.length > 0);
</script>

<template>
  <div class="mb-3">
    <label for="expected" class="form-label small mb-0 fw-semibold">
      Expected CURIEs <span class="text-muted fw-normal">(shareable — check whether they appear in the results)</span>
    </label>
    <textarea
      id="expected"
      :value="expectedRaw"
      rows="2"
      class="form-control form-control-sm mt-1"
      placeholder="MONDO:0005148, HP:0003560"
      @input="emit('update:expectedRaw', ($event.target as HTMLTextAreaElement).value)"
    ></textarea>

    <div class="mt-1 d-flex align-items-center gap-2 flex-wrap">
      <button
        type="button"
        class="btn btn-sm btn-outline-secondary"
        :disabled="!canCheck || checking"
        @click="emit('check')"
      >
        <span v-if="checking" class="spinner-border spinner-border-sm me-1" role="status"></span>
        {{ checking ? 'Checking…' : hasDeepResults ? 'Re-check (top 100)' : 'Check (top 100)' }}
      </button>
      <small class="text-muted">
        Click Check to fetch the top 100 results per instance and resolve expected CURIEs outside the top-N.
      </small>
    </div>

    <div v-if="expected.length > 0 && hasAnyInstance" class="table-responsive mt-2">
      <table class="table table-sm table-borderless mb-0 small">
        <thead>
          <tr>
            <th>Expected</th>
            <th v-for="inst in queriedInstances" :key="inst.url">{{ inst.name }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="curie in expected" :key="curie">
            <td><CurieLink :curie="curie" :prefix-map="prefixMap" /></td>
            <td
              v-for="inst in queriedInstances"
              :key="inst.url"
              :class="statusClass(statusFor(curie, inst.url).status)"
            >
              {{ statusText(statusFor(curie, inst.url)) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
