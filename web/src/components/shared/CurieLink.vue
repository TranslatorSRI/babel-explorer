<script setup lang="ts">
import { computed } from 'vue';
import { getCurieUrl } from '../../lib/curie-links';

const props = defineProps<{
  curie: string;
  prefixMap: Record<string, string>;
}>();

const url = computed(() => getCurieUrl(props.curie, props.prefixMap));
</script>

<template>
  <a v-if="url" :href="url" target="_blank" rel="noopener">{{ curie }}</a>
  <span v-else>{{ curie }}</span>
</template>
