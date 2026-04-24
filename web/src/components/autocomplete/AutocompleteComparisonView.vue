<script setup lang="ts">
import { computed } from 'vue';
import type { NameResResult, NameResInstance } from '../../lib/nameres-types';
import { computeInstanceDiffs } from '../../lib/autocomplete-diff';
import HighlightedFragment from './HighlightedFragment.vue';
import LatencyBadge from './LatencyBadge.vue';
import CurieLink from '../shared/CurieLink.vue';

interface InstanceState {
  results: NameResResult[];
  elapsedMs: number | null;
  error: string | null;
  inFlight: boolean;
  state: 'ok' | 'error' | 'cancelled' | 'idle';
}

const props = defineProps<{
  queriedInstances: NameResInstance[];
  perInstance: Map<string, InstanceState>;
  expected: string[];
  highlight: boolean;
  prefixMap: Record<string, string>;
}>();

const resultsMap = computed(() => {
  const m = new Map<string, NameResResult[]>();
  for (const inst of props.queriedInstances) {
    m.set(inst.url, props.perInstance.get(inst.url)?.results ?? []);
  }
  return m;
});

const diffs = computed(() => computeInstanceDiffs(resultsMap.value));
const expectedSet = computed(() => new Set(props.expected));

function resultFor(url: string, curie: string): NameResResult | undefined {
  const results = props.perInstance.get(url)?.results ?? [];
  return results.find((r) => r.curie === curie);
}

function minRankAcross(curie: string): number {
  let best = Infinity;
  const ranks = diffs.value.rankByCurie.get(curie);
  if (!ranks) return best;
  for (const v of ranks.values()) if (v < best) best = v;
  return best;
}

function rowClass(curie: string): string {
  const labelDiff = diffs.value.labelMismatch.has(curie);
  const typesDiff = diffs.value.typesMismatch.has(curie);
  if (labelDiff || typesDiff) return 'table-warning';
  return '';
}

function expectedClass(curie: string): string {
  return expectedSet.value.has(curie) ? 'fw-semibold border-start border-3 border-info' : '';
}
</script>

<template>
  <div class="card">
    <div class="card-header">
      <strong>Comparison —</strong> {{ queriedInstances.length }} instances
    </div>

    <div class="table-responsive">
      <table class="table table-sm table-hover mb-0 align-middle">
        <thead>
          <tr>
            <th style="min-width: 220px">CURIE / Label</th>
            <th
              v-for="inst in queriedInstances"
              :key="inst.url"
              class="text-center"
              style="min-width: 170px"
            >
              <div class="d-flex flex-column align-items-center gap-1">
                <span>{{ inst.name }}</span>
                <LatencyBadge
                  :elapsed-ms="perInstance.get(inst.url)?.elapsedMs ?? null"
                  :state="perInstance.get(inst.url)?.state ?? 'idle'"
                  :parallel="queriedInstances.length > 1"
                />
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="diffs.unionCuries.length === 0">
            <td :colspan="queriedInstances.length + 1" class="text-muted text-center py-3">
              <em>No results from any instance.</em>
            </td>
          </tr>
          <tr
            v-for="curie in diffs.unionCuries"
            :key="curie"
            :class="rowClass(curie)"
          >
            <td :class="expectedClass(curie)">
              <div><CurieLink :curie="curie" :prefix-map="prefixMap" /></div>
              <div class="small text-muted">
                <template v-for="(inst, i) in queriedInstances" :key="inst.url">
                  <template v-if="resultFor(inst.url, curie)?.label">
                    {{ resultFor(inst.url, curie)!.label }}
                    <span v-if="i < queriedInstances.length - 1"> · </span>
                  </template>
                </template>
              </div>
              <div v-if="diffs.labelMismatch.has(curie)" class="small">
                <span class="badge bg-warning-subtle text-warning-emphasis">label differs</span>
              </div>
              <div v-if="diffs.typesMismatch.has(curie)" class="small">
                <span class="badge bg-warning-subtle text-warning-emphasis">types differ</span>
              </div>
            </td>
            <td
              v-for="inst in queriedInstances"
              :key="inst.url"
              class="text-center"
              :class="!resultFor(inst.url, curie) ? 'bg-danger-subtle' : ''"
            >
              <template v-if="resultFor(inst.url, curie)">
                <div>
                  <span
                    :class="diffs.rankByCurie.get(curie)?.get(inst.url) !== minRankAcross(curie) ? 'text-warning fw-semibold' : ''"
                  >
                    #{{ (diffs.rankByCurie.get(curie)!.get(inst.url)! + 1) }}
                  </span>
                  <span class="text-muted small">
                    · {{ resultFor(inst.url, curie)!.score.toFixed(2) }}
                  </span>
                </div>
                <div class="small">
                  <HighlightedFragment
                    :fragment="resultFor(inst.url, curie)!.label"
                    :highlight="highlight"
                  />
                </div>
              </template>
              <span v-else class="text-muted small">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
