<script setup lang="ts">
import { computed } from 'vue';
import { renderHighlight } from '../../lib/highlight-sanitize';

const props = defineProps<{
  /** An HTML-encoded NameRes highlighting fragment (see lib/highlight-sanitize.ts). */
  fragment: string;
  /** When false, the match marks are dropped and plain text is rendered. */
  highlight?: boolean;
}>();

const safe = computed(() => renderHighlight(props.fragment, props.highlight !== false));
</script>

<template>
  <!-- The single v-html in this codebase. renderHighlight escapes everything but <mark>. -->
  <span class="hl-fragment" v-html="safe"></span>
</template>

<style scoped>
.hl-fragment :deep(mark) {
  font-weight: 600;
  color: inherit;
  background-color: rgba(255, 230, 0, 0.35);
  padding: 0 1px;
  border-radius: 2px;
}
</style>
