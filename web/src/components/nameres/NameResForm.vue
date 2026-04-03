<script setup lang="ts">
import { ref, computed } from 'vue';
import type { NameResInstance, NameResApiOptions } from '../../lib/nameres-types';
import { DEFAULT_NAMERES_OPTIONS } from '../../lib/nameres-types';

const DEFAULT_TERMS = 'asthma\ndiabetes\nheart failure';

const props = defineProps<{
  instances: NameResInstance[];
  loading: boolean;
  hasResults: boolean;
  /** Pre-fill terms from URL params (overrides built-in defaults). */
  initialTerms?: string;
  /** Pre-select targets from URL params (env keys or full URLs). */
  initialTargets?: string[];
  /** Pre-set API options from URL params (merged with defaults). */
  initialOptions?: Partial<NameResApiOptions>;
  /** Pre-set threshold from URL params. */
  initialThreshold?: number;
}>();

const emit = defineEmits<{
  submit: [payload: {
    rawTerms: string;
    instanceUrls: string[];
    options: NameResApiOptions;
    threshold: number;
  }];
  stop: [];
  share: [];
}>();

/** Resolve a target (env key or full URL) to an instance URL. */
function resolveTarget(target: string): string {
  return props.instances.find((i) => i.env === target || i.url === target)?.url ?? target;
}

// Form state
const terms = ref(props.initialTerms ?? DEFAULT_TERMS);
const options = ref<NameResApiOptions>({ ...DEFAULT_NAMERES_OPTIONS, ...props.initialOptions });
const threshold = ref(props.initialThreshold ?? options.value.limit);

// Unified instance selection — always checkboxes
const selectedUrls = ref(new Set<string>(
  props.initialTargets?.length
    ? props.initialTargets.map(resolveTarget)
    : [props.instances[0]?.url ?? ''],
));

// Custom URL state
const customUrlInput = ref('');
const customUrlAdded = ref<string | null>(null);

// Detect custom URL in initialTargets
if (props.initialTargets?.length) {
  const customTarget = props.initialTargets.find(
    (t) => !props.instances.find((i) => i.env === t || i.url === t),
  );
  if (customTarget) {
    customUrlAdded.value = customTarget;
    selectedUrls.value.add(customTarget);
  }
}

// Share button "Copied!" flash
const copied = ref(false);

function toggleUrl(url: string) {
  if (selectedUrls.value.has(url)) {
    selectedUrls.value.delete(url);
  } else {
    selectedUrls.value.add(url);
  }
}

function addCustomUrl() {
  const url = customUrlInput.value.trim();
  if (!url) return;
  customUrlAdded.value = url;
  selectedUrls.value.add(url);
  customUrlInput.value = '';
}

function removeCustomUrl() {
  if (customUrlAdded.value) selectedUrls.value.delete(customUrlAdded.value);
  customUrlAdded.value = null;
}

function onSubmit() {
  if (!terms.value.trim()) return;
  const urls = [...selectedUrls.value];
  if (urls.length === 0) return;
  emit('submit', {
    rawTerms: terms.value,
    instanceUrls: urls,
    options: { ...options.value },
    threshold: threshold.value,
  });
}

