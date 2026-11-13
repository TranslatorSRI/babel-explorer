<script setup lang="ts">
import { ref, computed } from 'vue';
import type { NameResResult, NameResInstance, ParsedSearchTerm, ExpectedCurieValidation } from '../../lib/nameres-types';
import { validateExpectedCuries } from '../../lib/nameres-api';
import BiolinkTypeLink from '../shared/BiolinkTypeLink.vue';
import CurieLink from '../shared/CurieLink.vue';
import NameResDetailPanel from './NameResDetailPanel.vue';

const props = defineProps<{
  /** Map from instance URL to Map<searchText, NameResResult[]>. */
  resultsByInstance: Map<string, Map<string, NameResResult[]>>;
  queriedInstances: NameResInstance[];
  terms: ParsedSearchTerm[];
  threshold: number;
}>();

// Rows are identified by term.raw: two lines can search for the same text with
// different expected CURIEs, and each is its own row.
const expandedTerms = ref(new Set<string>());

function toggleRow(raw: string) {
  if (expandedTerms.value.has(raw)) {
    expandedTerms.value.delete(raw);
  } else {
    expandedTerms.value.add(raw);
  }
}

interface Cell {
  /** The lookup's results, or undefined if the lookup failed (not the same as no results). */
  results: NameResResult[] | undefined;
  top: NameResResult | null;
  /** Null for a term with no expected CURIEs, or a failed lookup: no evidence either way. */
  validation: ExpectedCurieValidation | null;
}

/**
 * Every cell's results, top result and validation, keyed by term.raw and then instance
 * URL, worked out once per change of props. The template reads a cell many times, and
 * a regression list of a few hundred terms would otherwise rerun validateExpectedCuries
 * thousands of times on every re-render, such as each row expand.
 */
const cells = computed(() => {
  const byTerm = new Map<string, Map<string, Cell>>();
  for (const term of props.terms) {
    const byInstance = new Map<string, Cell>();
    for (const inst of props.queriedInstances) {
      const results = props.resultsByInstance.get(inst.url)?.get(term.text);
      byInstance.set(inst.url, {
        results,
        top: results?.[0] ?? null,
        validation:
          results !== undefined && term.expectedCuries.length > 0
            ? validateExpectedCuries(results, term.expectedCuries, props.threshold)
            : null,
      });
    }
    byTerm.set(term.raw, byInstance);
  }
  return byTerm;
});

function cell(term: ParsedSearchTerm, instanceUrl: string): Cell {
  return cells.value.get(term.raw)!.get(instanceUrl)!;
}

/**
 * Row class from the instances that answered: a failed lookup is no evidence either
 * way. Unannotated terms are marked only when the instances disagree on the top CURIE.
 */
const rowClasses = computed(() => {
  const classes = new Map<string, string>();
  for (const term of props.terms) {
    const answered = props.queriedInstances
      .map((inst) => cell(term, inst.url))
      .filter((c) => c.results !== undefined);
    let rowClass = '';
    if (term.expectedCuries.length === 0) {
      const tops = new Set(answered.map((c) => c.top?.curie ?? '(no results)'));
      if (tops.size > 1) rowClass = 'table-warning';
    } else if (answered.length > 0) {
      const statuses = answered.map((c) => c.validation!.status);
      if (statuses.every((s) => s === 'success')) rowClass = 'table-success';
      else if (statuses.includes('failure')) rowClass = 'table-danger';
      else rowClass = 'table-warning';
    }
    classes.set(term.raw, rowClass);
  }
  return classes;
});
</script>

