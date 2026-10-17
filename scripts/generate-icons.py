"""Render the extension's SVG source to browser-compatible PNG icon sizes.

Requires CairoSVG and Pillow: python -m pip install cairosvg pillow
Run from any directory with: python scripts/generate-icons.py
"""

from io import BytesIO
from pathlib import Path

import cairosvg
from PIL import Image


icon_dir = Path(__file__).resolve().parent.parent / "extension" / "icons"
source = icon_dir / "millennium-eye.svg"
# Supersampling keeps curves smooth at toolbar sizes.
rendered = cairosvg.svg2png(url=str(source), output_width=1024, output_height=1024)
with Image.open(BytesIO(rendered)) as master:
    for size in (16, 19, 24, 32, 38, 48, 64, 128):
        master.resize((size, size), Image.Resampling.LANCZOS).save(
            icon_dir / f"icon-{size}.png", optimize=True
        )
