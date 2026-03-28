<script setup lang="ts">
import { ref, computed } from 'vue';
import type { NodeNormInstance, ApiOptions } from '../../lib/types';
import { DEFAULT_API_OPTIONS } from '../../lib/types';

const DEFAULT_CURIES = 'MONDO:0004979\nCHEBI:48947\nNCBIGene:1756';

const props = defineProps<{
  instances: NodeNormInstance[];
  loading: boolean;
  mode: 'single' | 'compare';
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
  'update:mode': [mode: 'single' | 'compare'];
  stop: [];
  share: [];
}>();

/** Resolve a target (env key or full URL) to an instance URL. */
function resolveTarget(target: string): string {
  return props.instances.find((i) => i.env === target || i.url === target)?.url ?? target;
}

// Form state — initialised from props (URL params) or built-in defaults
const curies = ref(props.initialCuries ?? DEFAULT_CURIES);

const initialUrl = props.initialTargets?.length === 1
  ? resolveTarget(props.initialTargets[0])
  : (props.instances[0]?.url ?? '');
const isCustom = props.initialTargets?.length === 1 &&
  !props.instances.find((i) => i.env === props.initialTargets![0] || i.url === props.initialTargets![0]);

const selectedInstance = ref(isCustom ? '__custom__' : initialUrl);
const customUrl = ref(isCustom ? (props.initialTargets?.[0] ?? '') : '');
const showCustom = computed(() => selectedInstance.value === '__custom__');
const options = ref<ApiOptions>({ ...DEFAULT_API_OPTIONS, ...props.initialOptions });

// For compare mode: track which instances are selected
const compareSelected = ref<Set<string>>(new Set(
  props.initialTargets?.length
    ? props.initialTargets.map(resolveTarget)
    : [props.instances[0]?.url ?? ''],
));

// Share button "Copied!" flash
const copied = ref(false);

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
