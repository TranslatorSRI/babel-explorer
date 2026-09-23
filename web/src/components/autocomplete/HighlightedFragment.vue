<script setup lang="ts">
import { computed } from 'vue';
import { sanitizeHighlight, stripHighlightTags } from '../../lib/highlight-sanitize';

const props = defineProps<{
  fragment: string;
  /** When false, <em> tags are stripped and plain text is rendered. */
  highlight?: boolean;
}>();

const safe = computed(() =>
  props.highlight === false ? stripHighlightTags(props.fragment) : sanitizeHighlight(props.fragment),
);
</script>

<template>
  <!-- The single v-html in this codebase. Input is always run through the sanitizer. -->
  <span class="hl-fragment" v-html="safe"></span>
</template>

<style scoped>
.hl-fragment :deep(em) {
  font-style: normal;
  font-weight: 600;
  background-color: rgba(255, 230, 0, 0.35);
  padding: 0 1px;
  border-radius: 2px;
}
</style>
