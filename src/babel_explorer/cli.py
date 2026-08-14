"""Command-line interface for babel-explorer."""

import logging
from itertools import combinations

import click
from dotenv import load_dotenv
from rich.markup import escape

from babel_explorer.core.babel_xrefs import (
    BabelXRefs,
    LabeledCrossReference,
    build_adjacency,
    build_depth_map,
    find_shortest_path,
)
from babel_explorer.core.downloader import BabelDownloader, MissingBabelFileError
from babel_explorer.core.nodenorm import NodeNorm
from babel_explorer.formatting import (
    curie_with_label,
    format_identifier_record,
    hl_curie,
    make_console,
    record_to_dict,
    write_records,
)


def babel_options(f):
    """Decorator adding --local-dir, --babel-url, and --check-download options to a command."""
    f = click.option(
        "--allow-version-mismatch",
        is_flag=True,
        envvar="BABEL_ALLOW_VERSION_MISMATCH",
        help="Proceed even if NodeNorm was built from a different Babel release than --babel-url",
    )(f)
    f = click.option(
        "--check-download",
        type=str,
        default="3h",
        show_default=True,
        envvar="BABEL_CHECK_DOWNLOAD",
        help="How often to re-check downloads (e.g. '3h', '30m', '1d', '0', 'never'). "
        "'never' disables re-checking and always uses cached files; '0' forces a re-check every time.",
    )(f)
    f = click.option(
        "--babel-url",
        type=str,
        default="https://stars.renci.org/var/babel/latest/",
        show_default=True,
        envvar="BABEL_URL",
        help="Base URL of the Babel server",
    )(f)
    f = click.option(
        "--local-dir",
        type=str,
        default="data",
        show_default=True,
        envvar="BABEL_LOCAL_DIR",
        help="Local location to save Babel download files to. Holds one Babel release at "
        "a time; cached files are refreshed automatically when --babel-url points at a new one.",
    )(f)
    return f


def nodenorm_options(f):
    """Decorator adding --nodenorm-url to a command."""
    return click.option(
        "--nodenorm-url",
        type=str,
        default="https://nodenormalization-sri.renci.org/",
        show_default=True,
        envvar="NODENORM_URL",
        help="NodeNorm base URL used for node normalization and label enrichment",
    )(f)


def make_downloader(babel_url: str, local_dir: str, check_download: str):
    """Build a BabelDownloader and point its cache at the Babel release behind *babel_url*."""
    downloader = BabelDownloader(
        babel_url,
        local_path=local_dir,
        freshness_seconds=parse_duration(check_download),
    )
    downloader.sync_cache_version()
    return downloader


def check_babel_versions(
    downloader: BabelDownloader, nodenorm: NodeNorm, allow_version_mismatch: bool
):
    """Fail if NodeNorm was built from a different Babel release than the one being queried.

    Cross-release results are silently wrong rather than obviously wrong: labels and
    cliques would come from one Babel while the cross-references come from another.
    Skipped when either version is unavailable.
    """
    babel_version = downloader.babel_version
    nodenorm_version = nodenorm.get_babel_version()
    if (
        babel_version
        and nodenorm_version
        and babel_version != nodenorm_version
        and not allow_version_mismatch
    ):
        raise click.ClickException(
            f"NodeNorm at {nodenorm.nodenorm_url} was built from Babel {nodenorm_version}, "
            f"but {downloader.url_base} is Babel {babel_version}. Labels and cliques would "
            f"not match the cross-references. Point --nodenorm-url at a matching NodeNorm, "
            f"or pass --allow-version-mismatch to proceed anyway."
        )


