from pathlib import Path

from fastapi import FastAPI
from fastapi.templating import Jinja2Templates

from babel_explorer.core.downloader import BabelDownloader
from babel_explorer.core.babel_xrefs import BabelXRefs
from babel_explorer.core.nodenorm import NodeNorm

TEMPLATES_DIR = Path(__file__).parent / "templates"


def create_app(
    local_dir: str | None = None,
    babel_url: str | None = None,
    nodenorm_url: str | None = None,
) -> FastAPI:
    import os

    local_dir = local_dir or os.environ.get("BABEL_LOCAL_DIR", "data/2025nov19")
    babel_url = babel_url or os.environ.get(
        "BABEL_URL", "https://stars.renci.org:443/var/babel/2025nov19/"
    )
    nodenorm_url = nodenorm_url or os.environ.get(
        "BABEL_NODENORM_URL", "https://nodenormalization-sri.renci.org/"
    )
    app = FastAPI(title="Babel Explorer")

    app.state.templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
    app.state.nodenorm_url = nodenorm_url
    app.state.downloader = BabelDownloader(babel_url, local_path=local_dir)
    app.state.nodenorm = NodeNorm(nodenorm_url)
    app.state.bxref = BabelXRefs(app.state.downloader, app.state.nodenorm)

    from babel_explorer.web.routes import router

    app.include_router(router)
    return app
