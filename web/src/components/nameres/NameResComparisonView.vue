<script setup lang="ts">
import { ref } from 'vue';
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

/** The lookup's results, or undefined if the lookup failed (not the same as no results). */
function getResults(text: string, instanceUrl: string): NameResResult[] | undefined {
  return props.resultsByInstance.get(instanceUrl)?.get(text);
}

function lookupFailed(text: string, instanceUrl: string): boolean {
  return getResults(text, instanceUrl) === undefined;
}

/** Instances whose lookup for this term answered; a failed one is no evidence either way. */
function answeredInstances(text: string): NameResInstance[] {
  return props.queriedInstances.filter((inst) => !lookupFailed(text, inst.url));
}

function getTopResult(text: string, instanceUrl: string): NameResResult | null {
  return getResults(text, instanceUrl)?.[0] ?? null;
}

function getValidation(term: ParsedSearchTerm, instanceUrl: string): ExpectedCurieValidation {
  const results = getResults(term.text, instanceUrl) ?? [];
  return validateExpectedCuries(results, term.expectedCuries, props.threshold);
}

/**
 * Check if the instances that answered agree on the top result CURIE for a search term.
 */
function allAgree(text: string): boolean {
  const curies = new Set<string>();
  for (const inst of answeredInstances(text)) {
    const top = getTopResult(text, inst.url);
    curies.add(top?.curie ?? '(no results)');
  }
  return curies.size <= 1;
}

/**
 * Determine row class based on expected CURIE status across all instances.
 */
function getRowClass(term: ParsedSearchTerm): string {
  if (term.expectedCuries.length === 0) {
    return allAgree(term.text) ? '' : 'table-warning';
  }

  const validations = answeredInstances(term.text).map((inst) => getValidation(term, inst.url));
  if (validations.length === 0) return '';

  // All success → green
  if (validations.every((v) => v.status === 'success')) return 'table-success';
  // Any failure → red
  if (validations.some((v) => v.status === 'failure')) return 'table-danger';
  // Mix of success/partial → yellow
  return 'table-warning';
}

/**
 * Get a short status indicator for a cell.
 */
function getCellStatus(term: ParsedSearchTerm, instanceUrl: string): ExpectedCurieValidation | null {
  if (term.expectedCuries.length === 0 || lookupFailed(term.text, instanceUrl)) return null;
  return getValidation(term, instanceUrl);
}
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
          :class="['align-middle', getRowClass(term)]"
          style="cursor: pointer"
          @click="toggleRow(term.raw)"
        >
          <td class="text-center">
            <span
              :style="{
                display: 'inline-block',
                transform: expandedTerms.has(term.raw) ? 'rotate(90deg)' : '',
                transition: 'transform 0.15s',
              }"
            >›</span>
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
            <template v-if="getTopResult(term.text, inst.url)">
              <CurieLink
                :curie="getTopResult(term.text, inst.url)!.curie"
              />
              <br />
              <small class="text-muted">{{ getTopResult(term.text, inst.url)!.label }}</small>
              <br />
              <template v-if="getTopResult(term.text, inst.url)!.types.length > 0">
                <span
                  v-for="t in getTopResult(term.text, inst.url)!.types"
                  :key="t"
                  class="badge bg-info text-dark me-1"
                  style="font-size: 0.7em"
                ><BiolinkTypeLink :type="t" /></span>
                <br />
              </template>
              <small class="text-muted">{{ getResults(term.text, inst.url)!.length }} results</small>

              <!-- Expected CURIE status indicator -->
              <template v-if="getCellStatus(term, inst.url)">
                <br />
                <span
                  v-if="getCellStatus(term, inst.url)!.status === 'success'"
                  class="badge bg-success"
                  style="font-size: 0.65em"
                >&#10003; #1</span>
                <span
                  v-else-if="getCellStatus(term, inst.url)!.status === 'partial'"
                  class="badge bg-warning text-dark"
                  style="font-size: 0.65em"
                >#{{ getCellStatus(term, inst.url)!.rank + 1 }}</span>
                <!-- A failure with a rank was found, just not within the threshold. -->
                <span
                  v-else-if="getCellStatus(term, inst.url)!.status === 'failure' && getCellStatus(term, inst.url)!.rank >= 0"
                  class="badge bg-danger"
                  style="font-size: 0.65em"
                  :title="`Found at #${getCellStatus(term, inst.url)!.rank + 1}, outside the top ${threshold}`"
                >&#10007; #{{ getCellStatus(term, inst.url)!.rank + 1 }}</span>
                <span
                  v-else-if="getCellStatus(term, inst.url)!.status === 'failure'"
                  class="badge bg-danger"
                  style="font-size: 0.65em"
                >&#10007; not found</span>
              </template>
            </template>
            <span v-else-if="lookupFailed(term.text, inst.url)" class="text-danger">Request failed</span>
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
                <p v-if="lookupFailed(term.text, inst.url)" class="text-danger">
                  The lookup on this instance failed.
                </p>
                <NameResDetailPanel
                  v-else
                  :results="getResults(term.text, inst.url)!"
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
