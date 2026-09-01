<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { NameResResult, NameResInstance, NameResApiOptions, ParsedSearchTerm } from '../../lib/nameres-types';
import { DEFAULT_NAMERES_OPTIONS } from '../../lib/nameres-types';
import { parseSearchTerms, fetchNameResLookup } from '../../lib/nameres-api';
import { loadPrefixMap } from '../../lib/curie-links';
import { readNameResQueryState, buildNameResQueryUrl } from '../../lib/nameres-url-state';
import NameResForm from './NameResForm.vue';
import NameResComparisonView from './NameResComparisonView.vue';
import NameResResultsSummary from './NameResResultsSummary.vue';
import endpoints from '../../../../config/translator-endpoints.json';

// Build instance list from shared config
const ENV_LABELS: Record<string, string> = {
  dev: 'Dev',
  exp: 'Exp',
  ci: 'CI',
  test: 'Test',
  prod: 'Production',
};

const instances: NameResInstance[] = Object.entries(endpoints.nameres).map(
  ([env, url]) => ({
    name: `NameRes ${ENV_LABELS[env] ?? env}`,
    env,
    url: url as string,
  }),
);

/** Resolve a target (env key or full URL) to an instance URL. */
function resolveTarget(target: string): string {
  return instances.find((i) => i.env === target || i.url === target)?.url ?? target;
}

/** Convert instance URLs back to env keys (or full URL if custom) for the URL bar. */
function urlsToTargets(urls: string[]): string[] {
  return urls.map((url) => instances.find((i) => i.url === url)?.env ?? url);
}

// State
const loading = ref(false);
const error = ref<string | null>(null);
const queriedTerms = ref<ParsedSearchTerm[]>([]);
const threshold = ref(DEFAULT_NAMERES_OPTIONS.limit);
const prefixMap = ref<Record<string, string>>({});

// Read URL state synchronously so NameResForm receives correct initial values
const urlState = typeof window !== 'undefined' ? readNameResQueryState() : null;
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
  prefixMap.value = await loadPrefixMap();

  if (urlState?.terms.length) {
    const instanceUrls = urlState.targets.length > 0
      ? urlState.targets.map(resolveTarget)
      : [instances[0].url];
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
          const inst = instances.find((inst) => inst.url === instanceUrl);
          errors.push(`${inst?.name ?? instanceUrl} / "${text}": ${result.reason}`);
        }
        resultMap.get(instanceUrl)!.set(text, []);
      }
    }

    resultsByInstance.value = resultMap;
    queriedInstances.value = payload.instanceUrls
      .map((url) => instances.find((inst) => inst.url === url) ?? { name: url, env: url, url })
      .filter((inst): inst is NameResInstance => inst != null);

    if (errors.length > 0) {
      error.value = `Some lookups failed: ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? ` (+${errors.length - 5} more)` : ''}`;
    }

    // Update URL to reflect the submitted query (only if not aborted)
    if (!signal.aborted) {
      const rawTerms = terms.map((t) => t.raw);
      const targets = urlsToTargets(payload.instanceUrls);
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
        @submit="handleSubmit"
        @stop="stopQuery"
        @share="handleShare"
      />
    </div>
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
        :prefix-map="prefixMap"
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
