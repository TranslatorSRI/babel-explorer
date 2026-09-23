<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { sessionPrefs, savePrefs, loadPrefs } from '../../lib/instance-prefs';

/**
 * Short, environment-level display names used inside the selector.
 * The full "NodeNorm Dev" / "NameRes Dev" names are kept on the instance
 * objects for use in result tables (ComparisonView column headers, etc.).
 */
const ENV_LABELS: Record<string, string> = {
  exp:      'RENCI Experimental',
  dev:      'RENCI Dev',
  ci:       'ITRB CI',
  es_ci:    'ITRB ES CI',
  redis_ci: 'ITRB Redis CI',
  test:     'ITRB Test',
  prod:     'ITRB Prod',
};

/** Environments shown in the main section (always visible). */
const PRIMARY_ENVS = new Set(['dev', 'ci', 'es_ci', 'redis_ci', 'prod']);

interface Instance {
  name: string;
  env: string;
  url: string;
}

const props = defineProps<{
  /** Full list of known instances (dev, exp, ci, test, prod). */
  instances: Instance[];
  /** Currently selected URLs — parent binds this via v-model. */
  modelValue: string[];
  /**
   * Env keys or raw URLs from URL state (e.g. ['dev', 'prod']).
   * Takes priority over session/localStorage. Only used on mount.
   */
  initialTargets?: string[];
}>();

const emit = defineEmits<{
  'update:modelValue': [urls: string[]];
}>();

// ─── Initialization ──────────────────────────────────────────────────────────

/** Resolve an env key or raw URL to a full instance URL. */
function resolveTarget(t: string): string {
  return props.instances.find((i) => i.env === t || i.url === t)?.url ?? t;
}

/**
 * Resolve a saved-prefs array (env keys or custom URLs) back to
 * { urls: string[], customUrl: string | null }.
 */
function resolvePrefs(prefs: string[]): { urls: string[]; customUrl: string | null } {
  const urls: string[] = [];
  let customUrl: string | null = null;
  for (const pref of prefs) {
    const inst = props.instances.find((i) => i.env === pref || i.url === pref);
    if (inst) {
      urls.push(inst.url);
    } else {
      // Unknown item — treat as custom URL (at most one custom at a time)
      customUrl = pref;
      urls.push(pref);
    }
  }
  return { urls, customUrl };
}

/**
 * Determine the initial selection and any custom URL, using the priority:
 *   1. URL params (initialTargets prop)
 *   2. In-session prefs (sessionPrefs)
 *   3. localStorage (loadPrefs)
 *   4. First instance as default
 */
function determineInitial(): { urls: string[]; customUrl: string | null } {
  if (props.initialTargets?.length) {
    const urls = props.initialTargets.map(resolveTarget);
    const customTarget = props.initialTargets.find(
      (t) => !props.instances.find((i) => i.env === t || i.url === t),
    );
    return { urls, customUrl: customTarget ?? null };
  }
  if (sessionPrefs.value?.length) {
    return resolvePrefs(sessionPrefs.value);
  }
  const saved = loadPrefs();
  if (saved?.length) {
    return resolvePrefs(saved);
  }
  // Default: first primary instance (dev), falling back to instances[0]
  const firstPrimary = props.instances.find((i) => PRIMARY_ENVS.has(i.env));
  return { urls: [(firstPrimary ?? props.instances[0])?.url ?? ''], customUrl: null };
}

const { urls: initUrls, customUrl: initCustomUrl } = determineInitial();

const selectedUrls = ref<Set<string>>(new Set(initUrls.filter(Boolean)));
const customUrlAdded = ref<string | null>(initCustomUrl);
const customUrlInput = ref('');
const savedFlash = ref(false);

/** True if any non-primary (extended) env or a custom URL is in the selection. */
function hasExtendedSelection(urls: Set<string>): boolean {
  for (const url of urls) {
    const inst = props.instances.find((i) => i.url === url);
    if (!inst || !PRIMARY_ENVS.has(inst.env)) return true;
  }
  return false;
}

const showExtended = ref(hasExtendedSelection(selectedUrls.value));

// ─── Reactivity ──────────────────────────────────────────────────────────────

/**
 * On every selection change: update sessionPrefs (so both NodeNorm and NameRes
 * stay in sync within the session) and emit to the parent v-model.
 * immediate: true also emits the initial value on mount.
 */
watch(
  selectedUrls,
  (urls) => {
    const keys = [...urls].map(
      (url) => props.instances.find((i) => i.url === url)?.env ?? url,
    );
    sessionPrefs.value = keys;
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
  const next = new Set(props.instances.map((i) => i.url));
  if (customUrlAdded.value) next.add(customUrlAdded.value);
  selectedUrls.value = next;
  showExtended.value = true;
}

function selectPrimary() {
  selectedUrls.value = new Set(
    props.instances.filter((i) => PRIMARY_ENVS.has(i.env)).map((i) => i.url),
  );
}

function selectNone() {
  selectedUrls.value = new Set();
}

function addCustomUrl() {
  let url = customUrlInput.value.trim();
  if (!url) return;
  if (!url.endsWith('/')) url += '/';
  const next = new Set(selectedUrls.value);
  if (customUrlAdded.value) next.delete(customUrlAdded.value);
  customUrlAdded.value = url;
  next.add(url);
  selectedUrls.value = next;
  customUrlInput.value = '';
}

function removeCustomUrl() {
  if (customUrlAdded.value) {
    const next = new Set(selectedUrls.value);
    next.delete(customUrlAdded.value);
    selectedUrls.value = next;
  }
  customUrlAdded.value = null;
}

/** Returns the display HTML for an instance's checkbox label.
 *  Safe: only developer-controlled strings reach v-html. */
function labelHtml(inst: Instance): string {
  if (inst.env === 'es_ci') return 'ITRB <abbr title="ElasticSearch">ES</abbr> CI';
  if (inst.env === 'redis_ci') return 'ITRB <abbr title="Redis">Redis</abbr> CI';
  return ENV_LABELS[inst.env] ?? inst.name;
}

function saveDefault() {
  const keys = [...selectedUrls.value].map(
    (url) => props.instances.find((i) => i.url === url)?.env ?? url,
  );
  savePrefs(keys);
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
    <label :for="`inst-${inst.env}`" class="form-check-label" :title="inst.url" v-html="labelHtml(inst)" />
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
        <label :for="`inst-${inst.env}`" class="form-check-label" :title="inst.url" v-html="labelHtml(inst)" />
      </div>

      <!-- Custom URL row (shown when a custom URL has been added) -->
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
          <span class="text-muted small text-truncate" style="max-width: 220px">{{ customUrlAdded }}</span>
          <button
            type="button"
            class="btn-close"
            style="font-size: 0.65rem"
            aria-label="Remove custom URL"
            @click.stop="removeCustomUrl()"
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
          :disabled="!customUrlInput.trim()"
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
