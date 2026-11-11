<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { NameResResult, NameResInstance, NameResApiOptions, ParsedSearchTerm } from '../../lib/nameres-types';
import { DEFAULT_NAMERES_OPTIONS } from '../../lib/nameres-types';
import { parseSearchTerms, fetchNameResLookup } from '../../lib/nameres-api';
import { readNameResQueryState, buildNameResQueryUrl } from '../../lib/nameres-url-state';
import NameResForm from './NameResForm.vue';
import NameResComparisonView from './NameResComparisonView.vue';
import NameResResultsSummary from './NameResResultsSummary.vue';
import { buildInstances, instanceForUrl, resolveTarget, resolveTargets, urlToTarget } from '../../lib/instances';
import { initialSelection } from '../../lib/instance-prefs';
import endpoints from '../../../../config/translator-endpoints.json';

const instances: NameResInstance[] = buildInstances('NameRes', endpoints.nameres);

// State
const loading = ref(false);
const error = ref<string | null>(null);
const queriedTerms = ref<ParsedSearchTerm[]>([]);
const threshold = ref(DEFAULT_NAMERES_OPTIONS.limit);

// Read URL state synchronously so NameResForm receives correct initial values
const urlState = typeof window !== 'undefined' ? readNameResQueryState() : null;
/** Targets in the page URL that are neither known instances nor http(s) URLs. */
const ignoredTargets = ref<string[]>(
  urlState?.targets.filter((t) => resolveTarget(instances, t) === null) ?? [],
);
const initialTerms = ref<string | undefined>(
  urlState?.terms.length ? urlState.terms.join('\n') : undefined,
);
const initialTargets = ref<string[] | undefined>(
  urlState?.targets.length ? urlState.targets : undefined,
);
const initialOptions = ref<Partial<NameResApiOptions> | undefined>(
  urlState?.options && Object.keys(urlState.options).length ? urlState.options : undefined,
);
const initialThreshold = ref<number | undefined>(urlState?.threshold);

// Results: instanceUrl → searchText → results array
const resultsByInstance = ref<Map<string, Map<string, NameResResult[]>>>(new Map());
const queriedInstances = ref<NameResInstance[]>([]);
const hasResults = computed(() => resultsByInstance.value.size > 0);

// Abort controller for in-flight requests
let abortController: AbortController | null = null;

onMounted(async () => {
  if (urlState?.terms.length) {
    const resolved = resolveTargets(instances, urlState.targets);
    // A link naming only unusable targets would otherwise silently query another
    // instance; the warning explains why nothing ran.
    if (urlState.targets.length > 0 && resolved.length === 0) return;
    // No targets in the link: the same instances the form starts with ticked.
    const instanceUrls = resolved.length > 0 ? resolved : initialSelection(instances);
    const opts = { ...DEFAULT_NAMERES_OPTIONS, ...urlState.options };
    const thresh = urlState.threshold ?? opts.limit;
    await handleSubmit({
      rawTerms: urlState.terms.join('\n'),
      instanceUrls,
      options: opts,
      threshold: thresh,
    });
  }
});

function stopQuery() {
  abortController?.abort();
}

async function handleShare() {
  await navigator.clipboard.writeText(window.location.href);
}

