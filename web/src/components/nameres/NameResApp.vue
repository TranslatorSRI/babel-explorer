<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import type { NameResResult, NameResInstance, NameResApiOptions, ParsedSearchTerm } from '../../lib/nameres-types';
import { DEFAULT_NAMERES_OPTIONS } from '../../lib/nameres-types';
import { parseSearchTerms, fetchNameResLookups, uniqueSearchTexts } from '../../lib/nameres-api';
import { readNameResQueryState, buildNameResQueryUrl } from '../../lib/nameres-url-state';
import NameResForm from './NameResForm.vue';
import NameResComparisonView from './NameResComparisonView.vue';
import NameResResultsSummary from './NameResResultsSummary.vue';
import { buildInstances, instanceForUrl, resolveTarget, urlToTarget } from '../../lib/instances';
import { initialSelection } from '../../lib/instance-prefs';
import endpoints from '../../../../config/translator-endpoints.json';

const instances: NameResInstance[] = buildInstances('NameRes', endpoints.nameres);

// State
const loading = ref(false);
const error = ref<string | null>(null);
/** Informational message, such as "Query stopped". */
const notice = ref<string | null>(null);
const queriedTerms = ref<ParsedSearchTerm[]>([]);
const threshold = ref(DEFAULT_NAMERES_OPTIONS.limit);

/** Targets in the page URL that are neither known instances nor http(s) URLs. */
const ignoredTargets = ref<string[]>([]);

// Read URL state synchronously so NameResForm receives correct initial values on its
// first render (before onMounted fires). A later fragment change (a pasted share link,
// or Back) replaces it and remounts the form via formKey.
const urlState = ref(readNameResQueryState());
const formKey = ref(0);
const initialTerms = computed(() =>
  urlState.value.terms.length ? urlState.value.terms.join('\n') : undefined,
);
const initialTargets = computed(() =>
  urlState.value.targets.length ? urlState.value.targets : undefined,
);
const initialOptions = computed(() =>
  Object.keys(urlState.value.options).length ? urlState.value.options : undefined,
);
const initialThreshold = computed(() => urlState.value.threshold);

// Results: instanceUrl → searchText → results array. A lookup that failed has no entry,
// so the views can tell it from one that answered with nothing.
const resultsByInstance = ref<Map<string, Map<string, NameResResult[]>>>(new Map());
const queriedInstances = ref<NameResInstance[]>([]);
const hasResults = computed(() => resultsByInstance.value.size > 0);

// Controller for the query in flight, if any. A newer query aborts the older one.
let abortController: AbortController | null = null;

/**
 * Drop the query in flight without letting it touch the page again. Clearing
 * abortController first is what does that: the aborted query then sees it no longer
 * owns the page, rather than taking the "stopped by the user" path. Stop, which the
 * user did ask for, aborts without this.
 */
function cancelQuery() {
  const controller = abortController;
  abortController = null;
  controller?.abort();
  loading.value = false;
}

/** Cancel any query and show an empty page, for a link that describes no runnable query. */
function clearQuery() {
  cancelQuery();
  resultsByInstance.value = new Map();
  resultsUrl = null;
  error.value = null;
  notice.value = null;
}

/** Run (or clear) the query that the page URL describes. */
async function applyUrlState() {
  const { terms, targets, options, threshold: linkThreshold } = urlState.value;
  const resolved = targets.map((t) => resolveTarget(instances, t));
  ignoredTargets.value = targets.filter((_, i) => resolved[i] === null);
  const instanceUrls = [...new Set(resolved.filter((u): u is string => u !== null))];

  // A link whose terms are all comments or bare annotations runs nothing either. Leaving
  // the previous results up would put them under an address bar describing this link,
  // so Share would copy a link that cannot reproduce them.
  if (parseSearchTerms(terms.join('\n')).length === 0) {
    clearQuery();
    if (terms.length > 0) error.value = 'No valid search terms provided.';
    return;
  }
  // A link naming only unusable targets would otherwise silently query another
  // instance; the warning explains why nothing ran. Clearing matters: a query still
  // running would otherwise land under that warning and overwrite the pasted link.
  if (targets.length > 0 && instanceUrls.length === 0) {
    clearQuery();
    return;
  }

  const opts = { ...DEFAULT_NAMERES_OPTIONS, ...options };
  await handleSubmit({
    rawTerms: terms.join('\n'),
    // No targets in the link: the same instances the form starts with ticked.
    instanceUrls: instanceUrls.length > 0 ? instanceUrls : initialSelection('nameres', instances),
    options: opts,
    threshold: linkThreshold ?? opts.limit,
  });
}

// The fragment the page currently reflects, so a hashchange to the URL this page
// wrote itself is not run again. Browsers fire no hashchange for replaceState, but
// happy-dom (the test DOM) does.
let shownHash = window.location.hash;

// The URL of the results on screen, put back when a query is stopped. A query started
// by a pasted link or Back has already changed the address bar, so without this Share
// would copy the stopped query's link beside the previous query's results.
let resultsUrl: string | null = null;

/** Show url in the address bar without a navigation, or a hashchange that re-runs it. */
function showUrl(url: string) {
  shownHash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
  window.history.replaceState(null, '', url);
}

