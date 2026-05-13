"""CURIE/IRI helpers shared by external xref providers.

A *CURIE* is a compact identifier of the form ``PREFIX:LOCAL_ID`` (e.g.
``CHEBI:31941``). An *IRI* is the expanded form
(``http://purl.obolibrary.org/obo/CHEBI_31941``). Providers like OLS4 query by
IRI, so each provider client uses the helpers here to translate.

The default prefix map covers the subset of identifier types currently used
by babel-explorer. Extend it as new providers come online.
"""

from typing import Mapping


DEFAULT_PREFIX_MAP: dict[str, str] = {
    "CHEBI": "http://purl.obolibrary.org/obo/CHEBI_",
    "MONDO": "http://purl.obolibrary.org/obo/MONDO_",
    "HP": "http://purl.obolibrary.org/obo/HP_",
    "PUBCHEM.COMPOUND": "http://identifiers.org/pubchem.compound/",
    "UMLS": "http://linkedlifedata.com/resource/umls/id/",
    "CHEMBL.COMPOUND": "http://identifiers.org/chembl.compound/",
    "DRUGBANK": "http://identifiers.org/drugbank/",
    "KEGG.COMPOUND": "http://identifiers.org/kegg.compound/",
    "UNII": "http://fdasis.nlm.nih.gov/srs/unii/",
    "INCHIKEY": "http://identifiers.org/inchikey/",
}


def split_curie(curie: str) -> tuple[str, str]:
    """Split ``curie`` into ``(prefix, local_id)`` on the first colon.

    :raises ValueError: If ``curie`` is empty or has no colon.
    """
    if not curie or ":" not in curie:
        raise ValueError(f"Not a valid CURIE: {curie!r}")
    prefix, local_id = curie.split(":", 1)
    if not prefix or not local_id:
        raise ValueError(f"Not a valid CURIE: {curie!r}")
    return prefix, local_id


def to_iri(curie: str, prefix_map: Mapping[str, str] = DEFAULT_PREFIX_MAP) -> str:
    """Expand ``curie`` to an IRI using ``prefix_map``.

    :raises KeyError: If the CURIE prefix is not in ``prefix_map``.
    """
    prefix, local_id = split_curie(curie)
    try:
        iri_prefix = prefix_map[prefix]
    except KeyError:
        raise KeyError(f"Unknown CURIE prefix {prefix!r} (not in prefix map)")
    return iri_prefix + local_id


def from_iri(iri: str, prefix_map: Mapping[str, str] = DEFAULT_PREFIX_MAP) -> str:
    """Contract ``iri`` back to a CURIE using ``prefix_map``.

    Tries the longest matching prefix first so e.g. ``CHEMBL.COMPOUND`` wins
    over a hypothetical bare ``CHEMBL`` entry.

    :raises ValueError: If no prefix in ``prefix_map`` matches the IRI.
    """
    for prefix, iri_prefix in sorted(
        prefix_map.items(), key=lambda kv: len(kv[1]), reverse=True
    ):
        if iri.startswith(iri_prefix):
            return f"{prefix}:{iri[len(iri_prefix) :]}"
    raise ValueError(f"No CURIE prefix in map matches IRI {iri!r}")
