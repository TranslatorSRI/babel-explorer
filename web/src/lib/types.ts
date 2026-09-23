/** A single identifier within a NodeNorm equivalence clique. */
export interface NormalizedIdentifier {
  identifier: string;
  label?: string;
  /** Individual biolink type (only present when individual_types=true). */
  type?: string;
  taxa?: string[];
  /** Plain string description for this identifier (only present when description=true). */
  description?: string;
}

/** A normalized node returned by the NodeNorm API for one input CURIE. */
export interface NormalizedNode {
  /**
   * The preferred (canonical) identifier for this clique.
   * description is the single best description string (longest, when description=true).
   */
  id: { identifier: string; label?: string; description?: string };
  equivalent_identifiers: NormalizedIdentifier[];
  /** Top-level biolink type hierarchy. */
  type: string[];
  information_content?: number;
  /**
   * All descriptions collected across the clique, sorted longest-to-shortest.
   * Only present when description=true. Each entry is a plain string.
   */
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
