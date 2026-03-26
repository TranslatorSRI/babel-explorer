<script setup lang="ts">
import type { NormalizedIdentifier } from '../../lib/types';
import CurieLink from '../shared/CurieLink.vue';

defineProps<{
  identifiers: NormalizedIdentifier[];
  visibleColumns: Set<string>;
  prefixMap: Record<string, string>;
}>();

function formatList(items: string[] | undefined): string {
  if (!items || items.length === 0) return '';
  return items.join(', ');
}
</script>

<template>
  <div class="table-responsive">
    <table class="table table-striped table-sm mb-0">
      <thead>
        <tr>
          <th>Identifier</th>
          <th>Label</th>
          <th v-if="visibleColumns.has('type')">Biolink Type</th>
          <th v-if="visibleColumns.has('taxa')">Taxa</th>
          <th v-if="visibleColumns.has('description')">Description</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="id in identifiers" :key="id.identifier">
          <td><CurieLink :curie="id.identifier" :prefix-map="prefixMap" /></td>
          <td>{{ id.label || '' }}</td>
          <td v-if="visibleColumns.has('type')">{{ id.type || '' }}</td>
          <td v-if="visibleColumns.has('taxa')">{{ formatList(id.taxa) }}</td>
          <td v-if="visibleColumns.has('description')">
            <span :title="formatList(id.description)">
              {{ id.description?.[0] ? (id.description[0].length > 80 ? id.description[0].slice(0, 80) + '...' : id.description[0]) : '' }}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
