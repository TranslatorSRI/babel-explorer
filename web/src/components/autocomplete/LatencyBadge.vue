<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  elapsedMs: number | null;
  /** 'ok' | 'error' | 'cancelled' | 'idle'. */
  state: 'ok' | 'error' | 'cancelled' | 'idle';
  /** When true, adds a tooltip warning about parallel-request contention. */
  parallel?: boolean;
}>();

const cls = computed(() => {
  switch (props.state) {
    case 'ok': return 'bg-success-subtle text-success-emphasis';
    case 'error': return 'bg-danger-subtle text-danger-emphasis';
    case 'cancelled': return 'bg-secondary-subtle text-secondary-emphasis';
    default: return 'bg-light text-muted';
  }
});

const label = computed(() => {
  if (props.state === 'idle') return '—';
  if (props.elapsedMs === null) return '—';
  return `${Math.round(props.elapsedMs)} ms`;
});

const title = computed(() => {
  const base = props.state === 'cancelled' ? 'Cancelled' : props.state === 'error' ? 'Error' : 'Response time';
  if (props.parallel && props.state === 'ok') {
    return `${base} — note: parallel requests share client bandwidth, so this is not a clean latency comparison.`;
  }
  return base;
});
</script>

<template>
  <span class="badge rounded-pill" :class="cls" :title="title">{{ label }}</span>
</template>