def format_option(f):
    """Decorator adding --format and --json-indent options to a command."""
    f = click.option(
        "--format",
        "fmt",
        default="console",
        type=click.Choice(["console", "json", "tsv", "csv"]),
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


def _depth_of(curie: str, query_set: set, depth: int | None) -> int | None:
    """Depth to render a CURIE at: query CURIEs are always depth 0."""
    return 0 if curie in query_set else depth


def _print_paths(console, curies, xrefs_list, labels: bool) -> None:
    """Print the shortest path between every pair of query CURIEs."""
    curie_list = list(curies)
    if len(curie_list) < 2:
        console.print("[yellow]--paths requires at least two CURIEs.[/yellow]")
        return

    query_set = set(curie_list)
    # One neighbour map for every pair: rebuilding it per pair re-walks the whole
    # recursive xref list C(n,2) times.
    adj = build_adjacency(xrefs_list)

    for from_c, to_c in combinations(curie_list, 2):
        path = find_shortest_path(from_c, to_c, xrefs_list, adj)
        header_from = hl_curie(from_c, 0)
        header_to = hl_curie(to_c, 0)

        if path is None:
            console.print(
                f"[bold]Path:[/bold] {header_from} [dim]→[/dim] {header_to}"
                f"  [red]no path found[/red]"
            )
            console.print()
            continue

        if len(path) == 0:
            console.print(
                f"[bold]Path:[/bold] {header_from} [dim]=[/dim] {header_to}"
                f"  [dim](same node)[/dim]"
            )
            console.print()
            continue

        # Reconstruct ordered node list from the edge sequence.
        nodes = [from_c]
        for edge in path:
            prev = nodes[-1]
            nodes.append(edge.obj if edge.subj == prev else edge.subj)

        # Header: node1 → node2 → … → nodeN. Position along the path is the depth
        # from from_c, except for query CURIEs, which always render as depth 0.
        node_strs = [
            hl_curie(node, _depth_of(node, query_set, i))
            for i, node in enumerate(nodes)
        ]
        n_steps = len(path)
        step_word = "step" if n_steps == 1 else "steps"
        console.print(
            f"[bold]Path ({n_steps} {step_word}):[/bold] "
            + " [dim]→[/dim] ".join(node_strs)
        )

        # Edge details, indented, oriented in traversal direction.
        for i, edge in enumerate(path):
            from_node = nodes[i]
            subj_node = edge.subj if edge.subj == from_node else edge.obj
            obj_node = edge.obj if edge.subj == from_node else edge.subj

            subj_label = obj_label = None
            if labels and isinstance(edge, LabeledCrossReference):
                if edge.subj == subj_node:
                    subj_label = edge.subj_label
                    obj_label = edge.obj_label
                else:
                    subj_label = edge.obj_label
                    obj_label = edge.subj_label

            subj_str = curie_with_label(
                subj_node, _depth_of(subj_node, query_set, i), subj_label
            )
            obj_str = curie_with_label(
                obj_node, _depth_of(obj_node, query_set, i + 1), obj_label
            )

            console.print(
                f"  - {subj_str}  [dim]{escape(edge.pred)}[/dim]  "
                f"{obj_str}  [dim italic]{escape(edge.filename)}[/dim italic]"
            )

        console.print()


class BabelExplorerGroup(click.Group):
    """Group that reports missing Babel files as a plain error rather than a traceback."""

    def invoke(self, ctx):
        try:
            return super().invoke(ctx)
        except MissingBabelFileError as e:
            raise click.ClickException(str(e)) from e


@click.group(cls=BabelExplorerGroup)
def cli():
    """babel-explorer: query and explore Babel intermediate files."""
    logging.basicConfig(level=logging.INFO)
    # Runs before subcommand parameters are parsed, so .env feeds the envvar= defaults.
    load_dotenv()


@cli.command("xrefs")
@click.argument("curies", type=str, required=True, nargs=-1)
@babel_options
@nodenorm_options
@click.option("--recurse", is_flag=True, help="Recursively query returned xrefs")
@click.option("--labels", is_flag=True, help="Include labels for CURIEs")
@click.option(
    "--paths",
    is_flag=True,
    help="Show shortest path(s) connecting the given CURIEs (implies --recurse)",
)
@format_option
def xrefs(
    curies: list[str],
    babel_url: str,
    nodenorm_url: str,
    local_dir: str,
    recurse: bool,
    labels: bool,
    paths: bool,
    check_download: str,
    allow_version_mismatch: bool,
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
    if paths:
        # Checked before anything is downloaded. Only the console renderer knows how to
        # lay out paths; the other formats would silently emit the full recursive xref
        # list instead, which looks like a successful --paths run but is not one.
        if fmt != "console":
            raise click.UsageError(
                f"--paths is only supported with --format console, not --format {fmt}. "
                f"Drop --paths to emit the full cross-reference list as {fmt}."
            )
        recurse = True

    downloader = make_downloader(babel_url, local_dir, check_download)
    nodenorm = NodeNorm(nodenorm_url)
    # NodeNorm is only consulted when labels or the recursive expansion need it.
    if labels or recurse:
        check_babel_versions(downloader, nodenorm, allow_version_mismatch)

    bxref = BabelXRefs(downloader, nodenorm)
    xref_list = bxref.get_curie_xrefs(curies, recurse, label_curies=labels)

    if fmt == "console":
        console = make_console()
        if paths:
            _print_paths(console, curies, xref_list, labels)
        else:
            query_set = set(curies)
            # Without --recurse every result is one hop from a query CURIE, so there
            # is no depth to show: only the query CURIEs themselves are highlighted.
            depth_map = build_depth_map(list(curies), xref_list) if recurse else {}
            for xref in xref_list:
                labeled = isinstance(xref, LabeledCrossReference)
                subj_str = curie_with_label(
                    xref.subj,
                    _depth_of(xref.subj, query_set, depth_map.get(xref.subj)),
                    xref.subj_label if labeled else None,
                )
                obj_str = curie_with_label(
                    xref.obj,
                    _depth_of(xref.obj, query_set, depth_map.get(xref.obj)),
                    xref.obj_label if labeled else None,
                )
                console.print(
                    f"{subj_str}  [dim]{escape(xref.pred)}[/dim]  "
                    f"{obj_str}  [dim italic]{escape(xref.filename)}[/dim italic]"
                )
    else:
        write_records(xref_list, fmt=fmt, indent=json_indent)


@cli.command("ids")
@click.argument("curies", type=str, required=True, nargs=-1)
@babel_options
@nodenorm_options
@click.option("--labels", is_flag=True, help="Include labels for CURIEs")
@format_option
def ids(
    curies: list[str],
    babel_url: str,
    nodenorm_url: str,
    local_dir: str,
    labels: bool,
    check_download: str,
    allow_version_mismatch: bool,
    fmt: str,
    json_indent: int,
):
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
    downloader = make_downloader(babel_url, local_dir, check_download)
    nodenorm = NodeNorm(nodenorm_url)
    # NodeNorm is only consulted for labels, so only then can its Babel release differ.
    if labels:
        check_babel_versions(downloader, nodenorm, allow_version_mismatch)

    bxref = BabelXRefs(downloader, nodenorm)
    xrefs = bxref.get_curie_ids(curies, label_curies=labels)

    if fmt == "console":
        console = make_console()
        for record in xrefs:
            console.print(format_identifier_record(record))
    else:
        write_records(xrefs, fmt=fmt, indent=json_indent)


@cli.command("test-concord")
@click.argument("curies", type=str, required=True, nargs=-1)
@nodenorm_options
@format_option
def test_concord(curies, nodenorm_url, fmt, json_indent):
    """For each CURIE, print the current NodeNorm clique (all equivalent identifiers, labels, and Biolink types).

    Useful for inspecting how a potential Babel concordance change would affect NodeNorm:
    run before and after a Babel rebuild to see how cliques would shift.
    """
    nodenorm = NodeNorm(nodenorm_url)
    nodenorm.normalize_curies(curies)

    # Resolved once, before the format branch, so console and JSON report the same rows.
    query_set = set(curies)
    cliques = [
        (curie, ident)
        for curie in curies
        for ident in nodenorm.get_clique_identifiers(curie)
    ]

    if fmt == "console":
        console = make_console()
        for curie, ident in cliques:
            member = curie_with_label(
                ident.curie, _depth_of(ident.curie, query_set, None), ident.label
            )
            biolink = escape(", ".join(ident.biolink_type))
            console.print(f"{hl_curie(curie, 0)}  {member}  [dim]{biolink}[/dim]")
    else:
        write_records(
            [
                {"query_curie": curie, **record_to_dict(ident)}
                for curie, ident in cliques
            ],
            fmt=fmt,
            indent=json_indent,
        )


if __name__ == "__main__":
    cli()
