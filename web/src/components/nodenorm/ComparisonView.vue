<script setup lang="ts">
import { computed } from 'vue';
import type { NodeNormResponse, NodeNormInstance } from '../../lib/types';
import CurieLink from '../shared/CurieLink.vue';

const props = defineProps<{
  /** Map from instance URL to its NodeNorm response. */
  resultsByInstance: Map<string, NodeNormResponse>;
  /** Instances that were queried (in display order). */
  queriedInstances: NodeNormInstance[];
  curies: string[];
  prefixMap: Record<string, string>;
}>();

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
          <th>Input CURIE</th>
          <th v-for="inst in queriedInstances" :key="inst.url">
            {{ inst.name }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="curie in curies" :key="curie" :class="{ 'table-warning': !allAgree(curie) }">
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
      </tbody>
    </table>
  </div>
</template>
