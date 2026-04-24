<script setup lang="ts">
import { computed, watch } from 'vue';
import type { NameResInstance, NameResApiOptions } from '../../lib/nameres-types';
import InstanceSelector from '../shared/InstanceSelector.vue';
import ExpectedCuriePanel from './ExpectedCuriePanel.vue';
import {
  AUTOCOMPLETE_PRESETS,
  detectPreset,
  getPreset,
} from '../../lib/autocomplete-presets';
import type { AutocompletePresetId } from '../../lib/autocomplete-presets';
import {
  ALLOWED_DEBOUNCE_MS,
  DEFAULT_AUTOCOMPLETE_OPTIONS,
} from '../../lib/autocomplete-url-state';
import type { DebounceMs } from '../../lib/autocomplete-url-state';
import type { NameResResult } from '../../lib/nameres-types';

interface InstanceState {
  results: NameResResult[];
  deepResults?: NameResResult[];
}

const props = defineProps<{
  instances: NameResInstance[];
  query: string;
  preset: AutocompletePresetId;
  options: NameResApiOptions;
  selectedUrls: string[];
  expected: string[];
  expectedRaw: string;
  debounceMs: DebounceMs;
  highlight: boolean;
  initialTargets?: string[];
  checking: boolean;
  perInstance: Map<string, InstanceState>;
  queriedInstances: NameResInstance[];
  prefixMap: Record<string, string>;
  hasDeepResults: boolean;
}>();

const emit = defineEmits<{
  'update:query': [value: string];
  'update:preset': [value: AutocompletePresetId];
  'update:options': [value: NameResApiOptions];
  'update:selectedUrls': [value: string[]];
  'update:expectedRaw': [value: string];
  'update:debounceMs': [value: DebounceMs];
  'update:highlight': [value: boolean];
  check: [];
  share: [];
  stop: [];
}>();

const anyInFlight = computed(() => {
  for (const s of props.perInstance.values()) {
    if ((s as InstanceState & { inFlight?: boolean }).inFlight) return true;
  }
  return false;
});

function onQueryInput(e: Event) {
  emit('update:query', (e.target as HTMLInputElement).value);
}

function onPresetChange(e: Event) {
  const id = (e.target as HTMLSelectElement).value as AutocompletePresetId;
  const preset = getPreset(id);
  emit('update:preset', id);
  // Changing the preset writes only biolink_type and only_prefixes.
  if (id !== 'custom') {
    emit('update:options', {
      ...props.options,
      biolink_type: preset.biolink_type,
      only_prefixes: preset.only_prefixes,
    });
  }
}

function onOptionChange<K extends keyof NameResApiOptions>(key: K, value: NameResApiOptions[K]) {
  const next = { ...props.options, [key]: value };
  emit('update:options', next);
}

// When the user hand-edits biolink_type / only_prefixes, recompute the preset
// so the dropdown reflects the user's actual state.
watch(
  () => [props.options.biolink_type, props.options.only_prefixes],
  ([bt, op]) => {
    const detected = detectPreset(bt as string, op as string);
    if (detected !== props.preset) emit('update:preset', detected);
  },
);

const hasNonDefaultAdvancedApi = computed(
  () =>
    props.options.exclude_prefixes !== DEFAULT_AUTOCOMPLETE_OPTIONS.exclude_prefixes ||
    props.options.only_taxa !== DEFAULT_AUTOCOMPLETE_OPTIONS.only_taxa ||
    props.options.autocomplete !== DEFAULT_AUTOCOMPLETE_OPTIONS.autocomplete ||
    props.debounceMs !== 150 ||
    !props.highlight,
);

// Copy page URL as "Share" button feedback.
function onShare() {
  emit('share');
}
</script>

