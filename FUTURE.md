# Future Work

## Batch NodeNorm lookups

`normalize_curie` makes one HTTP round-trip per CURIE. NodeNorm's
`/get_normalized_nodes` endpoint accepts repeated `curie=` parameters in one
request. Adding a `normalize_curies(curies)` batch method that pre-warms the
`normalize_curie` cache would collapse N serial round-trips into one when
`--labels` is set.

## Reuse a single DuckDB connection per BabelXRefs instance

`get_curie_xref` opens a fresh DuckDB connection and re-reads Concord.parquet
for each unique CURIE. Opening one connection at first use and reusing it across
all queries would eliminate the per-CURIE open/scan overhead.
