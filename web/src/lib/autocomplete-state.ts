import type { NameResResult } from './nameres-types';

/**
 * What the Autocomplete tool knows about one instance's answer to the current query.
 *
 * Declared once and shared by every autocomplete component. Each used to declare its own
 * copy with whichever fields it read, so a renamed field could fall out of step in one
 * of them without the type checker noticing.
 */
export interface InstanceState {
  /** The top-N results for the live query. */
  results: NameResResult[];
  /** The top-100 results from the expected-CURIE check, once it has run. */
  deepResults?: NameResResult[];
  elapsedMs: number | null;
  error: string | null;
  inFlight: boolean;
  state: 'ok' | 'error' | 'cancelled' | 'idle';
}

export function emptyInstanceState(): InstanceState {
  return { results: [], elapsedMs: null, error: null, inFlight: false, state: 'idle' };
}
