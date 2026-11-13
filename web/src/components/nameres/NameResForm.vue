<script setup lang="ts">
import { ref, computed } from 'vue';
import type { NameResInstance, NameResApiOptions } from '../../lib/nameres-types';
import { DEFAULT_NAMERES_OPTIONS } from '../../lib/nameres-types';
import { isValidResultCount, MAX_RESULT_COUNT } from '../../lib/nameres-api';
import InstanceSelector from '../shared/InstanceSelector.vue';
import { useShareLink } from '../../lib/use-share-link';

const DEFAULT_TERMS = 'asthma [[MONDO:0004979]]\ndiabetes type 2 [[MONDO:0005148]]\ndiabetes\nheart failure';

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
}>();

// Form state
const terms = ref(props.initialTerms ?? DEFAULT_TERMS);
const options = ref<NameResApiOptions>({ ...DEFAULT_NAMERES_OPTIONS, ...props.initialOptions });

/**
 * "Fail if in top" follows the Limit until the user (or a share link) sets it, so
 * raising the Limit to 20 also checks ranks 6–20 rather than leaving the threshold at
 * the old 5. Copying the Limit once at start-up is what the form used to do.
 */
const thresholdOverride = ref<number | undefined>(props.initialThreshold);
const threshold = computed<number>({
  get: () => thresholdOverride.value ?? options.value.limit,
  set: (value) => {
    thresholdOverride.value = value;
  },
});

// Instance selection driven by InstanceSelector via v-model
const selectedUrls = ref<string[]>([]);

// Share button: copies the page URL, then says "✓ Copied!" or "Copy failed" for a moment
const { shareStatus, share } = useShareLink();

// An emptied or out-of-range box is marked invalid and blocks the lookup.
const limitValid = computed(() => isValidResultCount(options.value.limit));
/** The largest threshold allowed: no more than the results the Limit fetches. */
const thresholdMax = computed(() => (limitValid.value ? options.value.limit : MAX_RESULT_COUNT));
// A threshold that follows the Limit is only as wrong as the Limit, which is marked
// already. One above the Limit would ask about ranks that were never fetched, and
// report an expected CURIE at one of them as "not found".
const thresholdValid = computed(
  () =>
    thresholdOverride.value === undefined ||
    (isValidResultCount(threshold.value) && threshold.value <= thresholdMax.value),
);

function onSubmit() {
  if (!terms.value.trim()) return;
  if (selectedUrls.value.length === 0) return;
  if (!limitValid.value || !thresholdValid.value) return;
  emit('submit', {
    rawTerms: terms.value,
    instanceUrls: [...selectedUrls.value],
    options: { ...options.value },
    threshold: threshold.value,
  });
}

// Open "Advanced options" when the form starts with any of them changed, so a share
// link's settings are visible. Decided once: binding :open to a live computed would
// snap the section shut under the user the moment they restored the defaults.
const ADVANCED_KEYS = ['biolink_type', 'only_prefixes', 'exclude_prefixes', 'only_taxa'] as const;
const advancedInitiallyOpen = ADVANCED_KEYS.some(
  (k) => options.value[k] !== DEFAULT_NAMERES_OPTIONS[k],
);
</script>

<template>
  <!-- novalidate: the browser's own check on InstanceSelector's custom-URL box would
       otherwise block the search whenever that box holds a half-typed URL. -->
  <form novalidate @submit.prevent="onSubmit">
    <div class="mb-3">
      <label for="terms" class="form-label">
        Search terms (one per line, use <code>[[CURIE]]</code> to annotate expected results)
      </label>
      <textarea
        id="terms"
        v-model="terms"
        class="form-control"
        rows="5"
        placeholder="asthma [[MONDO:0004979]]&#10;diabetes type 2 [[MONDO:0005148]]&#10;diabetes&#10;heart failure"
      ></textarea>
    </div>

    <!-- Instance selection -->
    <div class="row mb-3">
      <div class="col-md-6">
        <label class="form-label">NameRes Instances</label>
        <InstanceSelector
          service="nameres"
          :instances="instances"
          v-model="selectedUrls"
          :initial-targets="initialTargets"
        />
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
          :class="{ 'is-invalid': !limitValid }"
          min="1"
          :max="MAX_RESULT_COUNT"
          style="width: 80px"
        />
        <div class="invalid-feedback">1–{{ MAX_RESULT_COUNT }}</div>
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
          :class="{ 'is-invalid': !thresholdValid }"
          min="1"
          :max="thresholdMax"
          style="width: 80px"
        />
        <div class="invalid-feedback">1–{{ thresholdMax }}</div>
      </div>
    </div>

    <!-- Advanced API options -->
    <details class="mb-3" :open="advancedInitiallyOpen">
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
        <!-- NameRes's /lookup takes pipe-separated lists for these three (its OpenAPI
             docs: "e.g. `MONDO|EFO`"); the values are sent unchanged, so a comma would
             be read as part of a single prefix and filter everything out. -->
        <div>
          <label for="opt-only-prefixes" class="form-label small mb-0">Only Prefixes</label>
          <input
            id="opt-only-prefixes"
            v-model="options.only_prefixes"
            type="text"
            class="form-control form-control-sm"
            placeholder="e.g. MONDO|HP"
            title="Pipe-separated, case-sensitive"
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
            placeholder="e.g. UMLS|EFO"
            title="Pipe-separated, case-sensitive"
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
            title="Pipe-separated"
            style="width: 180px"
          />
        </div>
      </div>
    </details>

    <!-- Action buttons -->
    <div class="d-flex align-items-center gap-2 flex-wrap">
      <button type="submit" class="btn btn-primary" :disabled="loading || !limitValid || !thresholdValid">
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
        @click="share"
      >
        {{ shareStatus ?? 'Share' }}
      </button>
    </div>
  </form>
</template>
