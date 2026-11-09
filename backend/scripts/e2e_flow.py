#!/usr/bin/env python3
"""End-to-end API flow on every PDF in backend/data/samples.

Upload → layout → replace op → working → export.
Exit non-zero on failure.
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from fastapi.testclient import TestClient

from app.db import Base, get_db
from app.main import app
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

SAMPLES = BACKEND / "data" / "samples"


def main() -> int:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)

    def _override():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override

    # Redirect data dirs into /tmp via settings monkeypatch
    from app.config import settings
    import tempfile

    tmp = Path(tempfile.mkdtemp(prefix="pdf-e2e-"))
    for sub in ("originals", "working", "exports"):
        (tmp / sub).mkdir()
    settings.data_dir = tmp

    pdfs = sorted(SAMPLES.glob("*.pdf"))
    if not pdfs:
        print("No samples — run: python backend/scripts/generate_samples.py")
        return 2

    fails = 0
    with TestClient(app) as client:
        assert client.get("/health").json()["ok"]
        for pdf in pdfs:
            print(f"=== {pdf.name} ===")
            with pdf.open("rb") as f:
                r = client.post(
                    "/documents",
                    files={"file": (pdf.name, f, "application/pdf")},
                )
            if r.status_code != 200:
                print(f"  FAIL upload: {r.status_code} {r.text}")
                fails += 1
                continue
            doc = r.json()
            doc_id = doc["id"]
            layout = client.get(f"/documents/{doc_id}/pages/1/layout")
            assert layout.status_code == 200
            data = layout.json()
            working = client.get(f"/documents/{doc_id}/working")
            assert working.status_code == 200 and working.content[:4] == b"%PDF"
            original = client.get(f"/documents/{doc_id}/original")
            assert original.status_code == 200 and original.content == pdf.read_bytes()

            ops = []
            if data.get("has_text") and data.get("blocks"):
                span = data["blocks"][0]["lines"][0]["spans"][0]
                bbox = span["bbox"]
                ops = [
                    {
                        "id": "e2e-replace",
                        "type": "replace_text",
                        "page": 0,
                        "span_id": span["id"],
                        "bbox": {
                            "x0": bbox[0],
                            "y0": bbox[1],
                            "x1": bbox[2],
                            "y1": bbox[3],
                        },
                        "text": ("Z" + span["text"][1:]) if len(span["text"]) > 1 else "Z",
                        "original_text": span["text"],
                        "font": span["font"],
                        "size": span["size"],
                        "color": span["color"],
                    }
                ]
                put = client.put(f"/documents/{doc_id}/ops", json={"ops": ops})
                if put.status_code != 200:
                    print(f"  FAIL ops: {put.text}")
                    fails += 1
                    continue
                print(f"  ops applied={put.json().get('applied')}")
            else:
                print("  scanned/no-text — skip edit")

            exported = client.post(f"/documents/{doc_id}/export")
            if exported.status_code != 200 or exported.content[:4] != b"%PDF":
                print(f"  FAIL export: {exported.status_code}")
                fails += 1
                continue
            name = exported.headers.get("X-Export-Filename", "")
            print(f"  export OK → {name} ({len(exported.content)} bytes)")
            if not ops:
                if exported.content != pdf.read_bytes():
                    print("  FAIL zero-ops export bytes differ")
                    fails += 1

    app.dependency_overrides.clear()
    print(f"\nDone. {len(pdfs) - fails}/{len(pdfs)} PDFs OK, {fails} failures")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