function handleExport() {
  const data: Record<string, Record<string, NameResResult[]>> = {};
  for (const term of queriedTerms.value) {
    data[term.text] = {};
    for (const inst of queriedInstances.value) {
      data[term.text][inst.name] = resultsByInstance.value.get(inst.url)?.get(term.text) ?? [];
    }
  }
  const payload = {
    queried_terms: queriedTerms.value.map((t) => ({ text: t.text, expectedCuries: t.expectedCuries })),
    instances: queriedInstances.value.map((i) => i.name),
    results: data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nameres.json';
  a.click();
  URL.revokeObjectURL(url);
}

function onFormSubmit(payload: Parameters<typeof handleSubmit>[0]) {
  ignoredTargets.value = [];
  void handleSubmit(payload);
}

async function handleSubmit(payload: {
  rawTerms: string;
  instanceUrls: string[];
  options: NameResApiOptions;
  threshold: number;
}) {
  const terms = parseSearchTerms(payload.rawTerms);
  if (terms.length === 0) {
    error.value = 'No valid search terms provided.';
    return;
  }

  abortController = new AbortController();
  const { signal } = abortController;

  loading.value = true;
  error.value = null;
  resultsByInstance.value = new Map();
  queriedTerms.value = terms;
  threshold.value = payload.threshold;

  try {
    // Build all (instance, term) fetch promises
    const jobs: { instanceUrl: string; text: string; promise: Promise<NameResResult[]> }[] = [];
    for (const instanceUrl of payload.instanceUrls) {
      for (const term of terms) {
        jobs.push({
          instanceUrl,
          text: term.text,
          promise: fetchNameResLookup(instanceUrl, term.text, payload.options, signal),
        });
      }
    }

    const settled = await Promise.allSettled(jobs.map((j) => j.promise));

    const resultMap = new Map<string, Map<string, NameResResult[]>>();
    const errors: string[] = [];

    for (let i = 0; i < jobs.length; i++) {
      const { instanceUrl, text } = jobs[i];
      const result = settled[i];

      if (!resultMap.has(instanceUrl)) {
        resultMap.set(instanceUrl, new Map());
      }

      if (result.status === 'fulfilled') {
        resultMap.get(instanceUrl)!.set(text, result.value);
      } else {
        if ((result.reason as Error)?.name !== 'AbortError') {
          errors.push(`${instanceForUrl(instances, instanceUrl).name} / "${text}": ${result.reason}`);
        }
        resultMap.get(instanceUrl)!.set(text, []);
      }
    }

    resultsByInstance.value = resultMap;
    queriedInstances.value = payload.instanceUrls.map((url) => instanceForUrl(instances, url));

    if (errors.length > 0) {
      error.value = `Some lookups failed: ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? ` (+${errors.length - 5} more)` : ''}`;
    }

    // Update URL to reflect the submitted query (only if not aborted)
    if (!signal.aborted) {
      const rawTerms = terms.map((t) => t.raw);
      const targets = payload.instanceUrls.map((url) => urlToTarget(instances, url));
      window.history.replaceState(
        null,
        '',
        buildNameResQueryUrl(rawTerms, targets, payload.options, payload.threshold),
      );
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      // User clicked Stop — clear loading silently
    } else {
      error.value = e instanceof Error ? e.message : String(e);
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="card mb-4">
    <div class="card-header">Query</div>
    <div class="card-body">
      <NameResForm
        :instances="instances"
        :loading="loading"
        :has-results="hasResults"
        :initial-terms="initialTerms"
        :initial-targets="initialTargets"
        :initial-options="initialOptions"
        :initial-threshold="initialThreshold"
        @submit="onFormSubmit"
        @stop="stopQuery"
        @share="handleShare"
      />
    </div>
  </div>

  <div v-if="ignoredTargets.length" class="alert alert-warning">
    Ignored {{ ignoredTargets.length === 1 ? 'a target' : 'targets' }} in the link that
    {{ ignoredTargets.length === 1 ? 'is' : 'are' }} neither a known instance nor an http(s)
    URL: {{ ignoredTargets.join(', ') }}
  </div>
  <div v-if="error" class="alert alert-danger">{{ error }}</div>

  <div v-if="resultsByInstance.size > 0" class="card">
    <div class="card-header d-flex align-items-center justify-content-between flex-wrap gap-2">
      <span>
        Results — {{ queriedTerms.length }} term{{ queriedTerms.length !== 1 ? 's' : '' }},
        {{ queriedInstances.length }} instance{{ queriedInstances.length !== 1 ? 's' : '' }}
      </span>
    </div>
    <div class="card-body">
      <NameResResultsSummary
        :results-by-instance="resultsByInstance"
        :queried-instances="queriedInstances"
        :terms="queriedTerms"
        :threshold="threshold"
      />
      <NameResComparisonView
        :results-by-instance="resultsByInstance"
        :queried-instances="queriedInstances"
        :terms="queriedTerms"
        :threshold="threshold"
      />
    </div>
    <div class="card-footer">
      <button type="button" class="btn btn-sm btn-outline-secondary" @click="handleExport">
        Download JSON
      </button>
    </div>
  </div>
</template>
