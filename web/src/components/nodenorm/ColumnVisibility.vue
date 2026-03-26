<script setup lang="ts">
const props = defineProps<{
  visibleColumns: Set<string>;
}>();

const emit = defineEmits<{
  toggle: [column: string];
}>();

const columns = [
  { key: 'type', label: 'Biolink Type' },
  { key: 'taxa', label: 'Taxa' },
  { key: 'description', label: 'Description' },
];
</script>

<template>
  <div class="mb-3">
    <span class="me-2 text-muted small">Show columns:</span>
    <div class="btn-group btn-group-sm" role="group">
      <button
        v-for="col in columns"
        :key="col.key"
        type="button"
        :class="['btn', visibleColumns.has(col.key) ? 'btn-secondary' : 'btn-outline-secondary']"
        @click="emit('toggle', col.key)"
      >
        {{ col.label }}
      </button>
    </div>
  </div>
</template>
