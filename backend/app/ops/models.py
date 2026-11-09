"""Edit operation models (JSON-serializable)."""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class OpType(str, Enum):
    REPLACE_TEXT = "replace_text"
    MOVE = "move"
    DUPLICATE = "duplicate"
    DELETE = "delete"
    ADD_TEXT = "add_text"


class BBox(BaseModel):
    x0: float
    y0: float
    x1: float
    y1: float

    def as_rect(self) -> tuple[float, float, float, float]:
        return (self.x0, self.y0, self.x1, self.y1)

    def width(self) -> float:
        return self.x1 - self.x0

    def height(self) -> float:
        return self.y1 - self.y0

    def translated(self, dx: float, dy: float) -> "BBox":
        return BBox(x0=self.x0 + dx, y0=self.y0 + dy, x1=self.x1 + dx, y1=self.y1 + dy)


class EditOp(BaseModel):
    """A single edit applied at export / working-PDF time.

    Targeting:
      - `span_id` preferred when available (page:block:line:span)
      - else `bbox` + `page` + optional original `text` for disambiguation
    """

    id: str
    type: OpType
    page: int = Field(..., ge=0, description="0-based page index")
    span_id: Optional[str] = None
    bbox: Optional[BBox] = None
    # replace_text / add_text / duplicate
    text: Optional[str] = None
    # move / duplicate destination
    new_bbox: Optional[BBox] = None
    # typography locked from original (copied into ops for replay)
    font: Optional[str] = None
    size: Optional[float] = None
    color: Optional[tuple[float, float, float]] = None
    # optional original text for targeting
    original_text: Optional[str] = None
    meta: dict[str, Any] = Field(default_factory=dict)