<template>
  <div class="table-responsive">
    <table class="table table-bordered table-sm">
      <thead>
        <tr>
          <th style="width: 1.5rem"></th>
          <th>Search Term</th>
          <th v-for="inst in queriedInstances" :key="inst.url">
            {{ inst.name }}
          </th>
        </tr>
      </thead>
      <tbody v-if="terms.length === 0">
        <tr>
          <td :colspan="queriedInstances.length + 2" class="text-center text-muted py-3">
            No search terms provided.
          </td>
        </tr>
      </tbody>
      <tbody v-for="term in terms" :key="term.raw">
        <!-- Summary row -->
        <tr
          :class="['align-middle', rowClasses.get(term.raw)]"
          style="cursor: pointer"
          @click="toggleRow(term.raw)"
        >
          <td class="text-center">
            <!-- The row is clickable too; this button is the keyboard and screen-reader way in. -->
            <button
              type="button"
              class="btn btn-link btn-sm p-0 text-reset text-decoration-none"
              :aria-expanded="expandedTerms.has(term.raw)"
              :aria-label="`Ranked results for ${term.text}`"
              @click.stop="toggleRow(term.raw)"
            ><span
              :style="{
                display: 'inline-block',
                transform: expandedTerms.has(term.raw) ? 'rotate(90deg)' : '',
                transition: 'transform 0.15s',
              }"
            >›</span></button>
          </td>
          <td>
            <strong>{{ term.text }}</strong>
            <span
              v-for="ec in term.expectedCuries"
              :key="ec"
              class="badge bg-secondary ms-1"
              style="font-size: 0.65em"
            >{{ ec }}</span>
          </td>
          <td v-for="inst in queriedInstances" :key="inst.url">
            <template v-if="cell(term, inst.url).top">
              <CurieLink
                :curie="cell(term, inst.url).top!.curie"
              />
              <br />
              <small class="text-muted">{{ cell(term, inst.url).top!.label }}</small>
              <br />
              <template v-if="cell(term, inst.url).top!.types.length > 0">
                <span
                  v-for="t in cell(term, inst.url).top!.types"
                  :key="t"
                  class="badge bg-info text-dark me-1"
                  style="font-size: 0.7em"
                ><BiolinkTypeLink :type="t" /></span>
                <br />
              </template>
              <small class="text-muted">{{ cell(term, inst.url).results!.length }} results</small>

              <!-- Expected CURIE status indicator -->
              <template v-if="cell(term, inst.url).validation">
                <br />
                <span
                  v-if="cell(term, inst.url).validation!.status === 'success'"
                  class="badge bg-success"
                  style="font-size: 0.65em"
                >&#10003; #1</span>
                <span
                  v-else-if="cell(term, inst.url).validation!.status === 'partial'"
                  class="badge bg-warning text-dark"
                  style="font-size: 0.65em"
                >#{{ cell(term, inst.url).validation!.rank + 1 }}</span>
                <!-- A failure with a rank was found, just not within the threshold. -->
                <span
                  v-else-if="cell(term, inst.url).validation!.status === 'failure' && cell(term, inst.url).validation!.rank >= 0"
                  class="badge bg-danger"
                  style="font-size: 0.65em"
                  :title="`Found at #${cell(term, inst.url).validation!.rank + 1}, outside the top ${threshold}`"
                >&#10007; #{{ cell(term, inst.url).validation!.rank + 1 }}</span>
                <span
                  v-else-if="cell(term, inst.url).validation!.status === 'failure'"
                  class="badge bg-danger"
                  style="font-size: 0.65em"
                >&#10007; not found</span>
              </template>
            </template>
            <span v-else-if="cell(term, inst.url).results === undefined" class="text-danger">Request failed</span>
            <span v-else class="text-muted">No results</span>
          </td>
        </tr>

        <!-- Detail row -->
        <tr v-if="expandedTerms.has(term.raw)" class="bg-light">
          <td></td>
          <td :colspan="queriedInstances.length + 1" class="p-0">
            <div class="d-flex flex-wrap">
              <div
                v-for="inst in queriedInstances"
                :key="inst.url"
                class="flex-fill border-end p-3"
                :style="{ minWidth: `${100 / queriedInstances.length}%`, maxWidth: `${100 / queriedInstances.length}%` }"
              >
                <div class="fw-semibold text-muted small mb-2">{{ inst.name }}</div>
                <p v-if="cell(term, inst.url).results === undefined" class="text-danger">
                  The lookup on this instance failed.
                </p>
                <NameResDetailPanel
                  v-else
                  :results="cell(term, inst.url).results!"
                  :expected-curies="term.expectedCuries"
                />
              </div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
