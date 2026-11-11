# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the local FastAPI server (run this on Windows)."""

from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules

root = Path(SPECPATH).resolve().parent.parent
backend = root / "backend"

datas = [(str(backend / "fonts"), "fonts")]
binaries = []
hiddenimports = collect_submodules("app") + collect_submodules("uvicorn")
hiddenimports += [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "anyio",
    "httptools",
    "websockets",
    "sqlalchemy.dialects.sqlite",
    "multipart",
]


def _collect(pkg: str, required: bool = False) -> None:
    try:
        collected_datas, collected_binaries, collected_hidden = collect_all(pkg)
    except Exception as exc:  # noqa: BLE001
        message = f"could not collect {pkg}: {exc}"
        if required:
            raise SystemExit(message) from exc
        print("warning:", message)
        return
    datas.extend(collected_datas)
    binaries.extend(collected_binaries)
    hiddenimports.extend(collected_hidden)


_collect("pymupdf", required=True)
_collect("fitz")
_collect("PIL")
_collect("fontTools")

a = Analysis(
    [str(backend / "desktop_entry.py")],
    pathex=[str(backend)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["pytest", "tkinter"],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="pdf-editor-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="pdf-editor-backend",
)
