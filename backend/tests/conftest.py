"""Pytest fixtures for Phase 1 fidelity + API tests."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.config import settings  # noqa: E402
from app.db import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402

SAMPLES = BACKEND / "data" / "samples"


@pytest.fixture(scope="session")
def sample_simple() -> Path:
    path = SAMPLES / "01_simple_text.pdf"
    if not path.exists():
        pytest.skip("Run: python backend/scripts/generate_samples.py")
    return path


@pytest.fixture(scope="session")
def sample_image() -> Path:
    path = SAMPLES / "03_text_over_image.pdf"
    if not path.exists():
        pytest.skip("Run: python backend/scripts/generate_samples.py")
    return path


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Isolated SQLite + data dirs per test."""
    db_path = tmp_path / "test.db"
    data = tmp_path / "data"
    for sub in ("originals", "working", "exports"):
        (data / sub).mkdir(parents=True)

    monkeypatch.setattr(settings, "data_dir", data)
    monkeypatch.setattr(settings, "database_url", f"sqlite:///{db_path}")

    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)

    def _override_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
