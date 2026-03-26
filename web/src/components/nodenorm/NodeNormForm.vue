<script setup lang="ts">
import { ref, computed } from 'vue';
import type { NodeNormInstance, ApiOptions } from '../../lib/types';
import { DEFAULT_API_OPTIONS } from '../../lib/types';

const props = defineProps<{
  instances: NodeNormInstance[];
  loading: boolean;
}>();

const emit = defineEmits<{
  submit: [payload: { curies: string; instanceUrl: string; options: ApiOptions }];
}>();

const curies = ref('');
const selectedInstance = ref(props.instances[0]?.url ?? '');
const customUrl = ref('');
const showCustom = computed(() => selectedInstance.value === '__custom__');
const options = ref<ApiOptions>({ ...DEFAULT_API_OPTIONS });

function onSubmit() {
  const url = showCustom.value ? customUrl.value : selectedInstance.value;
  if (!curies.value.trim() || !url.trim()) return;
  emit('submit', { curies: curies.value, instanceUrl: url, options: { ...options.value } });
}
</script>

<template>
  <form @submit.prevent="onSubmit">
    <div class="mb-3">
      <label for="curies" class="form-label">CURIEs (one per line)</label>
      <textarea
        id="curies"
        v-model="curies"
        class="form-control"
        rows="5"
        placeholder="MONDO:0004979&#10;CHEBI:48947&#10;HP:0000001"
      ></textarea>
    </div>

    <div class="row mb-3">
      <div class="col-md-6">
        <label for="instance" class="form-label">NodeNorm Instance</label>
        <select id="instance" v-model="selectedInstance" class="form-select">
          <option v-for="inst in instances" :key="inst.url" :value="inst.url">
            {{ inst.name }}
          </option>
          <option value="__custom__">Custom URL...</option>
        </select>
        <input
          v-if="showCustom"
          v-model="customUrl"
          type="url"
          class="form-control mt-2"
          placeholder="https://nodenormalization-sri.renci.org/"
        />
      </div>
    </div>

    <!-- API options -->
    <div class="mb-3">
      <div class="form-check form-check-inline">
        <input id="opt-conflate" v-model="options.conflate" type="checkbox" class="form-check-input" />
        <label for="opt-conflate" class="form-check-label">Conflate</label>
      </div>
      <div class="form-check form-check-inline">
        <input id="opt-drug" v-model="options.drug_chemical_conflate" type="checkbox" class="form-check-input" />
        <label for="opt-drug" class="form-check-label">Drug/Chemical Conflate</label>
      </div>
      <div class="form-check form-check-inline">
        <input id="opt-desc" v-model="options.description" type="checkbox" class="form-check-input" />
        <label for="opt-desc" class="form-check-label">Description</label>
      </div>
      <div class="form-check form-check-inline">
        <input id="opt-types" v-model="options.individual_types" type="checkbox" class="form-check-input" />
        <label for="opt-types" class="form-check-label">Individual Types</label>
      </div>
      <div class="form-check form-check-inline">
        <input id="opt-taxa" v-model="options.include_taxa" type="checkbox" class="form-check-input" />
        <label for="opt-taxa" class="form-check-label">Include Taxa</label>
      </div>
    </div>

    <button type="submit" class="btn btn-primary" :disabled="loading">
      <span v-if="loading" class="spinner-border spinner-border-sm me-1" role="status"></span>
      {{ loading ? 'Normalizing...' : 'Normalize' }}
    </button>
  </form>
</template>
