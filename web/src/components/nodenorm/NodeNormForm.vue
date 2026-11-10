<script setup lang="ts">
import { ref, computed } from 'vue';
import type { NodeNormInstance, ApiOptions } from '../../lib/types';
import { DEFAULT_API_OPTIONS } from '../../lib/types';
import { findInstance, normalizeInstanceUrl, resolveTarget } from '../../lib/instances';

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
}>();

// Form state
const curies = ref(props.initialCuries ?? DEFAULT_CURIES);
const options = ref<ApiOptions>({ ...DEFAULT_API_OPTIONS, ...props.initialOptions });

// Targets from the page URL, resolved to instance URLs. Anything that is neither a
// known instance nor an http(s) URL is dropped here; NodeNormApp reports it.
const initialUrls = [
  ...new Set(
    (props.initialTargets ?? [])
      .map((t) => resolveTarget(props.instances, t))
      .filter((u): u is string => u !== null),
  ),
];

// Unified instance selection — always checkboxes
const selectedUrls = ref(new Set<string>(
  initialUrls.length ? initialUrls : [props.instances[0]?.url ?? ''],
));

// Custom URLs: every target that isn't a known instance. Each gets its own checkbox,
// so nothing can stay selected without a way to untick it.
const customUrlInput = ref('');
const customUrls = ref(initialUrls.filter((u) => !findInstance(props.instances, u)));
const customUrlValid = computed(() => normalizeInstanceUrl(customUrlInput.value) !== null);

// Share button feedback ("✓ Copied!" or "Copy failed"), cleared after a moment
const shareStatus = ref<string | null>(null);

function toggleUrl(url: string) {
  if (selectedUrls.value.has(url)) {
    selectedUrls.value.delete(url);
  } else {
    selectedUrls.value.add(url);
  }
}

function addCustomUrl() {
  const url = resolveTarget(props.instances, customUrlInput.value);
  if (url === null) return;
  // A known instance typed as a URL (with or without its trailing slash) ticks that
  // instance rather than adding a second row for the same server.
  if (!findInstance(props.instances, url) && !customUrls.value.includes(url)) {
    customUrls.value.push(url);
  }
  selectedUrls.value.add(url);
  customUrlInput.value = '';
}

function removeCustomUrl(url: string) {
  customUrls.value = customUrls.value.filter((u) => u !== url);
  selectedUrls.value.delete(url);
}

function onSubmit() {
  if (!curies.value.trim()) return;
  const urls = [...selectedUrls.value];
  if (urls.length === 0) return;
  emit('submit', { curies: curies.value, instanceUrls: urls, options: { ...options.value } });
}

const ADVANCED_KEYS = ['description', 'include_taxa'] as const;
const hasNonDefaultAdvancedOptions = computed(() =>
  ADVANCED_KEYS.some((k) => options.value[k] !== DEFAULT_API_OPTIONS[k])
);

async function onShare() {
  try {
    // navigator.clipboard is undefined outside a secure context, which lands here too.
    await navigator.clipboard.writeText(window.location.href);
    shareStatus.value = '✓ Copied!';
  } catch {
    shareStatus.value = 'Copy failed';
  }
  setTimeout(() => { shareStatus.value = null; }, 2000);
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

    <!-- Instance selection — always checkboxes -->
    <div class="row mb-3">
      <div class="col-md-6">
        <label class="form-label">NodeNorm Instances</label>
        <div v-for="inst in instances" :key="inst.url" class="form-check">
          <input
            :id="`inst-${inst.env}`"
            type="checkbox"
            class="form-check-input"
            :checked="selectedUrls.has(inst.url)"
            @change="toggleUrl(inst.url)"
          />
          <label :for="`inst-${inst.env}`" class="form-check-label">{{ inst.name }}</label>
        </div>

        <!-- One row per custom URL -->
        <div v-for="(url, i) in customUrls" :key="url" class="form-check mt-1">
          <input
            :id="`inst-custom-${i}`"
            type="checkbox"
            class="form-check-input"
            :checked="selectedUrls.has(url)"
            @change="toggleUrl(url)"
          />
          <label :for="`inst-custom-${i}`" class="form-check-label d-flex align-items-center gap-1">
            <span>Custom:</span>
            <span class="text-muted small text-truncate" style="max-width: 240px">{{ url }}</span>
            <button
              type="button"
              class="btn-close"
              style="font-size: 0.65rem"
              aria-label="Remove custom URL"
              @click.stop="removeCustomUrl(url)"
            ></button>
          </label>
        </div>

        <!-- Add custom URL control -->
        <div class="mt-2 d-flex gap-2 align-items-center">
          <input
            v-model="customUrlInput"
            type="url"
            class="form-control form-control-sm"
            placeholder="Add custom URL…"
            style="max-width: 280px"
          />
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary"
            :disabled="!customUrlValid"
            @click="addCustomUrl()"
          >
            Add
          </button>
        </div>
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
        {{ shareStatus ?? 'Share' }}
      </button>
    </div>
  </form>
</template>
