#!/usr/bin/env python3
"""Turn ASCII pixel grids in art/grids/*.txt into art/*.svg frames.

A grid is 25 lines of 40 characters (lines starting with ';' are comments):
  .  empty      #  fill      o  ink (+fill)      a  accent (+fill)
  +  shade (+fill): fill dimmed halfway to the bar, for her ear and far legs

  tools/grid-to-svg.py                  convert every grid
  tools/grid-to-svg.py walk-1 sit-1     convert only these
  tools/grid-to-svg.py --preview out.png [names...]
                                        also write an enlarged, coloured
                                        contact sheet for checking the art
"""

import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GRIDS = ROOT / "art" / "grids"
ART = ROOT / "art"
W, H = 40, 25
LAYERS = {"fill": "#+oa", "shade": "+", "ink": "o", "accent": "a"}
PREVIEW = {"#": "#4a4f63", "+": "#8d909c", "o": "#111318", "a": "#d08a3c"}


def load(path):
    rows = [l.rstrip("\n") for l in path.read_text().splitlines()
            if not l.startswith(";")]
    if len(rows) != H:
        sys.exit(f"{path.name}: {len(rows)} rows, want {H}")
    for i, row in enumerate(rows):
        if len(row) != W:
            sys.exit(f"{path.name}: row {i} is {len(row)} wide, want {W}")
        bad = set(row) - set(".#+oa")
        if bad:
            sys.exit(f"{path.name}: row {i} has unknown chars {sorted(bad)}")
    return rows


def runs(rows, chars):
    for y, row in enumerate(rows):
        x = 0
        while x < W:
            if row[x] in chars:
                start = x
                while x < W and row[x] in chars:
                    x += 1
                yield start, y, x - start
            else:
                x += 1


def to_svg(rows):
    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 25" '
           'width="40" height="25">']
    for layer, chars in LAYERS.items():
        rects = "".join(f'<rect x="{x}" y="{y}" width="{w}" height="1"/>'
                        for x, y, w in runs(rows, chars))
        out.append(f'  <g id="{layer}" fill="#000" '
                   f'shape-rendering="crispEdges">{rects}</g>')
    out.append("</svg>\n")
    return "\n".join(out)


def preview_svg(rows, scale=12):
    w, h = W * scale, H * scale
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}">',
             f'<rect width="{w}" height="{h}" fill="#e8e4da"/>']
    for y, row in enumerate(rows):
        for x, c in enumerate(row):
            if c in PREVIEW:
                parts.append(f'<rect x="{x*scale}" y="{y*scale}" width="{scale}" '
                             f'height="{scale}" fill="{PREVIEW[c]}"/>')
    for x in range(0, W + 1):
        op = 0.35 if x % 5 == 0 else 0.12
        parts.append(f'<line x1="{x*scale}" y1="0" x2="{x*scale}" y2="{h}" '
                     f'stroke="#000" stroke-opacity="{op}"/>')
    for y in range(0, H + 1):
        op = 0.35 if y % 5 == 0 else 0.12
        parts.append(f'<line x1="0" y1="{y*scale}" x2="{w}" y2="{y*scale}" '
                     f'stroke="#000" stroke-opacity="{op}"/>')
    # baseline: feet must end on row 22
    parts.append(f'<line x1="0" y1="{23*scale}" x2="{w}" y2="{23*scale}" '
                 f'stroke="#c0392b" stroke-width="2"/>')
    parts.append("</svg>")
    return "\n".join(parts)


def main(argv):
    preview = None
    if argv[:1] == ["--preview"]:
        preview, argv = Path(argv[1]).resolve(), argv[2:]
    paths = ([GRIDS / f"{n}.txt" for n in argv] if argv
             else sorted(GRIDS.glob("*.txt")))
    with tempfile.TemporaryDirectory() as tmp:
        pngs = []
        for path in paths:
            rows = load(path)
            (ART / f"{path.stem}.svg").write_text(to_svg(rows))
            print(f"art/{path.stem}.svg")
            if preview:
                svg = Path(tmp) / f"{path.stem}.svg"
                png = Path(tmp) / f"{path.stem}.png"
                svg.write_text(preview_svg(rows))
                subprocess.run(["rsvg-convert", "-o", str(png), str(svg)],
                               check=True)
                pngs.append(png)
        if preview:
            subprocess.run(["magick", "montage", *map(str, pngs), "-tile", "2x",
                            "-geometry", "+8+8", "-label", "%t",
                            str(preview)], check=True)
            print(f"preview: {preview}")


if __name__ == "__main__":
    main(sys.argv[1:])
