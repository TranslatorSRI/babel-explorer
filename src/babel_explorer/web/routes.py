import csv
import io
import logging

from fastapi import APIRouter, Form, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

from babel_explorer.core.nodenorm import NodeNorm

router = APIRouter()
logger = logging.getLogger(__name__)


def _parse_curies(raw: str) -> list[str]:
    """Split a textarea string into a deduplicated list of CURIEs."""
    curies = []
    seen = set()
    for line in raw.splitlines():
        c = line.strip()
        if c and not c.startswith("#") and c not in seen:
            curies.append(c)
            seen.add(c)
    return curies


def _csv_response(rows: list[list[str]], headers: list[str], filename: str):
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    writer.writerows(rows)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


def _render(request: Request, template: str, context: dict | None = None):
    ctx = context or {}
    return request.app.state.templates.TemplateResponse(request, template, ctx)


# ---------------------------------------------------------------------------
# HTML pages
# ---------------------------------------------------------------------------

@router.get("/")
def index(request: Request):
    return _render(request, "index.html")


@router.get("/nodenorm")
def nodenorm_page(request: Request):
    return _render(request, "nodenorm.html", {"default_url": request.app.state.nodenorm_url})


@router.get("/xrefs")
def xrefs_page(request: Request):
    return _render(request, "xrefs.html")


@router.get("/ids")
def ids_page(request: Request):
    return _render(request, "ids.html")


@router.get("/test-concord")
def test_concord_page(request: Request):
    return _render(request, "test_concord.html", {"default_url": request.app.state.nodenorm_url})


# ---------------------------------------------------------------------------
# htmx partials
# ---------------------------------------------------------------------------

@router.post("/htmx/nodenorm")
def htmx_nodenorm(request: Request, curies: str = Form(""), nodenorm_url: str = Form("")):
    parsed = _parse_curies(curies)
    if not parsed:
        return _render(request, "_partials/error.html", {"message": "No CURIEs provided."})
    try:
        nn = NodeNorm(nodenorm_url) if nodenorm_url else request.app.state.nodenorm
        rows = []
        for curie in parsed:
            ident = nn.get_identifier(curie)
            rows.append({
                "input_curie": curie,
                "normalized_curie": ident.curie,
                "label": ident.label,
                "biolink_type": ident.biolink_type,
                "taxa": ", ".join(ident.taxa) if ident.taxa else "",
                "description": "; ".join(ident.description) if ident.description else "",
            })
        return _render(request, "_partials/nodenorm_results.html", {"rows": rows})
    except Exception as exc:
        logger.exception("NodeNorm lookup failed")
        return _render(request, "_partials/error.html", {"message": str(exc)})


@router.post("/htmx/xrefs")
def htmx_xrefs(
    request: Request,
    curies: str = Form(""),
    expand: bool = Form(False),
    labels: bool = Form(False),
):
    parsed = _parse_curies(curies)
    if not parsed:
        return _render(request, "_partials/error.html", {"message": "No CURIEs provided."})
    try:
        bxref = request.app.state.bxref
        xrefs = bxref.get_curie_xrefs(parsed, expand=expand, label_curies=labels)
        has_labels = labels and len(xrefs) > 0 and hasattr(xrefs[0], "subj_label")
        return _render(request, "_partials/xrefs_results.html", {"xrefs": xrefs, "has_labels": has_labels})
    except Exception as exc:
        logger.exception("XRefs lookup failed")
        return _render(request, "_partials/error.html", {"message": str(exc)})


@router.post("/htmx/ids")
def htmx_ids(request: Request, curies: str = Form("")):
    parsed = _parse_curies(curies)
    if not parsed:
        return _render(request, "_partials/error.html", {"message": "No CURIEs provided."})
    try:
        bxref = request.app.state.bxref
        records = bxref.get_curie_ids(parsed)
        extra_names = []
        seen = set()
        for rec in records:
            for name, _ in rec.extra_fields:
                if name not in seen:
                    extra_names.append(name)
                    seen.add(name)
        return _render(request, "_partials/ids_results.html", {"records": records, "extra_names": extra_names})
    except Exception as exc:
        logger.exception("IDs lookup failed")
        return _render(request, "_partials/error.html", {"message": str(exc)})


@router.post("/htmx/test-concord")
def htmx_test_concord(request: Request, curies: str = Form(""), nodenorm_url: str = Form("")):
    parsed = _parse_curies(curies)
    if not parsed:
        return _render(request, "_partials/error.html", {"message": "No CURIEs provided."})
    try:
        nn = NodeNorm(nodenorm_url) if nodenorm_url else request.app.state.nodenorm
        rows = []
        for curie in parsed:
            identifiers = nn.get_clique_identifiers(curie)
            if identifiers:
                for ident in identifiers:
                    rows.append({
                        "source_curie": curie,
                        "identifier": ident.curie,
                        "label": ident.label,
                        "biolink_type": ident.biolink_type,
                    })
        return _render(request, "_partials/test_concord_results.html", {"rows": rows})
    except Exception as exc:
        logger.exception("Test Concordance lookup failed")
        return _render(request, "_partials/error.html", {"message": str(exc)})


# ---------------------------------------------------------------------------
# JSON API
# ---------------------------------------------------------------------------

