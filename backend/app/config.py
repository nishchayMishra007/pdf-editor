"""App configuration — local paths only."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PDF_EDITOR_")

    data_dir: Path = BACKEND / "data"
    database_url: str = f"sqlite:///{BACKEND / 'data' / 'editor.db'}"
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    host: str = "127.0.0.1"
    port: int = 8000

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