const ADVANCED_KEYS = ['biolink_type', 'only_prefixes', 'exclude_prefixes', 'only_taxa'] as const;
const hasNonDefaultAdvancedOptions = computed(() =>
  ADVANCED_KEYS.some((k) => options.value[k] !== DEFAULT_NAMERES_OPTIONS[k]),
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
      <label for="terms" class="form-label">
        Search terms (one per line, use <code>[[CURIE]]</code> to annotate expected results)
      </label>
      <textarea
        id="terms"
        v-model="terms"
        class="form-control"
        rows="5"
        placeholder="asthma [[MONDO:0004979]]&#10;diabetes&#10;heart failure [[MONDO:0005252]]"
      ></textarea>
    </div>

    <!-- Instance selection — always checkboxes -->
    <div class="row mb-3">
      <div class="col-md-6">
        <label class="form-label">NameRes Instances</label>
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

        <!-- Custom URL row -->
        <div v-if="customUrlAdded !== null" class="form-check mt-1">
          <input
            id="inst-custom"
            type="checkbox"
            class="form-check-input"
            :checked="selectedUrls.has(customUrlAdded!)"
            @change="toggleUrl(customUrlAdded!)"
          />
          <label for="inst-custom" class="form-check-label d-flex align-items-center gap-1">
            <span>Custom:</span>
            <span class="text-muted small text-truncate" style="max-width: 240px">{{ customUrlAdded }}</span>
            <button
              type="button"
              class="btn-close"
              style="font-size: 0.65rem"
              aria-label="Remove custom URL"
              @click.stop="removeCustomUrl()"
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
            :disabled="!customUrlInput.trim()"
            @click="addCustomUrl()"
          >
            Add
          </button>
        </div>
      </div>
    </div>

    <!-- Simple options (always visible) -->
    <div class="mb-3 d-flex flex-wrap gap-3 align-items-end">
      <div>
        <label for="opt-limit" class="form-label small mb-0">Limit</label>
        <input
          id="opt-limit"
          v-model.number="options.limit"
          type="number"
          class="form-control form-control-sm"
          min="1"
          max="100"
          style="width: 80px"
        />
      </div>
      <div class="form-check">
        <input id="opt-autocomplete" v-model="options.autocomplete" type="checkbox" class="form-check-input" />
        <label for="opt-autocomplete" class="form-check-label">Autocomplete</label>
      </div>
      <div>
        <label for="opt-threshold" class="form-label small mb-0">Fail if in top</label>
        <input
          id="opt-threshold"
          v-model.number="threshold"
          type="number"
          class="form-control form-control-sm"
          min="1"
          max="100"
          style="width: 80px"
        />
      </div>
    </div>

    <!-- Advanced API options -->
    <details class="mb-3" :open="hasNonDefaultAdvancedOptions">
      <summary class="text-muted small" style="cursor: pointer">Advanced options</summary>
      <div class="d-flex flex-wrap gap-3 mt-2 align-items-end">
        <div>
          <label for="opt-biolink-type" class="form-label small mb-0">Biolink Type</label>
          <input
            id="opt-biolink-type"
            v-model="options.biolink_type"
            type="text"
            class="form-control form-control-sm"
            placeholder="e.g. Disease"
            style="width: 160px"
          />
        </div>
        <div>
          <label for="opt-only-prefixes" class="form-label small mb-0">Only Prefixes</label>
          <input
            id="opt-only-prefixes"
            v-model="options.only_prefixes"
            type="text"
            class="form-control form-control-sm"
            placeholder="e.g. MONDO,HP"
            style="width: 160px"
          />
        </div>
        <div>
          <label for="opt-exclude-prefixes" class="form-label small mb-0">Exclude Prefixes</label>
          <input
            id="opt-exclude-prefixes"
            v-model="options.exclude_prefixes"
            type="text"
            class="form-control form-control-sm"
            placeholder="e.g. UMLS"
            style="width: 160px"
          />
        </div>
        <div>
          <label for="opt-only-taxa" class="form-label small mb-0">Only Taxa</label>
          <input
            id="opt-only-taxa"
            v-model="options.only_taxa"
            type="text"
            class="form-control form-control-sm"
            placeholder="e.g. NCBITaxon:9606"
            style="width: 180px"
          />
        </div>
      </div>
    </details>

    <!-- Action buttons -->
    <div class="d-flex align-items-center gap-2 flex-wrap">
      <button type="submit" class="btn btn-primary" :disabled="loading">
        <span v-if="loading" class="spinner-border spinner-border-sm me-1" role="status"></span>
        {{ loading ? 'Looking up…' : 'Lookup' }}
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
