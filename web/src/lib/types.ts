/** A single identifier within a NodeNorm equivalence clique. */
export interface NormalizedIdentifier {
  identifier: string;
  label?: string;
  /** Individual biolink type (only present when individual_types=true). */
  type?: string;
  taxa?: string[];
  description?: string[];
}

/** A normalized node returned by the NodeNorm API for one input CURIE. */
export interface NormalizedNode {
  id: { identifier: string; label?: string };
  equivalent_identifiers: NormalizedIdentifier[];
  /** Top-level biolink type hierarchy. */
  type: string[];
  information_content?: number;
  /** Top-level descriptions (only present when description=true). */
  descriptions?: string[];
}

/** Raw API response: keys are the input CURIEs. */
export type NodeNormResponse = Record<string, NormalizedNode | null>;

/** A named NodeNorm deployment endpoint. */
export interface NodeNormInstance {
  name: string;
  env: string;
  url: string;
}

/** API query options matching NodeNorm get_normalized_nodes parameters. */
export interface ApiOptions {
  conflate: boolean;
  drug_chemical_conflate: boolean;
  description: boolean;
  individual_types: boolean;
  include_taxa: boolean;
}

/** Default API options — all enabled. */
export const DEFAULT_API_OPTIONS: ApiOptions = {
  conflate: true,
  drug_chemical_conflate: true,
  description: true,
  individual_types: true,
  include_taxa: true,
};
