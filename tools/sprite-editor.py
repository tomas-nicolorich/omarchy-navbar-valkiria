#!/usr/bin/env python3
"""Edit Valkiria's parts and frames in the browser, with square pixels.

  tools/sprite-editor.py [--port 8737] [--no-open]

Serves tools/sprite-editor.html on localhost. Saving writes art/parts/*.txt
and art/frames.json, then runs compose-frames.py, grid-to-svg.py and
build-sprites.py, so the sheets are ready for `omarchy restart shell`.
"""

import argparse
import json
import re
import subprocess
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
PARTS = ROOT / "art" / "parts"
FRAMES = ROOT / "art" / "frames.json"
NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
CHARS = set(".#+oaB_")


def read_state():
    m = re.search(r"^var FRAME_MS = (\d+)", (ROOT / "Brain.js").read_text(), re.M)
    return {
        "parts": {p.stem: p.read_text().splitlines() for p in sorted(PARTS.glob("*.txt"))},
        "frames": json.loads(FRAMES.read_text()),
        "frameMs": int(m[1]) if m else 200,
    }


def validate(state):
    parts, frames = state["parts"], state["frames"]
    for name, rows in parts.items():
        if not NAME.match(name):
            raise ValueError(f"bad part name: {name!r}")
        if (not rows or not all(isinstance(r, str) and r for r in rows)
                or len({len(r) for r in rows}) != 1):
            raise ValueError(f"{name}: rows must be non-empty and equally wide")
        if set("".join(rows)) - CHARS:
            raise ValueError(f"{name}: unknown characters")
    # Frames are fixed by the spec and by Brain.js; the editor only redraws them.
    if set(frames) != set(json.loads(FRAMES.read_text())):
        raise ValueError("frames cannot be added or removed here")
    for name, layers in frames.items():
        for layer in layers:
            if layer.get("part") not in parts:
                raise ValueError(f"{name}: no such part {layer.get('part')!r}")
            if set(layer) - {"part", "x", "y", "far", "skip"}:
                raise ValueError(f"{name}: unknown layer field")
            if not all(type(layer.get(k, 0)) is int for k in ("x", "y", "skip")):
                raise ValueError(f"{name}: x, y and skip must be whole numbers")


def clean(layer):
    out = {"part": layer["part"], "x": layer["x"], "y": layer["y"]}
    if layer.get("far"):
        out["far"] = True
    if layer.get("skip", 0) > 0:
        out["skip"] = layer["skip"]
    return out


def write_state(state):
    PARTS.mkdir(exist_ok=True)
    for path in PARTS.glob("*.txt"):
        if path.stem not in state["parts"]:
            path.unlink()
    for name, rows in state["parts"].items():
        (PARTS / f"{name}.txt").write_text("\n".join(rows) + "\n")
    blocks = []
    for name in sorted(state["frames"]):
        layers = ",\n".join("    " + json.dumps(clean(l)) for l in state["frames"][name])
        blocks.append(f"  {json.dumps(name)}: [\n{layers}\n  ]")
    FRAMES.write_text("{\n" + ",\n".join(blocks) + "\n}\n")


def build():
    log = []
    for script in ("compose-frames.py", "grid-to-svg.py", "build-sprites.py"):
        run = subprocess.run([sys.executable, str(TOOLS / script)],
                             capture_output=True, text=True)
        if run.returncode:
            raise RuntimeError(f"{script} failed:\n{run.stderr or run.stdout}")
        log.append(run.stdout.strip().splitlines()[-1])
    return log


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def local(self):
        """Only this machine's own page may talk to us."""
        port = self.server.server_address[1]
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        origin = self.headers.get("Origin")
        return (self.headers.get("Host") in hosts
                and (origin is None or origin in {f"http://{h}" for h in hosts}))

    def send(self, code, body, kind="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.local():
            return self.send(403, {"error": "forbidden"})
        if self.path == "/":
            return self.send(200, (TOOLS / "sprite-editor.html").read_bytes(),
                             "text/html; charset=utf-8")
        if self.path == "/api/state":
            return self.send(200, read_state())
        self.send(404, {"error": "not found"})

    def do_POST(self):
        if not self.local() or self.path != "/api/save":
            return self.send(403, {"error": "forbidden"})
        try:
            state = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            validate(state)
            write_state(state)
            self.send(200, {"ok": True, "log": build()})
        except Exception as e:  # report anything to the page rather than dying
            self.send(200, {"ok": False, "error": str(e)})


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--port", type=int, default=8737)
    ap.add_argument("--no-open", action="store_true")
    args = ap.parse_args()
    server = HTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}/"
    print(f"sprite editor: {url}  (Ctrl+C to stop)")
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
