"""Command-line interface for babel-explorer."""

import click
import logging
from itertools import combinations

from babel_explorer.core.downloader import BabelDownloader
from babel_explorer.core.babel_xrefs import BabelXRefs, build_depth_map, find_shortest_path
from babel_explorer.core.nodenorm import NodeNorm
from babel_explorer.core.babel_xrefs import LabeledCrossReference
from babel_explorer.formatting import (
    write_records,
    _record_to_dict,
    make_console,
    hl_curie,
    hl_curie_at_depth,
)
from rich.markup import escape


def babel_options(f):
    """Decorator adding --local-dir, --babel-url, and --check-download options to a command."""
    f = click.option(
        "--check-download",
        type=str,
        default="3h",
        show_default=True,
        help="How often to re-check downloads (e.g. '3h', '30m', '1d', '0', 'never'). "
        "'never' disables re-checking and always uses cached files; '0' forces a re-check every time.",
    )(f)
    f = click.option(
        "--babel-url",
        type=str,
        default="https://stars.renci.org/var/babel_outputs/2025nov19/",
        help="Base URL of the Babel server",
    )(f)
    f = click.option(
        "--local-dir",
        type=str,
        default="data/2025nov19",
        help="Local location to save Babel download files to",
    )(f)
    return f


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


def _fmt_label(label: str) -> str:
    """Escape a label for double-quoted display: backslashes first, then double quotes."""
    return escape(label.replace("\\", "\\\\").replace('"', '\\"'))


def _curie_str(curie: str, is_query: bool, depth: int | None, label: str | None) -> str:
    """Build a Rich-marked-up CURIE string with optional label."""
    if is_query:
        s = hl_curie(curie, True)
    else:
        s = hl_curie_at_depth(curie, depth)
    if label:
        s += f' "{_fmt_label(label)}"'
    return s


def _print_paths(console, curies, xrefs_list, labels: bool) -> None:
    """Print the shortest path between every pair of query CURIEs."""
    curie_list = list(curies)
    if len(curie_list) < 2:
        console.print("[yellow]--paths requires at least two CURIEs.[/yellow]")
        return

    query_set = set(curie_list)

    for from_c, to_c in combinations(curie_list, 2):
        path = find_shortest_path(from_c, to_c, xrefs_list)
        header_from = hl_curie(from_c, True)
        header_to = hl_curie(to_c, True)

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

        # Header: node1 → node2 → … → nodeN
        node_strs = []
        for i, node in enumerate(nodes):
            if node in query_set:
                node_strs.append(hl_curie(node, True))
            else:
                depth = i  # position along path == depth from from_c
                node_strs.append(hl_curie_at_depth(node, depth))
        n_steps = len(path)
        step_word = "step" if n_steps == 1 else "steps"
        console.print(
            f"[bold]Path ({n_steps} {step_word}):[/bold] "
            + f" [dim]→[/dim] ".join(node_strs)
        )

        # Edge details, indented, oriented in traversal direction.
        for i, edge in enumerate(path):
            from_node = nodes[i]
            to_node = nodes[i + 1]
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

            subj_str = _curie_str(subj_node, subj_node in query_set, i, subj_label)
            obj_str = _curie_str(obj_node, obj_node in query_set, i + 1, obj_label)

            console.print(
                f"  - {subj_str}  [dim]{escape(edge.pred)}[/dim]  "
                f"{obj_str}  [dim italic]{escape(edge.filename)}[/dim italic]"
            )

        console.print()


@click.group()
def cli():
    """babel-explorer: query and explore Babel intermediate files."""
    logging.basicConfig(level=logging.INFO)


@cli.command("xrefs")
@click.argument("curies", type=str, required=True, nargs=-1)
@babel_options
@click.option(
    "--nodenorm-url",
    type=str,
    default="https://nodenormalization-sri.renci.org/",
    help="NodeNorm base URL used for node normalization and label enrichment",
)
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
    freshness = parse_duration(check_download)
    bxref = BabelXRefs(
        BabelDownloader(babel_url, local_path=local_dir, freshness_seconds=freshness),
        NodeNorm(nodenorm_url),
    )
    if paths:
        recurse = True
    xref_list = bxref.get_curie_xrefs(curies, recurse, label_curies=labels)

    if fmt == "console":
        console = make_console()
        if paths:
            _print_paths(console, curies, xref_list, labels)
        else:
            query_set = set(curies)
            depth_map = build_depth_map(list(curies), xref_list) if recurse else None
            for xref in xref_list:
                if depth_map is not None:
                    subj_str = hl_curie_at_depth(xref.subj, depth_map.get(xref.subj))
                    obj_str = hl_curie_at_depth(xref.obj, depth_map.get(xref.obj))
                else:
                    subj_str = hl_curie(xref.subj, xref.subj in query_set)
                    obj_str = hl_curie(xref.obj, xref.obj in query_set)
                if isinstance(xref, LabeledCrossReference):
                    if xref.subj_label:
                        subj_str += f' "{_fmt_label(xref.subj_label)}"'
                    if xref.obj_label:
                        obj_str += f' "{_fmt_label(xref.obj_label)}"'
                console.print(
                    f"{subj_str}  [dim]{escape(xref.pred)}[/dim]  "
                    f"{obj_str}  [dim italic]{escape(xref.filename)}[/dim italic]"
                )
    else:
        write_records(xref_list, fmt=fmt, indent=json_indent)


@cli.command("ids")
@click.argument("curies", type=str, required=True, nargs=-1)
@babel_options
@format_option
def ids(
    curies: list[str],
    babel_url: str,
    local_dir: str,
    check_download: str,
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
    freshness = parse_duration(check_download)
    bxref = BabelXRefs(
        BabelDownloader(babel_url, local_path=local_dir, freshness_seconds=freshness)
    )
    xrefs = bxref.get_curie_ids(curies)

    if fmt == "console":
        console = make_console()
        for record in xrefs:
            console.print(str(record))
    else:
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
    if fmt == "console":
        console = make_console()
        query_set = set(curies)
        for curie in curies:
            for ident in nodenorm.get_clique_identifiers(curie):
                biolink = ", ".join(ident.biolink_type)
                console.print(
                    f"{hl_curie(curie, True)}  "
                    f"{hl_curie(ident.curie, ident.curie in query_set)}  "
                    f'"{_fmt_label(ident.label or "")}"  '
                    f"[dim]{escape(biolink)}[/dim]"
                )
    else:
        rows = [
            {"query_curie": curie, **_record_to_dict(ident)}
            for curie in curies
            for ident in nodenorm.get_clique_identifiers(curie)
        ]
        write_records(rows, fmt=fmt, indent=json_indent)


if __name__ == "__main__":
    cli()
