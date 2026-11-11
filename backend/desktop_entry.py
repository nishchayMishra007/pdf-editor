"""Start the local API. Used by the desktop app and start-windows.bat."""

from __future__ import annotations

import logging
import multiprocessing
import sys


def main() -> None:
    from app.config import settings

    settings.ensure_dirs()
    log_dir = settings.data_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    handlers: list[logging.Handler] = [
        logging.FileHandler(log_dir / "backend.log", encoding="utf-8")
    ]
    stream = sys.stdout if sys.stdout is not None else sys.stderr
    if stream is not None:
        handlers.append(logging.StreamHandler(stream))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=handlers,
    )

    import uvicorn
    from app.main import app

    logging.getLogger("pdf-editor").info(
        "Desktop server on http://%s:%s (data: %s)",
        settings.host,
        settings.port,
        settings.data_dir,
    )
    uvicorn.run(
        app,
        host=settings.host,
        port=int(settings.port),
        log_level="info",
        access_log=False,
    )


def _write_startup_error(message: str) -> None:
    import os
    from pathlib import Path

    candidates = []
    data_dir = os.environ.get("PDF_EDITOR_DATA_DIR")
    if data_dir:
        candidates.append(Path(data_dir) / "logs" / "backend.log")
    candidates.append(Path.cwd() / "startup-error.log")
    for path in candidates:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as handle:
                handle.write(message)
                if not message.endswith("\n"):
                    handle.write("\n")
            return
        except OSError:
            continue


if __name__ == "__main__":
    multiprocessing.freeze_support()
    try:
        main()
    except Exception:
        import traceback

        _write_startup_error(traceback.format_exc())
        raise
