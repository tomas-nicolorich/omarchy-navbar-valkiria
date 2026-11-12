#!/usr/bin/env python3
"""Compose art/parts/*.txt into the frame grids in art/grids/*.txt.

art/frames.json lists, for each frame, the parts stamped onto it in order
(later ones cover earlier ones):

  {"part": "hind-mid", "x": 10, "y": 17, "far": true, "skip": 2}

  x, y   where the part's top-left corner lands in the 40x25 frame
  far    draw it as a far-side limb: fill and accent become shade
  skip   leave out the part's top N rows

A part is a rectangle of the grid characters plus three of its own:
  .  transparent      _  erase what is underneath      B  blanket gingham

  tools/compose-frames.py            write every grid
  tools/compose-frames.py --check    write nothing; fail if a grid is stale
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARTS = ROOT / "art" / "parts"
FRAMES = ROOT / "art" / "frames.json"
GRIDS = ROOT / "art" / "grids"
W, H = 40, 25


def load_parts():
    parts = {}
    for path in sorted(PARTS.glob("*.txt")):
        rows = path.read_text().splitlines()
        if not rows or len({len(r) for r in rows}) != 1:
            sys.exit(f"{path.name}: rows must all be the same width")
        bad = set("".join(rows)) - set(".#+oaB_")
        if bad:
            sys.exit(f"{path.name}: unknown chars {sorted(bad)}")
        parts[path.stem] = rows
    return parts


def compose(parts, layers):
    grid = [["."] * W for _ in range(H)]
    for layer in layers:
        rows = parts[layer["part"]]
        for dy, row in enumerate(rows):
            if dy < layer.get("skip", 0):
                continue
            for dx, c in enumerate(row):
                x, y = layer["x"] + dx, layer["y"] + dy
                if c == "." or not (0 <= x < W and 0 <= y < H):
                    continue
                if c == "_":
                    c = "."
                elif c == "B":
                    c = "#+a"[(x // 2) % 2 + (y // 2) % 2]
                elif layer.get("far") and c in "#a":
                    c = "+"
                grid[y][x] = c
    return "\n".join("".join(r) for r in grid) + "\n"


def main(argv):
    check = argv == ["--check"]
    parts = load_parts()
    frames = json.loads(FRAMES.read_text())
    stale = []
    for name, layers in frames.items():
        missing = [l["part"] for l in layers if l["part"] not in parts]
        if missing:
            sys.exit(f"{name}: no such part {missing[0]}")
        text = compose(parts, layers)
        path = GRIDS / f"{name}.txt"
        if check:
            if not path.exists() or path.read_text() != text:
                stale.append(name)
        else:
            path.write_text(text)
    if stale:
        sys.exit("stale grids (run tools/compose-frames.py): " + ", ".join(stale))
    print(f"{len(frames)} frames from {len(parts)} parts")


if __name__ == "__main__":
    main(sys.argv[1:])
