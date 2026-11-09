"""Embedded font extraction and fallback resolution."""

from __future__ import annotations

import hashlib
import logging
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import fitz

logger = logging.getLogger(__name__)

# Bundled fallbacks live next to the package (Phase 0 ships Liberation if present).
FALLBACK_DIR = Path(__file__).resolve().parents[2] / "fonts"
BUNDLED_CANDIDATES = [
    "LiberationSans-Regular.ttf",
    "LiberationSerif-Regular.ttf",
    "NotoSans-Regular.ttf",
    "Inter-Regular.ttf",
]


@dataclass
class FontResolution:
    fontname: str  # name registered with page.insert_font / used in insert_text
    buffer: Optional[bytes]  # raw TTF/OTF if we extracted or loaded a file
    source: str  # "embedded" | "bundled" | "base14"
    warning: Optional[str] = None


def _sha(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()[:12]


def extract_page_fonts(doc: fitz.Document, page: fitz.Page) -> dict[str, bytes]:
    """Extract embeddable font buffers keyed by PDF font name / xref."""
    fonts: dict[str, bytes] = {}
    for item in page.get_fonts(full=True):
        # (xref, ext, type, basefont, name, encoding, stream_xref)
        xref = item[0]
        ext = item[1]
        basefont = item[3]
        name = item[4]
        try:
            extracted = doc.extract_font(xref)
            # returns (basename, ext, subtype, buffer)
            if not extracted or len(extracted) < 4:
                continue
            buf = extracted[3]
            if not buf:
                continue
            key = name or basefont
            fonts[key] = buf
            fonts[basefont] = buf
            # also index by short name without subset prefix (ABCDEF+)
            if "+" in basefont:
                fonts[basefont.split("+", 1)[1]] = buf
            fonts[f"xref:{xref}"] = buf
            fonts[f"{key}.{ext}"] = buf
        except Exception as exc:  # noqa: BLE001
            logger.debug("extract_font failed xref=%s: %s", xref, exc)
    return fonts


def find_bundled_font(prefer: str = "sans") -> Optional[Path]:
    FALLBACK_DIR.mkdir(parents=True, exist_ok=True)
    prefer_order = BUNDLED_CANDIDATES[:]
    if prefer == "serif":
        prefer_order = [
            "LiberationSerif-Regular.ttf",
            "LiberationSans-Regular.ttf",
            "NotoSans-Regular.ttf",
            "Inter-Regular.ttf",
        ]
    for name in prefer_order:
        p = FALLBACK_DIR / name
        if p.exists():
            return p
    return None


def ensure_bundled_fonts() -> list[Path]:
    """Copy system Liberation/DejaVu fonts into backend/fonts if available."""
    FALLBACK_DIR.mkdir(parents=True, exist_ok=True)
    found: list[Path] = []
    search_roots = [
        Path("/System/Library/Fonts"),
        Path("/Library/Fonts"),
        Path("/usr/share/fonts"),
        Path("/usr/local/share/fonts"),
        Path.home() / "Library/Fonts",
    ]
    # Prefer exact libre font filenames; avoid Arial Narrow etc. which skew metrics.
    hunt = {
        "LiberationSans-Regular.ttf": [
            "LiberationSans-Regular.ttf",
            "DejaVuSans.ttf",
        ],
        "LiberationSerif-Regular.ttf": [
            "LiberationSerif-Regular.ttf",
            "DejaVuSerif.ttf",
        ],
        "NotoSans-Regular.ttf": ["NotoSans-Regular.ttf"],
        "Inter-Regular.ttf": ["Inter-Regular.ttf", "Inter.ttf"],
    }

    for dest_name, needles in hunt.items():
        dest = FALLBACK_DIR / dest_name
        if dest.exists() and dest.stat().st_size > 1000:
            # Reject previously mis-copied fonts (e.g. Arial Narrow labeled as Liberation)
            try:
                from fontTools.ttLib import TTFont

                family = (TTFont(dest)["name"].getDebugName(1) or "").lower()
                if dest_name.startswith("Liberation") and "liberation" not in family and "dejavu" not in family:
                    dest.unlink(missing_ok=True)
                else:
                    found.append(dest)
                    continue
            except Exception:  # noqa: BLE001
                found.append(dest)
                continue
        for root in search_roots:
            if not root.exists():
                continue
            for needle in needles:
                matches = list(root.rglob(needle))
                for path in matches:
                    if not path.is_file():
                        continue
                    try:
                        shutil.copy2(path, dest)
                        found.append(dest)
                        break
                    except OSError:
                        continue
                if dest.exists():
                    break
            if dest.exists():
                break
    return found


def _norm_font_key(name: str) -> str:
    """Normalize font names for fuzzy matching (spaces/hyphens/case)."""
    s = name.split("+")[-1].lower()
    return "".join(ch for ch in s if ch.isalnum())


def resolve_font(
    doc: fitz.Document,
    page: fitz.Page,
    span_font: str,
    *,
    extracted_cache: Optional[dict[str, bytes]] = None,
) -> FontResolution:
    """Resolve a usable font for insertion, preferring the PDF's embedded font."""
    cache = extracted_cache if extracted_cache is not None else extract_page_fonts(doc, page)

    # Direct match
    for key in (span_font, span_font.split("+")[-1] if "+" in span_font else span_font):
        if key in cache:
            return FontResolution(
                fontname=f"emb_{_sha(cache[key])}",
                buffer=cache[key],
                source="embedded",
            )

    # Normalized / fuzzy match against extracted fonts
    stem = _norm_font_key(span_font)
    for key, buf in cache.items():
        nk = _norm_font_key(key)
        if stem and (stem == nk or stem in nk or nk in stem):
            return FontResolution(
                fontname=f"emb_{_sha(buf)}",
                buffer=buf,
                source="embedded",
            )

    # If the page has exactly one embeddable font buffer, reuse it.
    unique_bufs = {id(b): b for b in cache.values()}
    if len(unique_bufs) == 1:
        buf = next(iter(unique_bufs.values()))
        return FontResolution(
            fontname=f"emb_{_sha(buf)}",
            buffer=buf,
            source="embedded",
        )

    # Standard PDF Base-14 / common Windows names → built-in Base-14 (no embed needed)
    base14_map = {
        "timesroman": "times",
        "timesnewroman": "times",
        "timesnewromanpsmt": "times",
        "times": "times",
        "timesbold": "tiib",
        "timesitalic": "tii",
        "timesbolditalic": "tibi",
        "helvetica": "helv",
        "arial": "helv",
        "arialmt": "helv",
        "arialnarrow": "helv",
        "courier": "cour",
        "couriernew": "cour",
        "symbol": "symb",
        "zapfdingbats": "zabd",
    }
    if stem in base14_map:
        # Prefer a metric-compatible Liberation buffer so insert_textbox works
        # (Base-14 names alone are rejected by textbox in recent PyMuPDF).
        prefer = "serif" if "times" in stem or "roman" in stem else "sans"
        bundled = find_bundled_font(prefer)
        if bundled:
            return FontResolution(
                fontname=f"b14_{_sha(bundled.read_bytes())}",
                buffer=bundled.read_bytes(),
                source="base14",
                warning=None,
            )
        return FontResolution(
            fontname=base14_map[stem],
            buffer=None,
            source="base14",
            warning=None,
        )

    # Bundled fallback (metric-compatible Liberation preferred)
    prefer = "serif" if any(s in stem for s in ("serif", "times", "georgia", "roman")) else "sans"
    bundled = find_bundled_font(prefer)
    if bundled:
        buf = bundled.read_bytes()
        return FontResolution(
            fontname=f"fb_{_sha(buf)}",
            buffer=buf,
            source="bundled",
            warning=f"Glyph/font '{span_font}' unavailable; using bundled {bundled.name}",
        )

    # Last resort: Base-14 Helvetica (always available, metrics will differ)
    return FontResolution(
        fontname="helv",
        buffer=None,
        source="base14",
        warning=f"Font '{span_font}' unavailable; using Base-14 Helvetica (metrics may differ)",
    )


def missing_glyphs(font_buffer: Optional[bytes], text: str) -> list[str]:
    """Return characters in ``text`` that the font cannot render (excl. whitespace)."""
    if not font_buffer or not text:
        return []
    try:
        from fontTools.ttLib import TTFont  # type: ignore
        import io

        tt = TTFont(io.BytesIO(font_buffer))
        cmap = tt.getBestCmap() or {}
        missing: list[str] = []
        for ch in text:
            if ch.isspace():
                continue
            if ord(ch) not in cmap:
                missing.append(ch)
        return missing
    except Exception:  # noqa: BLE001
        return []


def font_has_glyphs(font_buffer: Optional[bytes], text: str) -> bool:
    """Best-effort check that every codepoint exists in the font."""
    return not missing_glyphs(font_buffer, text)
