# Command line interface for babel-explorer
import click
import logging
from babel_explorer.core.downloader import BabelDownloader
from babel_explorer.core.babel_xrefs import BabelXRefs
from babel_explorer.core.nodenorm import NodeNorm


def parse_duration(value: str) -> int | float:
    """Parse a duration string like '3h', '30m', '1d', '7200', or 'never' → seconds."""
    units = {"s": 1, "m": 60, "h": 3600, "d": 86400}
    lower = (value or "").strip().lower()
    if not lower:
        raise click.BadParameter(
            "Invalid duration: value cannot be empty. "
            "Use an integer number of seconds, optionally followed by 's', 'm', 'h', or 'd', "
            "or 'never'."
        )
    if lower == "never":
        return float("inf")
    # Value with unit suffix (e.g. '3h', '30m')
    if lower[-1] in units:
        try:
            amount = int(lower[:-1])
        except ValueError:
            raise click.BadParameter(
                f"Invalid duration {value!r}: expected an integer followed by an optional unit "
                "('s', 'm', 'h', or 'd'), or 'never'."
            )
        return amount * units[lower[-1]]
    # Bare integer seconds
    try:
        return int(lower)
    except ValueError:
        raise click.BadParameter(
            f"Invalid duration {value!r}: expected an integer number of seconds, optionally "
            "followed by 's', 'm', 'h', or 'd', or 'never'."
        )


@click.group()
def cli():
    pass


@cli.command("xrefs")
@click.argument("curies", type=str, required=True, nargs=-1)
@click.option(
    "--local-dir",
    type=str,
    default="data/2025nov19",
    help="Local location to save Babel download files to",
)
@click.option(
    "--babel-url",
    type=str,
    default="https://stars.renci.org:443/var/babel_outputs/2025nov19/",
    help="Base URL of the Babel server",
)
@click.option(
    "--nodenorm-url",
    type=str,
    default="https://nodenormalization-sri.renci.org/",
    help="NodeNorm base URL used for node normalization and label enrichment",
)
@click.option("--recurse", is_flag=True, help="Recursively query returned xrefs")
@click.option("--labels", is_flag=True, help="Include labels for CURIEs")
@click.option(
    "--check-download",
    type=str,
    default="3h",
    show_default=True,
    help="How often to re-check downloads (e.g. '3h', '30m', '1d', '0', 'never'). "
    "'never' disables re-checking and always uses cached files; '0' forces a re-check every time.",
)
def xrefs(
    curies: list[str],
    babel_url: str,
    nodenorm_url,
    local_dir: str,
    recurse: bool,
    labels: bool,
    check_download: str,
):
    """
    Fetches and prints the cross-references (xrefs) for the given CURIEs.

    \f

    :param curies: A list of CURIEs (Compact URI) for which cross-references need
        to be retrieved.
    :type curies: list[str]
    :param babel_url: Base URL of the Babel server from which to download DuckDB files.
    :type babel_url: str

    :return: None
    """
    logging.basicConfig(level=logging.INFO)

    freshness = parse_duration(check_download)
    bxref = BabelXRefs(
        BabelDownloader(babel_url, local_path=local_dir, freshness_seconds=freshness),
        NodeNorm(nodenorm_url),
    )
    xrefs = bxref.get_curie_xrefs(curies, recurse, label_curies=labels)
    for xref in xrefs:
        print(xref)


@cli.command("ids")
@click.argument("curies", type=str, required=True, nargs=-1)
@click.option(
    "--local-dir",
    type=str,
    default="data/2025nov19",
    help="Local location to save Babel download files to",
)
@click.option(
    "--babel-url",
    type=str,
    default="https://stars.renci.org:443/var/babel_outputs/2025nov19/",
    help="Base URL of the Babel server",
)
@click.option(
    "--check-download",
    type=str,
    default="3h",
    show_default=True,
    help="How often to re-check downloads (e.g. '3h', '30m', '1d', '0', 'never'). "
    "'never' disables re-checking and always uses cached files; '0' forces a re-check every time.",
)
def ids(curies: list[str], babel_url: str, local_dir: str, check_download: str):
    """
    Fetches and prints the ID records for the given CURIEs, along with Biolink type if provided.

    \f

    :param curies: A list of CURIEs (Compact URI) for which cross-references need
        to be retrieved.
    :type curies: list[str]
    :param babel_url: Base URL of the Babel server
    :type babel_url: str

    :return: None
    """
    logging.basicConfig(level=logging.INFO)

    freshness = parse_duration(check_download)
    bxref = BabelXRefs(
        BabelDownloader(babel_url, local_path=local_dir, freshness_seconds=freshness)
    )
    xrefs = bxref.get_curie_ids(curies)
    for xref in xrefs:
        print(xref)


@cli.command("test-concord")
@click.argument("curies", type=str, required=True, nargs=-1)
@click.option(
    "--nodenorm-url",
    type=str,
    default="https://nodenormalization-sri.renci.org/",
    help="NodeNorm URL to check for concord changes",
)
def test_concord(curies, nodenorm_url):
    # We're trying to answer a simple question here: if the CURIEs we mention were combined, how would the cliques change in NodeNorm?
    # By definition, this can only combine all the cliques mentioned in the CURIEs.

    nodenorm = NodeNorm(nodenorm_url)
    for curie in curies:
        identifiers = nodenorm.get_clique_identifiers(curie)
        for identifier in identifiers:
            biolink = ", ".join(identifier.biolink_type)
            if identifier.label:
                print(f"{curie}\t{identifier.curie}\t{identifier.label}\t{biolink}")
            else:
                print(f"{curie}\t{identifier.curie}\t\t{biolink}")


if __name__ == "__main__":
    cli()
