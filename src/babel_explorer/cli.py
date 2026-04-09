# Command line interface for babel-explorer
import click
import logging
from babel_explorer.core.downloader import BabelDownloader
from babel_explorer.core.babel_xrefs import BabelXRefs
from babel_explorer.core.nodenorm import NodeNorm
from babel_explorer.formatting import write_records, _record_to_dict


def format_option(f):
    """Decorator adding --format and --json-indent options to a command."""
    f = click.option(
        "--format",
        "fmt",
        default="text",
        type=click.Choice(["text", "json", "tsv", "csv"]),
        show_default=True,
        help="Output format",
    )(f)
    f = click.option(
        "--json-indent",
        default=2,
        show_default=True,
        help="Indentation depth for JSON output",
    )(f)
    return f


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
        if amount < 0:
            raise click.BadParameter(
                f"Invalid duration {value!r}: duration must be non-negative."
            )
        return amount * units[lower[-1]]
    # Bare integer seconds
    try:
        result = int(lower)
    except ValueError:
        raise click.BadParameter(
            f"Invalid duration {value!r}: expected an integer number of seconds, optionally "
            "followed by 's', 'm', 'h', or 'd', or 'never'."
        )
    if result < 0:
        raise click.BadParameter(
            f"Invalid duration {value!r}: duration must be non-negative."
        )
    return result


@click.group()
def cli():
    """babel-explorer: query and explore Babel intermediate files."""
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
@format_option
def xrefs(
    curies: list[str],
    babel_url: str,
    nodenorm_url: str,
    local_dir: str,
    recurse: bool,
    labels: bool,
    check_download: str,
    fmt: str,
    json_indent: int,
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
    write_records(xrefs, fmt=fmt, indent=json_indent)


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
@format_option
def ids(curies: list[str], babel_url: str, local_dir: str, check_download: str, fmt: str, json_indent: int):
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
    write_records(xrefs, fmt=fmt, indent=json_indent)


@cli.command("test-concord")
@click.argument("curies", type=str, required=True, nargs=-1)
@click.option(
    "--nodenorm-url",
    type=str,
    default="https://nodenormalization-sri.renci.org/",
    help="NodeNorm URL to check for concord changes",
)
@format_option
def test_concord(curies, nodenorm_url, fmt, json_indent):
    """For each CURIE, print the current NodeNorm clique (all equivalent identifiers, labels, and Biolink types).

    Useful for inspecting how a potential Babel concordance change would affect NodeNorm:
    run before and after a Babel rebuild to see how cliques would shift.
    """
    nodenorm = NodeNorm(nodenorm_url)
    if fmt == "text":
        for curie in curies:
            for identifier in nodenorm.get_clique_identifiers(curie):
                biolink = ", ".join(identifier.biolink_type)
                label = identifier.label or ""
                print(f"{curie}\t{identifier.curie}\t{label}\t{biolink}")
    else:
        rows = [
            {"query_curie": curie, **_record_to_dict(ident)}
            for curie in curies
            for ident in nodenorm.get_clique_identifiers(curie)
        ]
        write_records(rows, fmt=fmt, indent=json_indent)


if __name__ == "__main__":
    cli()
