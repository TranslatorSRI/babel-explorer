<script setup lang="ts">
const props = defineProps<{ type: string }>();
const label = props.type.replace('biolink:', '');
const href = `https://biolink.github.io/biolink-model/${label}`;
</script>

<template>
  <!-- @click.stop prevents accordion-toggle propagation when rendered inside a <button> -->
  <a :href="href" target="_blank" rel="noopener" @click.stop>{{ label }}</a>
</template>
