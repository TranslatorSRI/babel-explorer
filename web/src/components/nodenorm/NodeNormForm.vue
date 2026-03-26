<script setup lang="ts">
import { ref, computed } from 'vue';
import type { NodeNormInstance, ApiOptions } from '../../lib/types';
import { DEFAULT_API_OPTIONS } from '../../lib/types';

const props = defineProps<{
  instances: NodeNormInstance[];
  loading: boolean;
  mode: 'single' | 'compare';
}>();

const emit = defineEmits<{
  submit: [payload: { curies: string; instanceUrls: string[]; options: ApiOptions }];
  'update:mode': [mode: 'single' | 'compare'];
}>();

const curies = ref('');
const selectedInstance = ref(props.instances[0]?.url ?? '');
const customUrl = ref('');
const showCustom = computed(() => selectedInstance.value === '__custom__');
const options = ref<ApiOptions>({ ...DEFAULT_API_OPTIONS });

// For compare mode: track which instances are selected
const compareSelected = ref<Set<string>>(new Set([props.instances[0]?.url ?? '']));

function toggleCompareInstance(url: string) {
  if (compareSelected.value.has(url)) {
    compareSelected.value.delete(url);
  } else {
    compareSelected.value.add(url);
  }
}

function onSubmit() {
  if (!curies.value.trim()) return;

  let urls: string[];
  if (props.mode === 'compare') {
    urls = [...compareSelected.value];
    if (urls.length === 0) return;
  } else {
    const url = showCustom.value ? customUrl.value : selectedInstance.value;
    if (!url.trim()) return;
    urls = [url];
  }

  emit('submit', { curies: curies.value, instanceUrls: urls, options: { ...options.value } });
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

    <!-- Mode toggle -->
    <div class="mb-3">
      <div class="btn-group btn-group-sm" role="group">
        <button
          type="button"
          :class="['btn', mode === 'single' ? 'btn-primary' : 'btn-outline-primary']"
          @click="emit('update:mode', 'single')"
        >
          Single Instance
        </button>
        <button
          type="button"
          :class="['btn', mode === 'compare' ? 'btn-primary' : 'btn-outline-primary']"
          @click="emit('update:mode', 'compare')"
        >
          Compare Instances
        </button>
      </div>
    </div>

    <div class="row mb-3">
      <div class="col-md-6">
        <!-- Single mode: dropdown -->
        <template v-if="mode === 'single'">
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
        </template>

        <!-- Compare mode: checkboxes -->
        <template v-else>
          <label class="form-label">Select Instances to Compare</label>
          <div v-for="inst in instances" :key="inst.url" class="form-check">
            <input
              :id="`cmp-${inst.env}`"
              type="checkbox"
              class="form-check-input"
              :checked="compareSelected.has(inst.url)"
              @change="toggleCompareInstance(inst.url)"
            />
            <label :for="`cmp-${inst.env}`" class="form-check-label">{{ inst.name }}</label>
          </div>
        </template>
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
