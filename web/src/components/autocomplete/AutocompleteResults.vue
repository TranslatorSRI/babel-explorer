<script setup lang="ts">
import { ref, computed } from 'vue';
import type { NameResResult, NameResInstance } from '../../lib/nameres-types';
import HighlightedFragment from './HighlightedFragment.vue';
import LatencyBadge from './LatencyBadge.vue';
import CurieLink from '../shared/CurieLink.vue';
import BiolinkTypeLink from '../shared/BiolinkTypeLink.vue';

interface InstanceState {
  results: NameResResult[];
  elapsedMs: number | null;
  error: string | null;
  inFlight: boolean;
  /** 'ok' | 'error' | 'cancelled' | 'idle' */
  state: 'ok' | 'error' | 'cancelled' | 'idle';
}

const props = defineProps<{
  instance: NameResInstance;
  state: InstanceState;
  highlight: boolean;
  prefixMap: Record<string, string>;
  /** The current NameRes `/lookup?...` URL for this instance+query+options. */
  apiUrl: string;
}>();

const copied = ref('');

async function copyText(text: string, tag: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = tag;
    setTimeout(() => { if (copied.value === tag) copied.value = ''; }, 1500);
  } catch { /* noop */ }
}

function curieApiUrl(curie: string): string {
  // Same base URL but with string=CURIE; useful for debugging a specific row.
  try {
    const u = new URL(props.apiUrl);
    u.searchParams.set('string', curie);
    return u.toString();
  } catch {
    return props.apiUrl;
  }
}

// Group highlighting fragments for display.
function highlightEntries(r: NameResResult): { field: string; fragments: string[] }[] {
  if (!r.highlighting) return [];
  const out: { field: string; fragments: string[] }[] = [];
  for (const [field, value] of Object.entries(r.highlighting)) {
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      out.push({ field, fragments: value as string[] });
    }
  }
  return out;
}

const hasResults = computed(() => props.state.results.length > 0);
</script>

<template>
  <div class="card">
    <div class="card-header d-flex align-items-center justify-content-between flex-wrap gap-2">
      <div class="d-flex align-items-center gap-2">
        <strong>{{ instance.name }}</strong>
        <LatencyBadge :elapsed-ms="state.elapsedMs" :state="state.state" :parallel="false" />
      </div>
      <button
        type="button"
        class="btn btn-sm btn-outline-secondary"
        @click="copyText(apiUrl, 'url')"
      >
        {{ copied === 'url' ? '✓ Copied' : 'Copy API URL' }}
      </button>
    </div>

    <div v-if="state.error" class="alert alert-danger m-3">{{ state.error }}</div>

    <div v-else-if="!hasResults && !state.inFlight" class="card-body text-muted">
      <em>No results.</em>
    </div>

    <div v-else class="table-responsive">
      <table class="table table-hover mb-0">
        <thead>
          <tr>
            <th style="width: 3rem">#</th>
            <th>Label</th>
            <th>Matched on</th>
            <th>CURIE</th>
            <th>Types</th>
            <th>Clique</th>
            <th>Score</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, idx) in state.results" :key="r.curie + idx">
            <td class="text-muted">{{ idx + 1 }}</td>
            <td>
              <HighlightedFragment :fragment="r.label" :highlight="highlight" />
            </td>
            <td>
              <div v-for="entry in highlightEntries(r)" :key="entry.field" class="small">
                <span class="text-muted">{{ entry.field }}:</span>
                <HighlightedFragment
                  v-for="(frag, i) in entry.fragments"
                  :key="i"
                  :fragment="frag"
                  :highlight="highlight"
                />
              </div>
              <span v-if="highlightEntries(r).length === 0" class="text-muted small">—</span>
            </td>
            <td><CurieLink :curie="r.curie" :prefix-map="prefixMap" /></td>
            <td>
              <span v-for="t in r.types" :key="t" class="badge bg-secondary-subtle text-secondary-emphasis me-1"><BiolinkTypeLink :type="t" /></span>
            </td>
            <td class="text-muted">{{ r.clique_identifier_count }}</td>
            <td class="text-muted">{{ r.score.toFixed(2) }}</td>
            <td>
              <button
                type="button"
                class="btn btn-link btn-sm py-0 px-1"
                :title="curieApiUrl(r.curie)"
                @click="copyText(curieApiUrl(r.curie), r.curie)"
              >
                {{ copied === r.curie ? '✓' : 'Copy URL' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
