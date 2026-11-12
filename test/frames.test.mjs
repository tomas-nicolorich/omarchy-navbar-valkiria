// Tests for the sprite pipeline: Frames.js (generated), the sheets it indexes,
// and the link between those and the poses Brain.js can ask for.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

// Frames.js is a QML library: it starts with a `.pragma` line and has no
// exports, so evaluate it the same way brain.test.mjs evaluates Brain.js.
const framesSource = readFileSync(join(REPO, "Frames.js"), "utf8")
  .split("\n").filter((l) => !l.startsWith(".pragma")).join("\n");
const Frames = new Function(`${framesSource}\nreturn { CELL_W, CELL_H, COUNT, POSES };`)();

// Frame counts straight from the spec's poses table.
const SPEC = {
  walk: 4, "walk-harness": 4, run: 4, sniff: 2, sit: 1, wag: 2, slump: 1, hover: 2, stretch: 2,
  scratch: 2, dig: 2, bark: 2, burrow: 2, blanket: 2, wriggle: 2,
  "yard-blanket": 1,
};

function pngSize(path) {
  const b = readFileSync(path);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

test("cells are 40x25", () => {
  assert.equal(Frames.CELL_W, 40);
  assert.equal(Frames.CELL_H, 25);
});

test("every spec pose has its spec frame count, and nothing else exists", () => {
  const got = Object.fromEntries(
    Object.entries(Frames.POSES).map(([k, v]) => [k, v.length]));
  assert.deepEqual(got, SPEC);
});

test("one source SVG per frame", () => {
  const files = readdirSync(join(REPO, "art")).filter((f) => f.endsWith(".svg")).sort();
  const want = [];
  for (const [pose, n] of Object.entries(SPEC)) {
    if (pose === "yard-blanket") want.push("yard-blanket.svg");
    else for (let i = 1; i <= n; i++) want.push(`${pose}-${i}.svg`);
  }
  assert.deepEqual(files, want.sort());
});

test("frame indices are distinct and fill the sheet exactly", () => {
  const all = Object.values(Frames.POSES).flat().sort((a, b) => a - b);
  assert.deepEqual(all, [...Array(Frames.COUNT).keys()]);
});

for (const [scale, tag] of [[1, "1x"], [2, "2x"]]) {
  for (const layer of ["fill", "shade", "ink", "accent"]) {
    test(`${tag} ${layer} sheet exists and is COUNT cells wide`, () => {
      const p = join(REPO, "assets", `valkiria-${tag}-${layer}.png`);
      assert.ok(existsSync(p), `${p} missing`);
      assert.deepEqual(pngSize(p), {
        w: Frames.CELL_W * scale * Frames.COUNT,
        h: Frames.CELL_H * scale,
      });
    });
  }
}

test("every SVG follows the art contract", () => {
  for (const f of readdirSync(join(REPO, "art")).filter((f) => f.endsWith(".svg"))) {
    const s = readFileSync(join(REPO, "art", f), "utf8");
    assert.match(s, /viewBox="0 0 40 25"/, f);
    for (const id of ["fill", "shade", "ink", "accent"]) {
      assert.match(s, new RegExp(`<g id="${id}"`), `${f} lacks #${id}`);
    }
  }
});

test("the harness walk differs from the plain walk in the ink layer only", () => {
  const layer = (s, id) => new RegExp(`<g id="${id}".*?</g>`, "s").exec(s)[0];
  for (let i = 1; i <= 4; i++) {
    const plain = readFileSync(join(REPO, "art", `walk-${i}.svg`), "utf8");
    const harness = readFileSync(join(REPO, "art", `walk-harness-${i}.svg`), "utf8");
    assert.equal(layer(harness, "fill"), layer(plain, "fill"));
    assert.equal(layer(harness, "shade"), layer(plain, "shade"));
    assert.equal(layer(harness, "accent"), layer(plain, "accent"));
    assert.notEqual(layer(harness, "ink"), layer(plain, "ink"));
  }
});

test("DogSprite is crisp at exactly one art pixel per device pixel, and its accent follows the theme", () => {
  const sprite = readFileSync(join(REPO, "DogSprite.qml"), "utf8");
  assert.match(sprite, /crisp:[^\n]*devicePixels/);
  for (const file of ["Valkiria.qml", "Widget.qml"]) {
    const src = readFileSync(join(REPO, file), "utf8");
    assert.match(src, /accentColor:\s*Color\./, `${file}: accentColor must come from the theme`);
  }
});

test("no leftover cat names", () => {
  for (const file of ["Valkiria.qml", "Widget.qml", "Yard.qml", "DogMenu.qml", "Menu.js", "Brain.js"]) {
    // The fork credit to navbar-cat may stay.
    const src = readFileSync(join(REPO, file), "utf8").replaceAll("navbar-cat", "");
    assert.doesNotMatch(src, /\bcat[A-Z]\w*|\bcat\b|\bCat[A-Z]\w*/, file);
  }
});

test("every pose Brain.js references has frames", () => {
  const brain = readFileSync(join(REPO, "Brain.js"), "utf8");
  const used = new Set();
  // pose: "x" / pose = "x" / `pose || "x"`, the vertical-ternary form, and
  // the script builders: hold("x", ...) / go("x", ...).
  for (const m of brain.matchAll(/pose\s*(?::|=|===|\|\|)\s*"([a-z-]+)"/g)) used.add(m[1]);
  for (const m of brain.matchAll(/pose\s*=\s*\w+\s*\?\s*"([a-z-]+)"\s*:\s*"([a-z-]+)"/g)) {
    used.add(m[1]); used.add(m[2]);
  }
  for (const m of brain.matchAll(/\b(?:hold|go)\(\s*"([a-z-]+)"/g)) used.add(m[1]);
  // Poses set only through hold()/go() must be seen, or this test is blind.
  for (const p of ["dig", "sniff", "stretch", "burrow", "hover", "walk-harness"]) {
    assert.ok(used.has(p), `extraction missed ${p}`);
  }
  const missing = [...used].filter((p) => !Frames.POSES[p]);
  assert.deepEqual(missing, []);
});
