// Tests for the parts the frames are composed from (art/parts, art/frames.json).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const frames = JSON.parse(readFileSync(join(REPO, "art", "frames.json"), "utf8"));
const parts = readdirSync(join(REPO, "art", "parts")).map((f) => f.replace(/\.txt$/, ""));

test("every grid has a recipe and every recipe a grid", () => {
  const grids = readdirSync(join(REPO, "art", "grids")).map((f) => f.replace(/\.txt$/, ""));
  assert.deepEqual(Object.keys(frames).sort(), grids.sort());
});

test("recipes only use parts that exist", () => {
  for (const [name, layers] of Object.entries(frames)) {
    for (const layer of layers) assert.ok(parts.includes(layer.part), `${name}: ${layer.part}`);
  }
});

test("the committed grids are what the parts compose to", () => {
  execFileSync("python3", [join(REPO, "tools", "compose-frames.py"), "--check"], { stdio: "pipe" });
});
