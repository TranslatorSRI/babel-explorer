/** A single result from the NameRes /lookup endpoint. */
export interface NameResResult {
  curie: string;
  label: string;
  types: string[];
  taxa: string[];
  synonyms: string[];
  score: number;
  clique_identifier_count: number;
  /** Raw highlighting data from Solr (opaque). */
  highlighting?: Record<string, unknown>;
}

/** A named NameRes deployment endpoint. */
export interface NameResInstance {
  name: string;
  env: string;
  url: string;
}

/** A parsed search term from the textarea, with optional expected CURIEs. */
export interface ParsedSearchTerm {
  /** The text to send to the API (with [[...]] annotations stripped). */
  text: string;
  /** The original line as entered by the user (for display and URL state). */
  raw: string;
  /** Expected CURIEs extracted from [[CURIE]] annotations. */
  expectedCuries: string[];
}

/** API query options for NameRes /lookup. */
export interface NameResApiOptions {
  limit: number;
  autocomplete: boolean;
  biolink_type: string;
  only_prefixes: string;
  exclude_prefixes: string;
  only_taxa: string;
}

/** Default API options. */
export const DEFAULT_NAMERES_OPTIONS: NameResApiOptions = {
  limit: 5,
  autocomplete: false,
  biolink_type: '',
  only_prefixes: '',
  exclude_prefixes: '',
  only_taxa: '',
};

/** Validation status for expected CURIE matching. */
export type ExpectedCurieStatus = 'success' | 'partial' | 'failure' | 'none';

/** Result of validating expected CURIEs against actual search results. */
export interface ExpectedCurieValidation {
  status: ExpectedCurieStatus;
  /** The expected CURIE that matched (or the first one if none matched). */
  matchedCurie: string;
  /** 0-based rank where the matched CURIE was found, or -1 if not found. */
  rank: number;
  /** The "fail if in top" threshold that was used. */
  threshold: number;
}
