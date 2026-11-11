<script setup lang="ts">
import { computed } from 'vue';
import type { NameResResult, NameResInstance, ParsedSearchTerm, ExpectedCurieStatus } from '../../lib/nameres-types';
import { validateExpectedCuries } from '../../lib/nameres-api';

const props = defineProps<{
  resultsByInstance: Map<string, Map<string, NameResResult[]>>;
  queriedInstances: NameResInstance[];
  terms: ParsedSearchTerm[];
  threshold: number;
}>();

// ── Resolved tile ────────────────────────────────────────────────────────────

/**
 * Each answered lookup's results for a term. A failed lookup has no entry in
 * resultsByInstance and is left out: it is reported separately, not counted as a term
 * that found nothing.
 */
function answeredResults(term: ParsedSearchTerm): NameResResult[][] {
  return props.queriedInstances
    .map((inst) => props.resultsByInstance.get(inst.url)?.get(term.text))
    .filter((results): results is NameResResult[] => results !== undefined);
}

/** Terms with at least one result on every instance that answered. */
const resolvedByAll = computed(() =>
  props.terms.filter((t) => {
    const answered = answeredResults(t);
    return answered.length > 0 && answered.every((results) => results.length > 0);
  }),
);

/** Terms with no results on any instance that answered. */
const noResultsAny = computed(() =>
  props.terms.filter((t) => {
    const answered = answeredResults(t);
    return answered.length > 0 && answered.every((results) => results.length === 0);
  }),
);

/** Terms whose lookup failed on at least one instance. */
const failedTerms = computed(() =>
  props.terms.filter((t) => answeredResults(t).length < props.queriedInstances.length),
);

// ── Agreement tile ───────────────────────────────────────────────────────────

/** Terms where instances disagree on #1 result (only when 2+ instances). */
const disagreements = computed(() => {
  if (props.queriedInstances.length < 2) return [];
  return props.terms.filter((t) => {
    const curies = new Set<string>();
    for (const results of answeredResults(t)) {
      curies.add(results.length > 0 ? results[0].curie : '(no results)');
    }
    return curies.size > 1;
  });
});

// ── Expected CURIE tile ──────────────────────────────────────────────────────

const annotatedTerms = computed(() => props.terms.filter((t) => t.expectedCuries.length > 0));
const hasAnnotations = computed(() => annotatedTerms.value.length > 0);

/**
 * For each annotated term, get the "worst" status across the instances that answered.
 * success < partial < failure (worst wins). Null when no instance answered.
 */
function worstStatus(term: ParsedSearchTerm): ExpectedCurieStatus | null {
  const answered = answeredResults(term);
  if (answered.length === 0) return null;
  let worst: ExpectedCurieStatus = 'success';
  for (const results of answered) {
    const v = validateExpectedCuries(results, term.expectedCuries, props.threshold);
    if (v.status === 'failure') return 'failure';
    if (v.status === 'partial') worst = 'partial';
  }
  return worst;
}

const successCount = computed(() =>
  annotatedTerms.value.filter((t) => worstStatus(t) === 'success').length,
);
const partialCount = computed(() =>
  annotatedTerms.value.filter((t) => worstStatus(t) === 'partial').length,
);
const failureCount = computed(() =>
  annotatedTerms.value.filter((t) => worstStatus(t) === 'failure').length,
);

// ── Display helpers ──────────────────────────────────────────────────────────

const INLINE_LIMIT = 3;

function formatTermList(termsList: ParsedSearchTerm[]): string {
  const texts = termsList.map((t) => t.text);
  if (texts.length <= INLINE_LIMIT) return texts.join(', ');
  return `${texts.slice(0, INLINE_LIMIT).join(', ')} +${texts.length - INLINE_LIMIT} more`;
}
</script>

<template>
  <div class="d-flex flex-wrap gap-3 mb-3">

    <!-- Resolved tile -->
    <div class="card flex-fill" style="min-width: 160px">
      <div class="card-body py-2 px-3">
        <div class="text-muted small mb-1">Resolved</div>
        <div class="fs-5 fw-semibold">
          {{ resolvedByAll.length }}
          <span class="fs-6 fw-normal text-muted">/ {{ terms.length }}</span>
        </div>
        <div v-if="noResultsAny.length > 0" class="text-danger small mt-1">
          {{ noResultsAny.length }} no results
          <span class="text-muted">({{ formatTermList(noResultsAny) }})</span>
        </div>
        <div v-if="failedTerms.length > 0" class="text-danger small mt-1">
          {{ failedTerms.length }} with a failed lookup
          <span class="text-muted">({{ formatTermList(failedTerms) }})</span>
        </div>
      </div>
    </div>

    <!-- Agreement tile (2+ instances) -->
    <div v-if="queriedInstances.length > 1" class="card flex-fill" style="min-width: 160px">
      <div class="card-body py-2 px-3">
        <div class="text-muted small mb-1">Disagreements</div>
        <div
          class="fs-5 fw-semibold"
          :class="disagreements.length > 0 ? 'text-warning' : 'text-success'"
        >
          {{ disagreements.length }}
        </div>
        <div v-if="disagreements.length > 0" class="text-muted small mt-1">
          {{ formatTermList(disagreements) }}
        </div>
        <div v-else class="text-muted small mt-1">All instances agree on #1</div>
      </div>
    </div>

    <!-- Expected CURIE tile -->
    <div v-if="hasAnnotations" class="card flex-fill" style="min-width: 200px">
      <div class="card-body py-2 px-3">
        <div class="text-muted small mb-1">Expected CURIEs</div>
        <div class="d-flex gap-3">
          <div>
            <span class="badge bg-success">{{ successCount }}</span>
            <span class="small text-muted ms-1">pass</span>
          </div>
          <div v-if="partialCount > 0">
            <span class="badge bg-warning text-dark">{{ partialCount }}</span>
            <span class="small text-muted ms-1">partial</span>
          </div>
          <div v-if="failureCount > 0">
            <span class="badge bg-danger">{{ failureCount }}</span>
            <span class="small text-muted ms-1">fail</span>
          </div>
        </div>
        <div class="text-muted small mt-1">
          {{ annotatedTerms.length }} annotated term{{ annotatedTerms.length !== 1 ? 's' : '' }}
        </div>
      </div>
    </div>

  </div>
</template>
