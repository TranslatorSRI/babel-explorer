<script setup lang="ts">
import { ref, computed } from 'vue';
import type { NodeNormResponse, NodeNormInstance, ApiOptions } from '../../lib/types';
import { getDirectTypes, buildNodeNormUrl, preferredIdsDisagree } from '../../lib/nodenorm-api';
import BiolinkTypeLink from '../shared/BiolinkTypeLink.vue';
import CurieLink from '../shared/CurieLink.vue';
import CurieDetailPanel from './CurieDetailPanel.vue';

const props = defineProps<{
  /** Map from instance URL to its NodeNorm response. */
  resultsByInstance: Map<string, NodeNormResponse>;
  /** Instances that were queried (in display order). */
  queriedInstances: NodeNormInstance[];
  curies: string[];
  visibleColumns: Set<string>;
  /** Active type filters (full biolink:X types) — only CURIEs with a direct type in this set are shown. */
  typeFilter: Set<string>;
  apiOptions: ApiOptions;
}>();

const expandedCuries = ref(new Set<string>());

/** One row per CURIE, with each instance's node and direct types looked up once. */
const allRows = computed(() =>
  props.curies.map((curie) => ({
    curie,
    disagree: preferredIdsDisagree(curie, props.queriedInstances, props.resultsByInstance),
    cells: props.queriedInstances.map((inst) => {
      const resp = props.resultsByInstance.get(inst.url);
      const node = resp?.[curie] ?? null;
      return {
        inst,
        node,
        // No response at all means the request failed, not that the CURIE is unknown.
        failed: resp === undefined,
        types: node ? getDirectTypes(node) : [],
        // A malformed custom URL must not throw while rendering.
        rawUrl: URL.canParse(inst.url) ? buildNodeNormUrl(inst.url, [curie], props.apiOptions) : null,
      };
    }),
  })),
);

const rows = computed(() =>
  props.typeFilter.size === 0
    ? allRows.value
    : allRows.value.filter((row) =>
        row.cells.some((cell) => cell.types.some((t) => props.typeFilter.has(t))),
      ),
);

function toggleRow(curie: string) {
  const set = expandedCuries.value;
  if (!set.delete(curie)) set.add(curie);
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
      <tbody v-if="rows.length === 0 && curies.length > 0">
        <tr>
          <td :colspan="queriedInstances.length + 2" class="text-center text-muted py-3">
            No CURIEs match the selected type filter.
          </td>
        </tr>
      </tbody>
      <tbody v-for="row in rows" :key="row.curie">
        <!-- Summary row — click to expand/collapse -->
        <tr
          :class="['align-middle', row.disagree ? 'table-warning' : '']"
          style="cursor: pointer"
          @click="toggleRow(row.curie)"
        >
          <td class="text-center">
            <span
              :style="{
                display: 'inline-block',
                transform: expandedCuries.has(row.curie) ? 'rotate(90deg)' : '',
                transition: 'transform 0.15s',
              }"
            >›</span>
          </td>
          <td><strong>{{ row.curie }}</strong></td>
          <td v-for="cell in row.cells" :key="cell.inst.url">
            <template v-if="cell.node">
              <CurieLink :curie="cell.node.id.identifier" />
              <br />
              <small class="text-muted">{{ cell.node.id.label }}</small>
              <br />
              <template v-if="visibleColumns.has('type')">
                <span
                  v-for="t in cell.types"
                  :key="t"
                  class="badge bg-info text-dark me-1"
                  style="font-size: 0.7em;"
                ><BiolinkTypeLink :type="t" /></span>
                <br />
              </template>
              <small class="text-muted">{{ cell.node.equivalent_identifiers.length }} equivalent IDs</small>
            </template>
            <span v-else-if="cell.failed" class="text-danger">Request failed</span>
            <span v-else class="text-muted">Not found</span>
          </td>
        </tr>

        <!-- Detail row — conditionally rendered when row is expanded -->
        <tr v-if="expandedCuries.has(row.curie)" class="bg-light">
          <td></td>
          <td :colspan="queriedInstances.length + 1" class="p-0">
            <div class="d-flex flex-wrap">
              <div
                v-for="cell in row.cells"
                :key="cell.inst.url"
                class="flex-fill border-end p-3"
                :style="{ minWidth: `${100 / queriedInstances.length}%`, maxWidth: `${100 / queriedInstances.length}%` }"
              >
                <div class="fw-semibold text-muted small mb-2 d-flex align-items-center gap-1">
                  {{ cell.inst.name }}
                  <a
                    v-if="cell.rawUrl"
                    :href="cell.rawUrl"
                    target="_blank"
                    rel="noopener"
                    class="text-muted"
                    title="Open raw API response"
                    @click.stop
                  >↗</a>
                </div>
                <p v-if="cell.failed" class="text-danger">The request to this instance failed.</p>
                <CurieDetailPanel v-else :node="cell.node" :visible-columns="visibleColumns" />
              </div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
