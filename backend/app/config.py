"""App configuration — local paths only."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND = Path(__file__).resolve().parents[1]


def user_data_dir() -> Path:
    """Writable folder for the desktop app (never inside Program Files)."""
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "PDF Editor"


def default_data_dir() -> Path:
    if getattr(sys, "frozen", False) or os.environ.get("PDF_EDITOR_DESKTOP") == "1":
        return user_data_dir()
    return BACKEND / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PDF_EDITOR_")

    data_dir: Path = default_data_dir()
    # Filled from data_dir so a Windows path never keeps backslashes in the SQLite URL.
    database_url: str = ""
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    host: str = "127.0.0.1"
    port: int = 8000

    @model_validator(mode="after")
    def fill_database_url(self) -> "Settings":
        self.data_dir = Path(self.data_dir)
        if not self.database_url:
            db_path = (self.data_dir / "editor.db").resolve().as_posix()
            self.database_url = f"sqlite:///{db_path}"
        return self

    @property
    def originals_dir(self) -> Path:
        return self.data_dir / "originals"

    @property
    def working_dir(self) -> Path:
        return self.data_dir / "working"

    @property
    def exports_dir(self) -> Path:
        return self.data_dir / "exports"

    def ensure_dirs(self) -> None:
        for d in (self.originals_dir, self.working_dir, self.exports_dir, self.data_dir):
            d.mkdir(parents=True, exist_ok=True)


settings = Settings()
