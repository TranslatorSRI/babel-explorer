<script setup lang="ts">
import { computed } from 'vue';
import type { NameResResult, NameResInstance } from '../../lib/nameres-types';
import { computeInstanceDiffs } from '../../lib/autocomplete-diff';
import type { InstanceState } from '../../lib/autocomplete-state';
import { labelFragment } from '../../lib/highlight-sanitize';
import HighlightedFragment from './HighlightedFragment.vue';
import LatencyBadge from './LatencyBadge.vue';
import CurieLink from '../shared/CurieLink.vue';
import BiolinkTypeLink from '../shared/BiolinkTypeLink.vue';

const props = defineProps<{
  queriedInstances: NameResInstance[];
  perInstance: Map<string, InstanceState>;
  expected: string[];
  highlight: boolean;
  apiUrls: Map<string, string>;
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

/**
 * Why an instance has no results, when it failed. Shown in its column header and cells,
 * so a failed instance is not mistaken for one that answered with nothing.
 */
function errorFor(url: string): string | null {
  return props.perInstance.get(url)?.error ?? null;
}

const failedCount = computed(
  () => props.queriedInstances.filter((inst) => errorFor(inst.url) !== null).length,
);

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

function primaryTypesForCurie(curie: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const inst of props.queriedInstances) {
    const t = resultFor(inst.url, curie)?.types[0];
    if (t && !seen.has(t)) { seen.add(t); result.push(t); }
  }
  return result;
}

function uniqueLabelsForCurie(curie: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const inst of props.queriedInstances) {
    const label = resultFor(inst.url, curie)?.label;
    if (label && !seen.has(label)) { seen.add(label); result.push(label); }
  }
  return result;
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
                <span>
                  {{ inst.name }}
                  <a
                    v-if="apiUrls.get(inst.url)"
                    :href="apiUrls.get(inst.url)"
                    target="_blank"
                    rel="noopener"
                    class="text-muted small ms-1"
                  >API↗</a>
                </span>
                <LatencyBadge
                  :elapsed-ms="perInstance.get(inst.url)?.elapsedMs ?? null"
                  :state="perInstance.get(inst.url)?.state ?? 'idle'"
                  :parallel="queriedInstances.length > 1"
                />
                <div
                  v-if="errorFor(inst.url)"
                  class="small text-danger fw-normal text-wrap"
                  style="max-width: 220px"
                  role="alert"
                >{{ errorFor(inst.url) }}</div>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="diffs.unionCuries.length === 0">
            <td :colspan="queriedInstances.length + 1" class="text-muted text-center py-3">
              <em v-if="failedCount === queriedInstances.length">Every instance failed; the errors are above.</em>
              <em v-else-if="failedCount > 0">No results from the instances that answered.</em>
              <em v-else>No results from any instance.</em>
            </td>
          </tr>
          <tr
            v-for="curie in diffs.unionCuries"
            :key="curie"
            :class="rowClass(curie)"
          >
            <td :class="expectedClass(curie)">
              <div class="d-flex align-items-center gap-1 flex-wrap">
                <CurieLink :curie="curie" />
                <span
                  v-for="t in primaryTypesForCurie(curie)"
                  :key="t"
                  class="badge bg-secondary-subtle text-secondary-emphasis"
                  style="font-size: 0.7em"
                ><BiolinkTypeLink :type="t" /></span>
              </div>
              <div v-if="uniqueLabelsForCurie(curie).length" class="small text-muted">
                {{ uniqueLabelsForCurie(curie).join(' · ') }}
              </div>
              <div v-if="diffs.labelMismatch.has(curie)" class="small">
                <span class="badge bg-warning-subtle text-warning-emphasis">label differs</span>
              </div>
            </td>
            <td
              v-for="inst in queriedInstances"
              :key="inst.url"
              class="text-center"
              :class="!resultFor(inst.url, curie) && !errorFor(inst.url) ? 'bg-danger-subtle' : ''"
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
                    :fragment="labelFragment(resultFor(inst.url, curie)!)"
                    :highlight="highlight"
                  />
                </div>
                <div
                  v-if="diffs.typesMismatch.has(curie) && resultFor(inst.url, curie)?.types[0]"
                  class="small fst-italic text-muted"
                >
                  <BiolinkTypeLink :type="resultFor(inst.url, curie)!.types[0]" />
                </div>
              </template>
              <span v-else-if="errorFor(inst.url)" class="text-danger small" :title="errorFor(inst.url)!">error</span>
              <span v-else class="text-muted small">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