@router.get("/api/nodenorm")
def api_nodenorm(request: Request, curie: list[str] = Query(...), nodenorm_url: str = Query("")):
    nn = NodeNorm(nodenorm_url) if nodenorm_url else request.app.state.nodenorm
    results = []
    for c in curie:
        ident = nn.get_identifier(c)
        results.append({
            "input_curie": c,
            "normalized_curie": ident.curie,
            "label": ident.label,
            "biolink_type": ident.biolink_type,
            "taxa": ident.taxa,
            "description": ident.description,
        })
    return JSONResponse(results)


@router.get("/api/xrefs")
def api_xrefs(
    request: Request,
    curie: list[str] = Query(...),
    expand: bool = Query(False),
    labels: bool = Query(False),
):
    bxref = request.app.state.bxref
    xrefs = bxref.get_curie_xrefs(list(curie), expand=expand, label_curies=labels)
    results = []
    for xref in xrefs:
        row = {"filename": xref.filename, "subj": xref.subj, "pred": xref.pred, "obj": xref.obj}
        if hasattr(xref, "subj_label"):
            row.update({
                "subj_label": xref.subj_label,
                "subj_biolink_type": xref.subj_biolink_type,
                "obj_label": xref.obj_label,
                "obj_biolink_type": xref.obj_biolink_type,
            })
        results.append(row)
    return JSONResponse(results)


@router.get("/api/ids")
def api_ids(request: Request, curie: list[str] = Query(...)):
    bxref = request.app.state.bxref
    records = bxref.get_curie_ids(list(curie))
    results = []
    for rec in records:
        row = {"curie": rec.curie}
        for name, value in rec.extra_fields:
            row[name] = value
        results.append(row)
    return JSONResponse(results)


@router.get("/api/test-concord")
def api_test_concord(request: Request, curie: list[str] = Query(...), nodenorm_url: str = Query("")):
    nn = NodeNorm(nodenorm_url) if nodenorm_url else request.app.state.nodenorm
    results = []
    for c in curie:
        identifiers = nn.get_clique_identifiers(c)
        if identifiers:
            for ident in identifiers:
                results.append({
                    "source_curie": c,
                    "identifier": ident.curie,
                    "label": ident.label,
                    "biolink_type": ident.biolink_type,
                })
    return JSONResponse(results)


# ---------------------------------------------------------------------------
# CSV downloads
# ---------------------------------------------------------------------------

@router.get("/api/nodenorm/csv")
def api_nodenorm_csv(request: Request, curie: list[str] = Query(...), nodenorm_url: str = Query("")):
    nn = NodeNorm(nodenorm_url) if nodenorm_url else request.app.state.nodenorm
    headers = ["Input CURIE", "Normalized CURIE", "Label", "Biolink Type", "Taxa", "Description"]
    rows = []
    for c in curie:
        ident = nn.get_identifier(c)
        rows.append([
            c, ident.curie, ident.label, ident.biolink_type,
            ", ".join(ident.taxa) if ident.taxa else "",
            "; ".join(ident.description) if ident.description else "",
        ])
    return _csv_response(rows, headers, "nodenorm.csv")


@router.get("/api/xrefs/csv")
def api_xrefs_csv(
    request: Request,
    curie: list[str] = Query(...),
    expand: bool = Query(False),
    labels: bool = Query(False),
):
    bxref = request.app.state.bxref
    xrefs = bxref.get_curie_xrefs(list(curie), expand=expand, label_curies=labels)
    if labels and xrefs and hasattr(xrefs[0], "subj_label"):
        headers = ["Filename", "Subject", "Subject Label", "Subject Type", "Predicate", "Object", "Object Label", "Object Type"]
        rows = [[x.filename, x.subj, x.subj_label, x.subj_biolink_type, x.pred, x.obj, x.obj_label, x.obj_biolink_type] for x in xrefs]
    else:
        headers = ["Filename", "Subject", "Predicate", "Object"]
        rows = [[x.filename, x.subj, x.pred, x.obj] for x in xrefs]
    return _csv_response(rows, headers, "xrefs.csv")


@router.get("/api/ids/csv")
def api_ids_csv(request: Request, curie: list[str] = Query(...)):
    bxref = request.app.state.bxref
    records = bxref.get_curie_ids(list(curie))
    extra_names = []
    seen = set()
    for rec in records:
        for name, _ in rec.extra_fields:
            if name not in seen:
                extra_names.append(name)
                seen.add(name)
    headers = ["CURIE"] + extra_names
    rows = []
    for rec in records:
        extras = dict(rec.extra_fields)
        rows.append([rec.curie] + [extras.get(n, "") for n in extra_names])
    return _csv_response(rows, headers, "ids.csv")


@router.get("/api/test-concord/csv")
def api_test_concord_csv(request: Request, curie: list[str] = Query(...), nodenorm_url: str = Query("")):
    nn = NodeNorm(nodenorm_url) if nodenorm_url else request.app.state.nodenorm
    headers = ["Source CURIE", "Identifier", "Label", "Biolink Type"]
    rows = []
    for c in curie:
        identifiers = nn.get_clique_identifiers(c)
        if identifiers:
            for ident in identifiers:
                rows.append([c, ident.curie, ident.label, ident.biolink_type])
    return _csv_response(rows, headers, "test_concord.csv")
