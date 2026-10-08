#!/usr/bin/env python3
"""Generates build/icon.ico (multi-size, for the Windows exe/installer) and build/icon.png from the brand logo.
Run:  python3 scripts/make-icons.py      (needs Pillow: pip install pillow)
The generated files are committed, so you only need this if the logo changes."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
src = Image.open(root / "public" / "brand" / "logo-512.png").convert("RGBA")
out = root / "build"
out.mkdir(exist_ok=True)
src.save(out / "icon.png")
src.save(out / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("wrote", out / "icon.png", "and", out / "icon.ico")
