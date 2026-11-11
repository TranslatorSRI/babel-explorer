<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { rememberSelection, savePrefs, initialSelection, PRIMARY_ENVS } from '../../lib/instance-prefs';
import { findInstance, normalizeInstanceUrl, resolveTarget, urlToTarget, type Instance } from '../../lib/instances';

/**
 * Short, environment-level display names used inside the selector.
 * The full "NodeNorm Dev" / "NameRes Dev" names are kept on the instance
 * objects for use in result tables (ComparisonView column headers, etc.).
 */
const ENV_LABELS: Record<string, string> = {
  exp: 'RENCI Experimental',
  dev: 'RENCI Dev',
  ci: 'ITRB CI',
  test: 'ITRB Test',
  prod: 'ITRB Prod',
};

const props = defineProps<{
  /**
   * The service these instances belong to ('nodenorm', 'nameres'). Remembered custom
   * URLs are kept per service, so one tool's custom server never becomes another's.
   */
  service: string;
  /** Full list of known instances (dev, exp, ci, test, prod). */
  instances: Instance[];
  /** Currently selected URLs — parent binds this via v-model. */
  modelValue: string[];
  /**
   * Env keys or raw URLs from URL state (e.g. ['dev', 'prod']).
   * Takes priority over the session's and the saved selection. Only used on mount.
   */
  initialTargets?: string[];
}>();

const emit = defineEmits<{
  'update:modelValue': [urls: string[]];
}>();

// ─── Initialization ──────────────────────────────────────────────────────────

// Resolved through lib/instances, so a target that is not an http(s) URL never gets a
// checkbox, whether it came from a share link or from saved preferences.
const initUrls = initialSelection(props.service, props.instances, props.initialTargets);

const selectedUrls = ref<Set<string>>(new Set(initUrls));
// Every selected URL that isn't a known instance gets its own row and checkbox, so
// nothing can stay selected without a way to untick it.
const customUrls = ref<string[]>(initUrls.filter((u) => !findInstance(props.instances, u)));
const customUrlInput = ref('');
const customUrlValid = computed(() => normalizeInstanceUrl(customUrlInput.value) !== null);
const savedFlash = ref(false);

/** True if any non-primary (extended) env or a custom URL is in the selection. */
function hasExtendedSelection(urls: Set<string>): boolean {
  for (const url of urls) {
    const inst = findInstance(props.instances, url);
    if (!inst || !PRIMARY_ENVS.has(inst.env)) return true;
  }
  return false;
}

const showExtended = ref(hasExtendedSelection(selectedUrls.value));

/** The selection as targets: env keys for known instances, URLs for custom ones. */
function selectionTargets(): string[] {
  return [...selectedUrls.value].map((url) => urlToTarget(props.instances, url));
}

// ─── Reactivity ──────────────────────────────────────────────────────────────

/**
 * On every selection change: remember it for this tab's session (so the next tool
 * opened in the tab starts with the same environments) and emit to the parent v-model.
 * immediate: true also emits the initial value on mount.
 */
watch(
  selectedUrls,
  (urls) => {
    rememberSelection(props.service, selectionTargets());
    emit('update:modelValue', [...urls]);
  },
  { immediate: true },
);

// ─── Computed ────────────────────────────────────────────────────────────────

const primaryInstances = computed(() =>
  props.instances.filter((i) => PRIMARY_ENVS.has(i.env)),
);

const extendedInstances = computed(() =>
  props.instances.filter((i) => !PRIMARY_ENVS.has(i.env)),
);

// ─── Methods ─────────────────────────────────────────────────────────────────

function toggleUrl(url: string) {
  const next = new Set(selectedUrls.value);
  if (next.has(url)) {
    next.delete(url);
  } else {
    next.add(url);
  }
  selectedUrls.value = next;
}

function selectAll() {
  selectedUrls.value = new Set([...props.instances.map((i) => i.url), ...customUrls.value]);
  showExtended.value = true;
}

function selectPrimary() {
  selectedUrls.value = new Set(primaryInstances.value.map((i) => i.url));
}

