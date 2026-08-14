"""NodeNorm API client for identifier normalisation and label enrichment."""

import dataclasses
import logging

import requests


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
        def _to_tuple(val) -> tuple[str, ...]:
            """Coerce a string or list to a tuple — guards against iterating string chars."""
            if not val:
                return ()
            return (val,) if isinstance(val, str) else tuple(val)

        return Identifier(
            curie=d["identifier"],
            label=d.get("label", ""),
            biolink_type=_to_tuple(d.get("type")),
            taxa=_to_tuple(d.get("taxa")),
            description=_to_tuple(d.get("description")),
        )


class NodeNorm:
    """Client for the NodeNormalization API (https://nodenormalization-sri.renci.org/).

    Results are cached per instance. To get uncached results, instantiate a new
    NodeNorm object.
    """

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
        self._normalize_cache: dict[str, dict | None] = {}
        self._identifier_cache: dict[str, Identifier] = {}
        self._clique_cache: dict[str, list[Identifier]] = {}
        self._babel_version: str | None = None
        self._babel_version_resolved = False

    def get_babel_version(self) -> str | None:
        """Return the Babel release this NodeNorm instance was built from.

        :return: The version reported by the ``status`` endpoint, or ``None`` in offline
            mode or if the endpoint cannot be reached or does not report one.

        The result is cached per instance.
        """
        if self._babel_version_resolved:
            return self._babel_version

        self._babel_version_resolved = True
        if self.nodenorm_url:
            try:
                response = requests.get(
                    f"{self.nodenorm_url}status", timeout=self.timeout
                )
                response.raise_for_status()
                self._babel_version = response.json().get("babel_version")
            except (requests.RequestException, ValueError) as e:
                logging.warning(f"Could not read the Babel version from NodeNorm: {e}")
        return self._babel_version

    def get_identifier(self, curie: str) -> "Identifier":
        """Return the ``Identifier`` for *curie* by looking it up in its NodeNorm clique.

        Searches ``equivalent_identifiers`` for an entry whose ``identifier`` field matches
        *curie* exactly. Falls back to a bare ``Identifier(curie=curie)`` (empty label and
        type) if NodeNorm does not recognise the CURIE or it is not listed in the clique.

        Results are cached per instance.
        """
        if curie in self._identifier_cache:
            return self._identifier_cache[curie]

        result = self.normalize_curie(curie)
        logging.debug(f"Normalizing {curie} with NodeNorm to result: {result}")
        if not result:
            ident = Identifier(curie=curie)
        else:
            for identifier in result.get("equivalent_identifiers", []):
                if identifier["identifier"] == curie:
                    logging.debug(f"Found exact match for {curie}: {identifier}")
                    ident = Identifier.from_dict(identifier)
                    break
            else:
                logging.debug(
                    f"No exact match for {curie!r} in equivalent_identifiers; returning bare Identifier"
                )
                ident = Identifier(curie=curie)

        self._identifier_cache[curie] = ident
        return ident

    def normalize_curie(self, curie: str):
        """Call ``get_normalized_nodes`` and return the per-CURIE result dict.

        :return: The normalisation dict for *curie* (contains ``id``, ``equivalent_identifiers``,
            ``type``, etc.), or ``None`` if the CURIE is not recognised by NodeNorm.
        :raises requests.HTTPError: If the API returns a non-2xx status code.

        Results are cached per instance. HTTP errors are not cached.
        """
        if curie in self._normalize_cache:
            return self._normalize_cache[curie]

        if not self.nodenorm_url:
            self._normalize_cache[curie] = None
            return None

        response = requests.get(
            f"{self.nodenorm_url}get_normalized_nodes",
            params={
                "curie": curie,
                "conflate": True,
                "drug_chemical_conflate": True,
                "description": True,
                "individual_types": True,
                "include_taxa": True,
            },
            timeout=self.timeout,
        )
        response.raise_for_status()
        result = response.json()

        try:
            value = result[curie]
        except KeyError:
            logging.debug(
                f"NodeNorm response did not contain CURIE {curie!r}; returning None"
            )
            value = None

        self._normalize_cache[curie] = value
        return value

    def get_clique_identifiers(self, curie: str) -> list[Identifier]:
        """Return all ``Identifier`` objects in the NodeNorm clique for *curie*.

        :return: A list of ``Identifier`` objects (one per entry in ``equivalent_identifiers``),
            or an empty list if the CURIE is unknown or has no equivalents.

        Results are cached per instance.
        """
        if curie in self._clique_cache:
            return self._clique_cache[curie]

        result = self.normalize_curie(curie)
        if not result or "equivalent_identifiers" not in result:
            identifiers = []
        else:
            identifiers = [
                Identifier.from_dict(x) for x in result["equivalent_identifiers"]
            ]

        self._clique_cache[curie] = identifiers
        return identifiers
