"""NodeNorm API client for identifier normalisation and label enrichment."""

import dataclasses
import functools
import requests
import logging


@dataclasses.dataclass(frozen=True)
class Identifier:
    """Normalised identifier record returned by the NodeNorm API."""

    curie: str
    label: str = ""
    biolink_type: tuple[str, ...] = ()
    taxa: tuple[str, ...] = ()
    description: tuple[str, ...] = ()

    def __lt__(self, other):
        return self.curie < other.curie

    @staticmethod
    def from_dict(d: dict) -> "Identifier":
        return Identifier(
            curie=d["identifier"],
            label=d.get("label", ""),
            biolink_type=tuple(d.get("type", [])),
            taxa=tuple(d.get("taxa", [])),
            description=tuple(d.get("description", [])),
        )


class NodeNorm:
    """Client for the NodeNormalization API (https://nodenormalization-sri.renci.org/)."""

    def __init__(self, nodenorm_url: str = "", timeout: int = 30):
        """
        :param nodenorm_url: Base URL of the NodeNorm service. Pass an empty string (default)
            to skip all network calls and have every lookup return a bare ``Identifier``.
        :param timeout: HTTP request timeout in seconds.
        """
        self.nodenorm_url = nodenorm_url
        self.timeout = timeout
        if self.nodenorm_url and not self.nodenorm_url.endswith("/"):
            self.nodenorm_url += "/"

    @functools.lru_cache(maxsize=None)
    def get_identifier(self, curie: str) -> "Identifier":
        """Return the ``Identifier`` for *curie* by looking it up in its NodeNorm clique.

        Searches ``equivalent_identifiers`` for an entry whose ``identifier`` field matches
        *curie* exactly. Falls back to a bare ``Identifier(curie=curie)`` (empty label and
        type) if NodeNorm does not recognise the CURIE or it is not listed in the clique.

        Results are LRU-cached so repeated calls for the same CURIE are free.
        """
        result = self.normalize_curie(curie)
        logging.debug(f"Normalizing {curie} with NodeNorm to result: {result}")
        if not result:
            return Identifier(curie=curie)
        for identifier in result.get("equivalent_identifiers", []):
            if identifier["identifier"] == curie:
                logging.debug(f"Found exact match for {curie}: {identifier}")
                return Identifier.from_dict(identifier)

        logging.debug(
            f"No exact match for {curie!r} in equivalent_identifiers; returning bare Identifier"
        )
        return Identifier(curie=curie)

    @functools.lru_cache(maxsize=None)
    def normalize_curie(
        self,
        curie: str,
        conflate=True,
        drug_chemical_conflate=True,
        description=True,
        individual_types=True,
        include_taxa=True,
    ):
        """Call ``get_normalized_nodes`` and return the per-CURIE result dict.

        :return: The normalisation dict for *curie* (contains ``id``, ``equivalent_identifiers``,
            ``type``, etc.), or ``None`` if the CURIE is not recognised by NodeNorm.
        :raises requests.HTTPError: If the API returns a non-2xx status code.
        """
        if not self.nodenorm_url:
            return None
        response = requests.get(
            f"{self.nodenorm_url}get_normalized_nodes",
            params={
                "curie": curie,
                "conflate": conflate,
                "drug_chemical_conflate": drug_chemical_conflate,
                "description": description,
                "individual_types": individual_types,
                "include_taxa": include_taxa,
            },
            timeout=self.timeout,
        )
        response.raise_for_status()
        result = response.json()

        try:
            return result[curie]
        except KeyError:
            logging.debug(
                f"NodeNorm response did not contain CURIE {curie!r}; returning None"
            )
            return None

    @functools.lru_cache(maxsize=None)
    def get_clique_identifiers(self, curie: str) -> list[Identifier]:
        """Return all ``Identifier`` objects in the NodeNorm clique for *curie*.

        :return: A list of ``Identifier`` objects (one per entry in ``equivalent_identifiers``),
            or an empty list if the CURIE is unknown or has no equivalents.
        """
        result = self.normalize_curie(curie)
        if not result:
            return []
        if "equivalent_identifiers" not in result:
            return []
        return [Identifier.from_dict(x) for x in result["equivalent_identifiers"]]
