<script setup lang="ts">
import { ref, computed } from 'vue';
import type { NodeNormInstance, ApiOptions } from '../../lib/types';
import { DEFAULT_API_OPTIONS } from '../../lib/types';
import InstanceSelector from '../shared/InstanceSelector.vue';

const DEFAULT_CURIES = 'MONDO:0004979\nCHEBI:48947\nNCBIGene:1756';

const props = defineProps<{
  instances: NodeNormInstance[];
  loading: boolean;
  hasResults: boolean;
  /** Pre-fill CURIEs from URL params (overrides built-in defaults). */
  initialCuries?: string;
  /** Pre-select targets from URL params (env keys or full URLs). */
  initialTargets?: string[];
  /** Pre-set API options from URL params (merged with defaults). */
  initialOptions?: Partial<ApiOptions>;
}>();

const emit = defineEmits<{
  submit: [payload: { curies: string; instanceUrls: string[]; options: ApiOptions }];
  stop: [];
  share: [];
}>();

// Form state
const curies = ref(props.initialCuries ?? DEFAULT_CURIES);
const options = ref<ApiOptions>({ ...DEFAULT_API_OPTIONS, ...props.initialOptions });

// Instance selection driven by InstanceSelector via v-model
const selectedUrls = ref<string[]>([]);

// Share button "Copied!" flash
const copied = ref(false);

function onSubmit() {
  if (!curies.value.trim()) return;
  if (selectedUrls.value.length === 0) return;
  emit('submit', { curies: curies.value, instanceUrls: selectedUrls.value, options: { ...options.value } });
}

const ADVANCED_KEYS = ['description', 'individual_types', 'include_taxa'] as const;
const hasNonDefaultAdvancedOptions = computed(() =>
  ADVANCED_KEYS.some((k) => options.value[k] !== DEFAULT_API_OPTIONS[k])
);

function onShare() {
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 2000);
  emit('share');
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
      ></textarea>
    </div>

    <!-- Instance selection -->
    <div class="row mb-3">
      <div class="col-md-6">
        <label class="form-label">NodeNorm Instances</label>
        <InstanceSelector
          :instances="instances"
          v-model="selectedUrls"
          :initial-targets="initialTargets"
        />
      </div>
    </div>

    <!-- Main API options -->
    <div class="mb-3 d-flex flex-wrap gap-3">
      <div class="form-check">
        <input id="opt-conflate" v-model="options.conflate" type="checkbox" class="form-check-input" />
        <label for="opt-conflate" class="form-check-label">Conflate</label>
      </div>
      <div class="form-check">
        <input id="opt-drug" v-model="options.drug_chemical_conflate" type="checkbox" class="form-check-input" />
        <label for="opt-drug" class="form-check-label">Drug/Chemical Conflate</label>
      </div>
    </div>

    <!-- Advanced API options -->
    <details class="mb-3" :open="hasNonDefaultAdvancedOptions">
      <summary class="text-muted small" style="cursor: pointer">Advanced options</summary>
      <div class="d-flex flex-wrap gap-3 mt-2">
        <div class="form-check">
          <input id="opt-desc" v-model="options.description" type="checkbox" class="form-check-input" />
          <label for="opt-desc" class="form-check-label small">Description</label>
        </div>
        <div class="form-check">
          <input id="opt-taxa" v-model="options.include_taxa" type="checkbox" class="form-check-input" />
          <label for="opt-taxa" class="form-check-label small">Include Taxa</label>
        </div>
      </div>
    </details>

    <!-- Action buttons -->
    <div class="d-flex align-items-center gap-2 flex-wrap">
      <button type="submit" class="btn btn-primary" :disabled="loading">
        <span v-if="loading" class="spinner-border spinner-border-sm me-1" role="status"></span>
        {{ loading ? 'Normalizing…' : 'Normalize' }}
      </button>

      <button
        v-if="loading"
        type="button"
        class="btn btn-outline-secondary"
        @click="emit('stop')"
      >
        Stop
      </button>

      <button
        v-if="hasResults && !loading"
        type="button"
        class="btn btn-outline-secondary"
        @click="onShare"
      >
        {{ copied ? '✓ Copied!' : 'Share' }}
      </button>
    </div>
  </form>
</template>
