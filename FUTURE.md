# Future Work

## Deduplicate CLI option blocks

`--local-dir`, `--babel-url`, and `--check-download` are copy-pasted between the
`xrefs` and `ids` commands in `cli.py`. Extract a `@common_babel_options` Click
decorator so defaults are defined in one place and can't drift.