function selectNone() {
  selectedUrls.value = new Set();
}

function addCustomUrl() {
  const url = resolveTarget(props.instances, customUrlInput.value);
  if (url === null) return;
  // A known instance typed as a URL (with or without its trailing slash) ticks that
  // instance rather than adding a second row for the same server.
  if (!findInstance(props.instances, url) && !customUrls.value.includes(url)) {
    customUrls.value = [...customUrls.value, url];
  }
  selectedUrls.value = new Set(selectedUrls.value).add(url);
  customUrlInput.value = '';
}

function removeCustomUrl(url: string) {
  customUrls.value = customUrls.value.filter((u) => u !== url);
  const next = new Set(selectedUrls.value);
  next.delete(url);
  selectedUrls.value = next;
}

function saveDefault() {
  savePrefs(props.service, selectionTargets());
  savedFlash.value = true;
  setTimeout(() => {
    savedFlash.value = false;
  }, 2000);
}
</script>

<template>
  <!-- Quick-select presets -->
  <div class="mb-2 d-flex align-items-center gap-1">
    <span class="text-muted small">Select:</span>
    <button type="button" class="btn btn-link btn-sm py-0 px-1" @click="selectAll">All</button>
    <span class="text-muted small">·</span>
    <button type="button" class="btn btn-link btn-sm py-0 px-1" @click="selectPrimary">Primary</button>
    <span class="text-muted small">·</span>
    <button type="button" class="btn btn-link btn-sm py-0 px-1" @click="selectNone">None</button>
  </div>

  <!-- Primary instances (always visible) -->
  <div v-for="inst in primaryInstances" :key="inst.url" class="form-check">
    <input
      :id="`inst-${inst.env}`"
      type="checkbox"
      class="form-check-input"
      :checked="selectedUrls.has(inst.url)"
      @change="toggleUrl(inst.url)"
    />
    <label :for="`inst-${inst.env}`" class="form-check-label" :title="inst.url">
      {{ ENV_LABELS[inst.env] ?? inst.name }}
    </label>
  </div>

  <!-- Extended environments disclosure -->
  <details
    :open="showExtended"
    class="mt-1"
    @toggle="showExtended = ($event.target as HTMLDetailsElement).open"
  >
    <summary class="text-muted small" style="cursor: pointer">
      Extended environments
      <span class="text-muted" style="font-size: 0.8em; opacity: 0.75">
        (Exp → Dev → CI → Test → Prod pipeline)
      </span>
    </summary>

    <div class="mt-1 ms-1">
      <!-- Extended instances -->
      <div v-for="inst in extendedInstances" :key="inst.url" class="form-check">
        <input
          :id="`inst-${inst.env}`"
          type="checkbox"
          class="form-check-input"
          :checked="selectedUrls.has(inst.url)"
          @change="toggleUrl(inst.url)"
        />
        <label :for="`inst-${inst.env}`" class="form-check-label" :title="inst.url">
          {{ ENV_LABELS[inst.env] ?? inst.name }}
        </label>
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
          <span class="text-muted small text-truncate" style="max-width: 220px">{{ url }}</span>
          <button
            type="button"
            class="btn-close"
            style="font-size: 0.65rem"
            aria-label="Remove custom URL"
            @click.stop="removeCustomUrl(url)"
          ></button>
        </label>
      </div>

      <!-- Add custom URL input -->
      <div class="mt-2 d-flex gap-2 align-items-center">
        <input
          v-model="customUrlInput"
          type="url"
          class="form-control form-control-sm"
          placeholder="Add custom URL…"
          style="max-width: 260px"
          @keydown.enter.prevent="addCustomUrl()"
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
  </details>

  <!-- Save as default -->
  <div class="mt-1">
    <button
      type="button"
      class="btn btn-link btn-sm text-muted p-0"
      style="font-size: 0.8em"
      @click="saveDefault()"
    >
      {{ savedFlash ? '✓ Saved as default' : 'Save as default' }}
    </button>
  </div>
</template>
