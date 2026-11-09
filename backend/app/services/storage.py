"""Filesystem helpers for originals / working / exports."""

from __future__ import annotations

import re
from pathlib import Path

from ..config import settings


def safe_stem(name: str) -> str:
    stem = Path(name).stem
    stem = re.sub(r"[^\w.\-]+", "_", stem).strip("._") or "document"
    return stem[:120]


def original_path(doc_id: str, filename: str) -> Path:
    return settings.originals_dir / f"{doc_id}__{safe_stem(filename)}.pdf"


def working_path(doc_id: str) -> Path:
    return settings.working_dir / f"{doc_id}.pdf"


def export_path(doc_id: str, filename: str) -> Path:
    stem = safe_stem(filename)
    return settings.exports_dir / f"{doc_id}__{stem}_edited.pdf"
