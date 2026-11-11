<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ type: string }>();
// computed, not plain consts: Vue reuses a component instance when its props change,
// and a value read once at setup would keep showing the previous type.
const label = computed(() => props.type.replace('biolink:', ''));
const href = computed(() => `https://biolink.github.io/biolink-model/${label.value}`);
</script>

<template>
  <!-- @click.stop prevents accordion-toggle propagation when rendered inside a <button> -->
  <a :href="href" target="_blank" rel="noopener" @click.stop>{{ label }}</a>
</template>
