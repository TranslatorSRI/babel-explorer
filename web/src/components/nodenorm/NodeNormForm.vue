<script setup lang="ts">
import { ref } from 'vue';
import type { NodeNormInstance, ApiOptions, NodeNormQuery } from '../../lib/types';
import { DEFAULT_API_OPTIONS } from '../../lib/types';
import InstanceSelector from '../shared/InstanceSelector.vue';
import { useShareLink } from '../../lib/use-share-link';

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
  submit: [payload: NodeNormQuery];
  stop: [];
}>();

// Form state
const curies = ref(props.initialCuries ?? DEFAULT_CURIES);
const options = ref<ApiOptions>({ ...DEFAULT_API_OPTIONS, ...props.initialOptions });

// Instance selection, owned by InstanceSelector through v-model. It resolves the page
// URL's targets through lib/instances, dropping any that is not an http(s) URL;
// NodeNormApp reports those.
const selectedUrls = ref<string[]>([]);

// Share button: copies the page URL, then says "✓ Copied!" or "Copy failed" for a moment
const { shareStatus, share } = useShareLink();

function onSubmit() {
  if (!curies.value.trim()) return;
  if (selectedUrls.value.length === 0) return;
  emit('submit', { curies: curies.value, instanceUrls: [...selectedUrls.value], options: { ...options.value } });
}

// Open "Advanced options" when the form starts with any of them changed, so a share
// link's settings are visible. Decided once: binding :open to a live computed would
// snap the section shut under the user the moment they restored the defaults.
const ADVANCED_KEYS = ['description', 'include_taxa'] as const;
const advancedInitiallyOpen = ADVANCED_KEYS.some(
  (k) => options.value[k] !== DEFAULT_API_OPTIONS[k],
);
</script>

<template>
  <!-- novalidate: the browser's own check on InstanceSelector's custom-URL box would
       otherwise block Normalize whenever that box holds a half-typed URL. -->
  <form novalidate @submit.prevent="onSubmit">
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
          service="nodenorm"
          v-model="selectedUrls"
          :instances="instances"
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
    <details class="mb-3" :open="advancedInitiallyOpen">
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
        @click="share"
      >
        {{ shareStatus ?? 'Share' }}
      </button>
    </div>
  </form>
</template>
