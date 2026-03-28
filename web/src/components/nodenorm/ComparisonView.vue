<script setup lang="ts">
import { ref } from 'vue';
import type { NormalizedNode, NodeNormResponse, NodeNormInstance } from '../../lib/types';
import CurieLink from '../shared/CurieLink.vue';
import CurieDetailPanel from './CurieDetailPanel.vue';

const props = defineProps<{
  /** Map from instance URL to its NodeNorm response. */
  resultsByInstance: Map<string, NodeNormResponse>;
  /** Instances that were queried (in display order). */
  queriedInstances: NodeNormInstance[];
  curies: string[];
  prefixMap: Record<string, string>;
  visibleColumns: Set<string>;
}>();

const expandedCuries = ref(new Set<string>());

function toggleRow(curie: string) {
  if (expandedCuries.value.has(curie)) {
    expandedCuries.value.delete(curie);
  } else {
    expandedCuries.value.add(curie);
  }
}

function getNode(curie: string, url: string): NormalizedNode | null {
  return props.resultsByInstance.get(url)?.[curie] ?? null;
}

/**
 * For a given CURIE, check if all instances agree on the preferred ID.
 */
function allAgree(curie: string): boolean {
  const ids = new Set<string>();
  for (const inst of props.queriedInstances) {
    const resp = props.resultsByInstance.get(inst.url);
    if (!resp) continue;
    const node = resp[curie];
    ids.add(node?.id?.identifier ?? '(not found)');
  }
  return ids.size <= 1;
}

function getPreferredId(curie: string, instanceUrl: string): string | null {
  const resp = props.resultsByInstance.get(instanceUrl);
  if (!resp) return null;
  return resp[curie]?.id?.identifier ?? null;
}

function getLabel(curie: string, instanceUrl: string): string {
  const resp = props.resultsByInstance.get(instanceUrl);
  if (!resp) return '';
  return resp[curie]?.id?.label ?? '';
}

function getTypes(curie: string, instanceUrl: string): string[] {
  const resp = props.resultsByInstance.get(instanceUrl);
  if (!resp) return [];
  return resp[curie]?.type ?? [];
}

function getEquivCount(curie: string, instanceUrl: string): number {
  const resp = props.resultsByInstance.get(instanceUrl);
  if (!resp) return 0;
  return resp[curie]?.equivalent_identifiers?.length ?? 0;
}
</script>

<template>
  <div class="table-responsive">
    <table class="table table-bordered table-sm">
      <thead>
        <tr>
          <th style="width: 1.5rem"></th>
          <th>Input CURIE</th>
          <th v-for="inst in queriedInstances" :key="inst.url">
            {{ inst.name }}
          </th>
        </tr>
      </thead>
      <tbody v-for="curie in curies" :key="curie">
        <!-- Summary row — click to expand/collapse -->
        <tr
          :class="['align-middle', allAgree(curie) ? '' : 'table-warning']"
          style="cursor: pointer"
          @click="toggleRow(curie)"
        >
          <td class="text-center">
            <span
              :style="{
                display: 'inline-block',
                transform: expandedCuries.has(curie) ? 'rotate(90deg)' : '',
                transition: 'transform 0.15s',
              }"
            >›</span>
          </td>
          <td><strong>{{ curie }}</strong></td>
          <td v-for="inst in queriedInstances" :key="inst.url">
            <template v-if="getPreferredId(curie, inst.url)">
              <CurieLink :curie="getPreferredId(curie, inst.url)!" :prefix-map="prefixMap" />
              <br />
              <small class="text-muted">{{ getLabel(curie, inst.url) }}</small>
              <br />
              <span
                v-for="t in getTypes(curie, inst.url).slice(0, 2)"
                :key="t"
                class="badge bg-info text-dark me-1"
                style="font-size: 0.7em;"
              >{{ t.replace('biolink:', '') }}</span>
              <br />
              <small class="text-muted">{{ getEquivCount(curie, inst.url) }} equiv. IDs</small>
            </template>
            <span v-else class="text-muted">Not found</span>
          </td>
        </tr>

        <!-- Detail row — conditionally rendered when row is expanded -->
        <tr v-if="expandedCuries.has(curie)" class="bg-light">
          <td></td>
          <td :colspan="queriedInstances.length + 1" class="p-0">
            <div class="d-flex flex-wrap">
              <div
                v-for="inst in queriedInstances"
                :key="inst.url"
                class="flex-fill border-end p-3"
                :style="{ minWidth: `${100 / queriedInstances.length}%`, maxWidth: `${100 / queriedInstances.length}%` }"
              >
                <div class="fw-semibold text-muted small mb-2">{{ inst.name }}</div>
                <CurieDetailPanel
                  :node="getNode(curie, inst.url)"
                  :visible-columns="visibleColumns"
                  :prefix-map="prefixMap"
                />
              </div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
