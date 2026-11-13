<script setup lang="ts">
import { computed } from 'vue';
import { getCurieUrl } from '../../lib/curie-links';

const props = defineProps<{ curie: string }>();

const url = computed(() => getCurieUrl(props.curie));
</script>

<template>
  <!-- @click.stop: following the link must not also toggle a clickable parent row. -->
  <a v-if="url" :href="url" target="_blank" rel="noopener" @click.stop>{{ curie }}</a>
  <span v-else>{{ curie }}</span>
</template>