// The browser does not reload for a fragment-only navigation, so a share link pasted
// into a tab already on this page, or Back, arrives only as a hashchange.
function onHashChange() {
  if (window.location.hash === shownHash) return;
  shownHash = window.location.hash;
  urlState.value = readNameResQueryState();
  formKey.value++;
  void applyUrlState();
}

onMounted(() => {
  window.addEventListener('hashchange', onHashChange);
  void applyUrlState();
});

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', onHashChange);
  cancelQuery();
});

function stopQuery() {
  abortController?.abort();
}

function handleExport() {
  // A failed lookup has no results to export; list it separately rather than writing
  // an empty array, which would read as "found nothing".
  const data: Record<string, Record<string, NameResResult[]>> = {};
  const failed: { term: string; instance: string }[] = [];
  for (const text of uniqueSearchTexts(queriedTerms.value)) {
    data[text] = {};
    for (const inst of queriedInstances.value) {
      const results = resultsByInstance.value.get(inst.url)?.get(text);
      if (results === undefined) failed.push({ term: text, instance: inst.name });
      else data[text][inst.name] = results;
    }
  }
  const payload = {
    queried_terms: queriedTerms.value.map((t) => ({ text: t.text, expectedCuries: t.expectedCuries })),
    instances: queriedInstances.value.map((i) => i.name),
    failed_lookups: failed,
    results: data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nameres.json';
  // Firefox ignores click() on a detached anchor, and Firefox and Safari read the blob
  // after click() returns, so revoking it at once can cancel the download. 40 s is the
  // delay FileSaver.js settled on.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 40_000);
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
    // Cancel any query still running: it would otherwise finish under this error and
    // leave it above results it has nothing to do with.
    cancelQuery();
    error.value = 'No valid search terms provided.';
    return;
  }

  abortController?.abort();
  const controller = new AbortController();
  abortController = controller;
  const { signal } = controller;

  // The previous results stay on screen until this query replaces them, so Stop can
  // fall back to them.
  loading.value = true;
  error.value = null;
  notice.value = null;

  try {
    // Each instance in parallel, a few lookups at a time on each. Two lines with the
    // same text but different expected CURIEs share one lookup.
    const texts = uniqueSearchTexts(terms);
    const settledByInstance = await Promise.all(
      payload.instanceUrls.map((url) => fetchNameResLookups(url, texts, payload.options, signal)),
    );

    // A newer query replaced this one; it owns the page now.
    if (abortController !== controller) return;

    // Stopped: leave the previous query's results, and the URL that describes them,
    // in place rather than a table of half-finished lookups.
    if (signal.aborted) {
      if (resultsUrl !== null) showUrl(resultsUrl);
      notice.value = hasResults.value
        ? 'Query stopped. Showing the results of the previous query.'
        : 'Query stopped.';
      return;
    }

    const resultMap = new Map<string, Map<string, NameResResult[]>>();
    const errors: string[] = [];

    payload.instanceUrls.forEach((instanceUrl, i) => {
      const byText = new Map<string, NameResResult[]>();
      resultMap.set(instanceUrl, byText);
      texts.forEach((text, j) => {
        const result = settledByInstance[i][j];
        if (result.status === 'fulfilled') {
          byText.set(text, result.value);
        } else {
          errors.push(`${instanceForUrl(instances, instanceUrl).name} / "${text}": ${result.reason}`);
        }
      });
    });

    resultsByInstance.value = resultMap;
    queriedTerms.value = terms;
    threshold.value = payload.threshold;
    queriedInstances.value = payload.instanceUrls.map((url) => instanceForUrl(instances, url));

    if (errors.length > 0) {
      error.value = `Some lookups failed: ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? ` (+${errors.length - 5} more)` : ''}`;
    }

    // Update URL to reflect the submitted query.
    const rawTerms = terms.map((t) => t.raw);
    const targets = payload.instanceUrls.map((url) => urlToTarget(instances, url));
    const queryUrl = buildNameResQueryUrl(rawTerms, targets, payload.options, payload.threshold);
    resultsUrl = queryUrl;
    showUrl(queryUrl);
  } finally {
    if (abortController === controller) {
      abortController = null;
      loading.value = false;
    }
  }
}
</script>

<template>
  <div class="card mb-4">
    <div class="card-header">Query</div>
    <div class="card-body">
      <NameResForm
        :key="formKey"
        :instances="instances"
        :loading="loading"
        :has-results="hasResults"
        :initial-terms="initialTerms"
        :initial-targets="initialTargets"
        :initial-options="initialOptions"
        :initial-threshold="initialThreshold"
        @submit="onFormSubmit"
        @stop="stopQuery"
      />
    </div>
  </div>

  <div v-if="ignoredTargets.length" class="alert alert-warning">
    Ignored {{ ignoredTargets.length === 1 ? 'a target' : 'targets' }} in the link that
    {{ ignoredTargets.length === 1 ? 'is' : 'are' }} neither a known instance nor an http(s)
    URL: {{ ignoredTargets.join(', ') }}
  </div>
  <div v-if="error" class="alert alert-danger">{{ error }}</div>
  <div v-if="notice" class="alert alert-secondary">{{ notice }}</div>

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
