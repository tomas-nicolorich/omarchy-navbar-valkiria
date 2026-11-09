// Tests for Config.js (reading Valkiria's settings out of shell.json) and
// Menu.js (what the right-click menu offers and what each item does).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (file, names) =>
  new Function(`${readFileSync(join(REPO, file), "utf8")}\nreturn { ${names} };`)();
const Config = load("Config.js", "pluginSettings");
const Menu = load("Menu.js", "items, apply");

const ID = "tomas.valkiria";

// ----------------------------------------------------------- settings

test("settings come from the plugins[] entry", () => {
  const json = { plugins: [{ id: ID, speed: 2 }, { id: "other", speed: 9 }] };
  assert.deepEqual(Config.pluginSettings(json, ID), { id: ID, speed: 2 });
});

test("settings written by the shell land on the bar-layout entry, and are read back from there", () => {
  const json = { bar: { layout: { left: ["clock"], centerEnd: ["x", { id: ID, dnd: true, bedtime: "bed" }] } } };
  const got = Config.pluginSettings(json, ID);
  assert.equal(got.dnd, true);
  assert.equal(got.bedtime, "bed");
});

test("the layout entry wins over plugins[] when both carry a key", () => {
  const json = {
    plugins: [{ id: ID, dnd: false, speed: 2 }],
    bar: { layout: { centerEnd: [{ id: ID, dnd: true }] } },
  };
  const got = Config.pluginSettings(json, ID);
  assert.equal(got.dnd, true);
  assert.equal(got.speed, 2);
});

test("a bare string layout entry, a missing file and junk all give empty settings", () => {
  assert.deepEqual(Config.pluginSettings({ bar: { layout: { left: [ID] } } }, ID), {});
  assert.deepEqual(Config.pluginSettings({}, ID), {});
  assert.deepEqual(Config.pluginSettings(null, ID), {});
  assert.deepEqual(Config.pluginSettings({ plugins: "no", bar: { layout: 5 } }, ID), {});
});

// --------------------------------------------------------------- menu

test("the menu offers walkies, bedtime, treat and do not disturb", () => {
  const rows = Menu.items({ sleeping: false, dnd: false });
  assert.deepEqual(rows.map((r) => r.id), ["walkies", "bedtime", "treat", "dnd"]);
  assert.deepEqual(rows.map((r) => r.labelKey),
    ["menu.walkies", "menu.bedtime", "menu.treat", "menu.dnd"]);
});

test("while she sleeps the bedtime row becomes Wake up", () => {
  const rows = Menu.items({ sleeping: true, dnd: false });
  assert.equal(rows[1].id, "wake");
  assert.equal(rows[1].labelKey, "menu.wake");
});

test("the do not disturb row shows whether it is on", () => {
  assert.equal(Menu.items({ sleeping: false, dnd: true })[3].active, true);
  assert.equal(Menu.items({ sleeping: false, dnd: false })[3].active, false);
});

test("choosing an item says what to save and what to command", () => {
  const now = 123;
  assert.deepEqual(Menu.apply("walkies", {}, now), { command: { at: 123, kind: "walkies" } });
  assert.deepEqual(Menu.apply("treat", {}, now), { command: { at: 123, kind: "treat" } });
  assert.deepEqual(Menu.apply("bedtime", {}, now), { patch: { bedtime: "bed" } });
  assert.deepEqual(Menu.apply("wake", {}, now), { patch: { bedtime: "up" } });
  assert.deepEqual(Menu.apply("dnd", { dnd: false }, now), { patch: { dnd: true } });
  assert.deepEqual(Menu.apply("dnd", { dnd: true }, now), { patch: { dnd: false } });
  assert.deepEqual(Menu.apply("nonsense", {}, now), {});
});
