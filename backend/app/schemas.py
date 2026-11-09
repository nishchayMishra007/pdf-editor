"""Pydantic API schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from .ops.models import EditOp


class DocumentOut(BaseModel):
    id: str
    name: str
    page_count: int
    has_text: bool
    has_file: bool = False
    created_at: datetime
    updated_at: datetime
    warnings: list[str] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class RenameIn(BaseModel):
    name: str = Field(min_length=1, max_length=512)


class OpsPut(BaseModel):
    ops: list[EditOp]


class OpsPutResult(BaseModel):
    id: str
    applied: list[str]
    skipped: list[str]
    warnings: list[str]
    op_metrics: list[dict[str, Any]] = Field(default_factory=list)


class LayoutOut(BaseModel):
    page: int
    width: float
    height: float
    rotation: int
    has_text: bool
    blocks: list[dict[str, Any]]
    message: Optional[str] = None


class ExportOut(BaseModel):
    filename: str
    warnings: list[str] = Field(default_factory=list)
