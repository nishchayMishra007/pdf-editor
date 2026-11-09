"""API smoke tests for Phase 1 endpoints."""

from __future__ import annotations

from pathlib import Path


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_upload_list_layout_ops_working_export(client, sample_simple: Path):
    with sample_simple.open("rb") as f:
        r = client.post(
            "/documents",
            files={"file": ("01_simple_text.pdf", f, "application/pdf")},
        )
    assert r.status_code == 200, r.text
    doc = r.json()
    doc_id = doc["id"]
    assert doc["page_count"] >= 1
    assert doc["has_text"] is True

    recent = client.get("/documents").json()
    assert any(d["id"] == doc_id for d in recent)

    layout = client.get(f"/documents/{doc_id}/pages/1/layout").json()
    assert layout["has_text"] is True
    span = layout["blocks"][0]["lines"][0]["spans"][0]

    bbox = span["bbox"]
    ops = [
        {
            "id": "r1",
            "type": "replace_text",
            "page": 0,
            "span_id": span["id"],
            "bbox": {"x0": bbox[0], "y0": bbox[1], "x1": bbox[2], "y1": bbox[3]},
            "text": "Edited",
            "original_text": span["text"],
            "font": span["font"],
            "size": span["size"],
            "color": span["color"],
        }
    ]
    put = client.put(f"/documents/{doc_id}/ops", json={"ops": ops})
    assert put.status_code == 200, put.text
    body = put.json()
    assert "r1" in body["applied"]

    working = client.get(f"/documents/{doc_id}/working")
    assert working.status_code == 200
    assert working.headers["content-type"].startswith("application/pdf")
    assert working.content[:4] == b"%PDF"

    exported = client.post(f"/documents/{doc_id}/export")
    assert exported.status_code == 200
    assert exported.content[:4] == b"%PDF"
    assert "edited.pdf" in exported.headers.get("content-disposition", "").lower()


def test_zero_ops_working_equals_original_bytes(client, sample_simple: Path):
    original = sample_simple.read_bytes()
    with sample_simple.open("rb") as f:
        doc = client.post(
            "/documents",
            files={"file": ("simple.pdf", f, "application/pdf")},
        ).json()
    working = client.get(f"/documents/{doc['id']}/working").content
    assert working == original
    exported = client.post(f"/documents/{doc['id']}/export").content
    assert exported == original