<template>
  <form @submit.prevent>
    <!-- Query line: preset + query input -->
    <div class="row g-2 mb-3 align-items-end">
      <div class="col-md-3">
        <label for="ac-preset" class="form-label small mb-0">Preset</label>
        <select
          id="ac-preset"
          class="form-select form-select-sm"
          :value="preset"
          @change="onPresetChange"
        >
          <option v-for="p in AUTOCOMPLETE_PRESETS" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </div>
      <div class="col-md-9">
        <label for="ac-query" class="form-label small mb-0">
          Query (fires live as you type)
        </label>
        <div class="d-flex align-items-center gap-2">
          <input
            id="ac-query"
            type="text"
            class="form-control"
            :value="query"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            placeholder="Start typing, e.g. “diabe”"
            @input="onQueryInput"
          />
          <span v-if="anyInFlight" class="spinner-border spinner-border-sm text-secondary" role="status"></span>
        </div>
      </div>
    </div>

    <!-- Second row: instances + basic params -->
    <div class="row g-3 mb-3">
      <div class="col-md-6">
        <label class="form-label small mb-0 fw-semibold">NameRes Instances</label>
        <InstanceSelector
          :instances="instances"
          :model-value="selectedUrls"
          :initial-targets="initialTargets"
          @update:model-value="(v) => emit('update:selectedUrls', v)"
        />
      </div>
      <div class="col-md-6">
        <ExpectedCuriePanel
          :expected="expected"
          :expected-raw="expectedRaw"
          :per-instance="perInstance"
          :queried-instances="queriedInstances"
          :prefix-map="prefixMap"
          :checking="checking"
          :can-check="expected.length > 0 && !!query.trim() && selectedUrls.length > 0"
          :has-deep-results="hasDeepResults"
          @update:expected-raw="(v) => emit('update:expectedRaw', v)"
          @check="emit('check')"
        />
      </div>
    </div>

    <!-- Basic options line -->
    <div class="mb-3 d-flex flex-wrap gap-3 align-items-end">
      <div>
        <label for="ac-limit" class="form-label small mb-0">Limit (top-N)</label>
        <input
          id="ac-limit"
          type="number"
          class="form-control form-control-sm"
          min="1"
          max="100"
          style="width: 90px"
          :value="options.limit"
          @change="(e) => onOptionChange('limit', parseInt((e.target as HTMLInputElement).value, 10) || 1)"
        />
      </div>
      <div>
        <label for="ac-biolink" class="form-label small mb-0">Biolink Type</label>
        <input
          id="ac-biolink"
          type="text"
          class="form-control form-control-sm"
          style="width: 220px"
          :value="options.biolink_type"
          placeholder="e.g. Gene"
          @input="(e) => onOptionChange('biolink_type', (e.target as HTMLInputElement).value)"
        />
      </div>
      <div>
        <label for="ac-only" class="form-label small mb-0">Only Prefixes</label>
        <input
          id="ac-only"
          type="text"
          class="form-control form-control-sm"
          style="width: 220px"
          :value="options.only_prefixes"
          placeholder="e.g. MONDO|HP"
          @input="(e) => onOptionChange('only_prefixes', (e.target as HTMLInputElement).value)"
        />
      </div>
    </div>

    <!-- Advanced options -->
    <details class="mb-3" :open="hasNonDefaultAdvancedApi">
      <summary class="text-muted small" style="cursor: pointer">Advanced options</summary>
      <div class="d-flex flex-wrap gap-3 mt-2 align-items-end">
        <div>
          <label for="ac-debounce" class="form-label small mb-0">Debounce (ms)</label>
          <select
            id="ac-debounce"
            class="form-select form-select-sm"
            style="width: 100px"
            :value="debounceMs"
            @change="(e) => emit('update:debounceMs', parseInt((e.target as HTMLSelectElement).value, 10) as DebounceMs)"
          >
            <option v-for="ms in ALLOWED_DEBOUNCE_MS" :key="ms" :value="ms">{{ ms }}</option>
          </select>
        </div>
        <div class="form-check mb-1">
          <input
            id="ac-autocomplete"
            type="checkbox"
            class="form-check-input"
            :checked="options.autocomplete"
            @change="(e) => onOptionChange('autocomplete', (e.target as HTMLInputElement).checked)"
          />
          <label for="ac-autocomplete" class="form-check-label">autocomplete=true</label>
        </div>
        <div class="form-check mb-1">
          <input
            id="ac-highlight"
            type="checkbox"
            class="form-check-input"
            :checked="highlight"
            @change="(e) => emit('update:highlight', (e.target as HTMLInputElement).checked)"
          />
          <label for="ac-highlight" class="form-check-label">Render highlighting</label>
        </div>
        <div>
          <label for="ac-exclude" class="form-label small mb-0">Exclude Prefixes</label>
          <input
            id="ac-exclude"
            type="text"
            class="form-control form-control-sm"
            style="width: 180px"
            :value="options.exclude_prefixes"
            placeholder="e.g. UMLS"
            @input="(e) => onOptionChange('exclude_prefixes', (e.target as HTMLInputElement).value)"
          />
        </div>
        <div>
          <label for="ac-taxa" class="form-label small mb-0">Only Taxa</label>
          <input
            id="ac-taxa"
            type="text"
            class="form-control form-control-sm"
            style="width: 200px"
            :value="options.only_taxa"
            placeholder="e.g. NCBITaxon:9606"
            @input="(e) => onOptionChange('only_taxa', (e.target as HTMLInputElement).value)"
          />
        </div>
      </div>
    </details>

    <div class="d-flex align-items-center gap-2 flex-wrap">
      <button type="button" class="btn btn-sm btn-outline-secondary" @click="onShare">
        Copy link
      </button>
      <button
        v-if="anyInFlight"
        type="button"
        class="btn btn-sm btn-outline-secondary"
        @click="emit('stop')"
      >
        Cancel in-flight
      </button>
    </div>
  </form>
</template>
