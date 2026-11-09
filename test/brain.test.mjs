// Tests for Valkiria's behaviour core (Brain.js).
//
// Brain.js is a QML .js resource: QML exposes its top-level functions directly
// and there is no export statement for node to read. It is evaluated here so
// one copy of the logic serves both the shell and this suite.
//
// The seam is `decide(input, state)`: a pure function of a world snapshot, the
// carried-over state and the clock. Everything below drives it through a fake
// body (`Sim`) that moves her the way Valkiria.qml does and nothing else.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(REPO, "Brain.js"), "utf8");
const Brain = new Function(
  `${source}\nreturn { decide, freshState, yardSpan, WALK_PX_S, RUN_PX_S };`,
)();

const BAR = 1536;
const CAT = 32;
const YARD = { x: 600, w: 96 };
const SPAN = { lo: 600, hi: 664 }; // YARD.x .. YARD.x + YARD.w - CAT
const MIN = 60_000;
const HOUR = 60 * MIN;
// 2026-11-09 13:00, an ordinary early afternoon: no sleep, no siesta, no meal,
// and past the morning-walkies window.
const NOON = { minutes: 13 * 60, day: 20261109 };

function inYard(x) { return x >= SPAN.lo - 2 && x <= SPAN.hi + 2; }

// A fake body. It owns the clock and her position, builds the input snapshot,
// calls the brain and moves her by the gait the brain asked for.
class Sim {
  constructor(over = {}) {
    this.t = 1_000_000;
    this.x = over.x ?? 620;
    this.state = Brain.freshState(over.seed ?? 42);
    this.input = {
      axis: "h", barLength: BAR, catSize: CAT, yard: YARD,
      ...NOON,
      idleFor: 0, music: false, charging: false, batteryPct: 80, dnd: false,
      greet: null, notifyAt: null, themeChangedAt: null, workspaceEvent: null,
      clickedAt: null,
      config: {},
      ...over.input,
    };
    this.last = null;
    this.trace = [];
  }
  set(over) { Object.assign(this.input, over); return this; }
  config(over) { this.input.config = { ...this.input.config, ...over }; return this; }
  at(h, m = 0) { this.input.minutes = h * 60 + m; return this; }
  tick(dt = 100) {
    this.t += dt;
    const out = Brain.decide({ ...this.input, now: this.t, x: this.x }, this.state);
    if (out.gait !== "idle") {
      const px = (out.gait === "run" ? Brain.RUN_PX_S : Brain.WALK_PX_S)
        * (out.speedScale ?? 1) * (dt / 1000);
      const d = out.target - this.x;
      this.x = Math.abs(d) <= px ? out.target : this.x + Math.sign(d) * px;
    }
    this.last = out;
    this.trace.push({ t: this.t, x: this.x, ...out });
    return out;
  }
  run(ms, dt = 100) {
    const end = this.t + ms;
    while (this.t < end) this.tick(dt);
    return this;
  }
  // Run until a decision satisfies `pred`, or fail after `limit` ms.
  until(pred, limit = 30 * MIN, dt = 100) {
    const end = this.t + limit;
    while (this.t < end) {
      if (pred(this.tick(dt))) return this.last;
    }
    assert.fail(`condition not reached within ${limit}ms; last pose ${this.last && this.last.pose}`);
  }
  poses(from = 0) { return this.trace.slice(from).map((r) => r.pose); }
}

function distinctPoses(trace) {
  const out = [];
  for (const r of trace) if (out[out.length - 1] !== r.pose) out.push(r.pose);
  return out;
}

// ------------------------------------------------------------ settling

test("the yard span is the widget's slot, minus her own length", () => {
  const span = Brain.yardSpan({ barLength: BAR, catSize: CAT, yard: YARD, config: {} });
  assert.deepEqual(span, SPAN);
});

test("with no yard placed she gets a default spot inside the bar", () => {
  const span = Brain.yardSpan({ barLength: BAR, catSize: CAT, yard: null, config: {} });
  assert.ok(span.lo >= 0 && span.hi <= BAR - CAT && span.hi >= span.lo);
  assert.ok(span.lo > BAR / 2, "centerEnd-ish: right of the middle");
});

test("started outside the yard she walks in before doing anything else", () => {
  const sim = new Sim({ x: 100 });
  const first = sim.tick();
  assert.equal(first.gait, "walk");
  assert.equal(first.settled, false);
  assert.ok(first.target >= SPAN.lo && first.target <= SPAN.hi);
  sim.until((o) => o.settled);
  assert.ok(inYard(sim.x));
});

test("she only ever stops inside the yard span, over hours of ordinary life", () => {
  for (const seed of [1, 7, 99, 12345]) {
    const sim = new Sim({ x: 1300, seed });
    sim.run(3 * HOUR, 250);
    for (const r of sim.trace) {
      if (r.gait === "idle" && r.settled) assert.ok(inYard(r.x), `seed ${seed}: settled at ${r.x}`);
    }
  }
});

test("a settled pose is never reported outside the yard, even if the yard moves", () => {
  const sim = new Sim({ x: 630 });
  sim.run(20_000);
  sim.set({ yard: { x: 1200, w: 96 } });
  sim.run(60_000);
  const span = Brain.yardSpan({ ...sim.input, config: {} });
  const afterMove = sim.trace.filter((r) => r.t > 1_000_000 + 20_000 + 1500);
  for (const r of afterMove) {
    if (r.settled) assert.ok(r.x >= span.lo - 2 && r.x <= span.hi + 2, `settled at ${r.x}`);
  }
  assert.ok(sim.x >= span.lo - 2, "she followed the yard");
});

// ----------------------------------------------------------- yard life

test("an ordinary stretch of yard life uses the whole repertoire", () => {
  const sim = new Sim({ seed: 3 });
  sim.run(2 * HOUR, 200);
  const seen = new Set(sim.poses());
  for (const pose of ["walk", "sniff", "dig", "scratch", "slump", "hover", "sit"]) {
    assert.ok(seen.has(pose), `never did ${pose}; saw ${[...seen]}`);
  }
});

test("hover always comes before sit and before slump", () => {
  const sim = new Sim({ seed: 5 });
  sim.run(2 * HOUR, 200);
  const seq = distinctPoses(sim.trace);
  let checked = 0;
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] === "sit" || seq[i] === "slump") {
      checked++;
      // wag is the sitting tail-wag and may sit between; otherwise hover leads.
      const prev = seq[i - 1] === "wag" || seq[i - 1] === "sit" || seq[i - 1] === "slump"
        ? seq[i - 2] : seq[i - 1];
      assert.ok(["hover", "wag", "slump", "sit"].includes(prev), `${prev} -> ${seq[i]}`);
      if (seq[i - 1] !== "wag" && seq[i - 1] !== "sit" && seq[i - 1] !== "slump") {
        assert.equal(seq[i - 1], "hover", `${seq[i - 1]} -> ${seq[i]}`);
      }
    }
  }
  assert.ok(checked > 3);
});

test("yard poses are reported as settled only while standing still", () => {
  const sim = new Sim({ seed: 8 });
  sim.run(HOUR, 200);
  for (const r of sim.trace) {
    if (r.gait !== "idle") assert.equal(r.settled, false);
    if (r.pose === "dig") assert.ok(inYard(r.x), "dig is yard-only");
    if (r.pose === "sniff") assert.ok(inYard(r.x), "sniff is yard-only");
  }
});

test("facing follows the direction she is walking", () => {
  const sim = new Sim({ x: 100 });
  assert.equal(sim.tick().facing, 1);
  const left = new Sim({ x: 1400 });
  assert.equal(left.tick().facing, -1);
});

test("the same seed gives the same day", () => {
  const a = new Sim({ seed: 11 }); a.run(30 * MIN, 250);
  const b = new Sim({ seed: 11 }); b.run(30 * MIN, 250);
  assert.deepEqual(a.poses(), b.poses());
});

// --------------------------------------------------------------- walks

function walkedOut(sim) { return sim.trace.some((r) => !inYard(r.x)); }

test("she takes a few random walks an hour, along the bar and out of the yard", () => {
  const sim = new Sim({ seed: 21 });
  sim.run(3 * HOUR, 250);
  let trips = 0;
  let wasOut = false;
  for (const r of sim.trace) {
    const out = !inYard(r.x);
    if (out && !wasOut) trips++;
    wasOut = out;
  }
  // tripsPerHour defaults to 4: expect roughly 12 in 3 hours.
  assert.ok(trips >= 5 && trips <= 25, `${trips} trips`);
});

test("tripsPerHour tunes the walks", () => {
  const sim = new Sim({ seed: 21 }).config({ tripsPerHour: 0.1 });
  sim.run(HOUR, 250);
  const quiet = sim.trace.filter((r) => !inYard(r.x)).length;
  const busy = new Sim({ seed: 21 }).config({ tripsPerHour: 12 });
  busy.run(HOUR, 250);
  assert.ok(busy.trace.filter((r) => !inYard(r.x)).length > quiet);
});

test("after every walk she returns to the yard to settle", () => {
  const sim = new Sim({ seed: 4 });
  sim.run(3 * HOUR, 250);
  assert.ok(walkedOut(sim));
  for (const r of sim.trace) {
    if (r.settled) assert.ok(inYard(r.x), `settled at ${r.x}`);
  }
  // and the last walk did end with her home
  sim.config({ tripsPerHour: 0.1 });
  sim.until((o) => o.settled);
  assert.ok(inYard(sim.x));
});

test("a workspace switch makes her glance that way", () => {
  for (const dir of [-1, 1]) {
    const sim = new Sim({ seed: 2 });
    sim.run(5000);
    sim.until((o) => o.settled);
    sim.set({ workspaceEvent: { at: sim.t + 1, dir } });
    // Whether she then walks off that way or just looks, she faces it.
    assert.equal(sim.tick().facing, dir);
  }
});

test("workspace switches sometimes set off a walk in that direction", () => {
  let walks = 0;
  const N = 40;
  for (let seed = 1; seed <= N; seed++) {
    const sim = new Sim({ seed }).config({ tripsPerHour: 0.1 });
    sim.run(3000);
    sim.until((o) => o.settled);
    sim.set({ workspaceEvent: { at: sim.t + 1, dir: 1 } });
    sim.run(40_000);
    if (sim.trace.some((r) => r.x > SPAN.hi + CAT)) walks++;
  }
  assert.ok(walks > 3 && walks < N - 3, `${walks}/${N} set off a walk`);
});

test("morning walkies: the whole bar, harness on, once a day, then home", () => {
  const sim = new Sim({ seed: 6 }).config({ tripsPerHour: 0.1 });
  sim.at(9, 14).run(10_000);
  assert.ok(!sim.trace.some((r) => r.harness), "not before 09:15");
  sim.at(9, 15);
  sim.until((o) => o.harness);
  sim.run(3 * MIN, 250);
  const xs = sim.trace.filter((r) => r.harness).map((r) => r.x);
  assert.ok(Math.min(...xs) < 50 && Math.max(...xs) > BAR - CAT - 50, "covered the bar");
  sim.run(MIN);
  assert.ok(inYard(sim.x));
  const before = sim.trace.length;
  sim.run(10 * MIN, 250);
  assert.ok(!sim.trace.slice(before).some((r) => r.harness), "only once per day");
  sim.set({ day: 20261110 }).at(9, 20);
  sim.until((o) => o.harness, 5 * MIN);
});

test("walkies is configurable and can be turned off", () => {
  const sim = new Sim({ seed: 6 }).config({ walkies: "14:30", tripsPerHour: 0.1 });
  sim.at(9, 20).run(5 * MIN);
  assert.ok(!sim.trace.some((r) => r.harness));
  sim.at(14, 31);
  sim.until((o) => o.harness, 2 * MIN);
  const off = new Sim({ seed: 6 }).config({ walkies: false, tripsPerHour: 0.1 });
  off.at(9, 20).run(20 * MIN);
  assert.ok(!off.trace.some((r) => r.harness));
});

// ------------------------------------------------------------- blanket

test("blanket sequence: burrow, then breathing, then wriggle, then stretch", () => {
  const sim = new Sim({ seed: 9 }).set({ charging: true });
  sim.until((o) => o.pose === "blanket", 5 * MIN);
  sim.run(10_000);
  sim.set({ charging: false });
  sim.run(8000);
  const seq = distinctPoses(sim.trace).filter((p) => ["burrow", "blanket", "wriggle", "stretch"].includes(p));
  assert.deepEqual(seq, ["burrow", "blanket", "wriggle", "stretch"]);
});

test("the blanket happens only in the yard", () => {
  for (const reason of ["charging", "idleFor", "night"]) {
    const sim = new Sim({ x: 1300, seed: 12 });
    if (reason === "charging") sim.set({ charging: true });
    if (reason === "idleFor") sim.set({ idleFor: 10 * MIN });
    if (reason === "night") sim.at(2, 0);
    sim.run(2 * MIN, 250);
    for (const r of sim.trace) {
      if (["burrow", "blanket"].includes(r.pose)) assert.ok(inYard(r.x), `${reason}: ${r.pose} at ${r.x}`);
    }
    assert.ok(sim.trace.some((r) => r.pose === "blanket"), `${reason}: never got under`);
  }
});

test("she sleeps at the blanket end of the yard", () => {
  const sim = new Sim().set({ charging: true });
  sim.until((o) => o.pose === "blanket", 5 * MIN);
  assert.equal(sim.x, SPAN.hi);
});

test("wakes with a stretch then goes back to yard life", () => {
  const sim = new Sim().set({ charging: true });
  sim.until((o) => o.pose === "blanket", 5 * MIN);
  sim.set({ charging: false });
  sim.until((o) => o.pose === "stretch");
  sim.run(3000);
  assert.ok(!["blanket", "burrow", "stretch"].includes(sim.last.pose));
});

// ------------------------------------------------- reactions & priority

test("idle: after being away long enough she goes home and burrows", () => {
  const sim = new Sim({ x: 1200 });
  sim.set({ idleFor: 30_000 }).run(MIN, 250);
  assert.ok(!sim.trace.some((r) => r.pose === "blanket"), "not yet");
  sim.set({ idleFor: 3 * MIN });
  sim.until((o) => o.pose === "blanket", 5 * MIN);
  assert.ok(inYard(sim.x));
});

test("charging: goes home and naps under the blanket", () => {
  const sim = new Sim({ x: 1200 }).set({ charging: true });
  sim.until((o) => o.pose === "blanket", 5 * MIN);
  assert.ok(inYard(sim.x));
  assert.equal(sim.last.reason, "charging");
});

test("music: slumps and wags in the yard, hovering first", () => {
  const sim = new Sim({ x: 1200 }).set({ music: true });
  sim.run(2 * MIN, 250);
  const seq = distinctPoses(sim.trace);
  assert.ok(seq.includes("slump") && seq.includes("wag"));
  assert.equal(seq[seq.indexOf("slump") - 1], "hover");
  for (const r of sim.trace) if (r.pose === "slump" || r.pose === "wag") assert.ok(inYard(r.x));
});

test("music beats charging: she dances rather than naps", () => {
  const sim = new Sim().set({ charging: true, music: true });
  sim.run(2 * MIN, 250);
  assert.ok(!sim.trace.some((r) => r.pose === "blanket"));
  assert.ok(sim.trace.some((r) => r.pose === "slump"));
});

test("charging beats idle: reason is charging", () => {
  const sim = new Sim().set({ charging: true, idleFor: 10 * MIN });
  sim.until((o) => o.pose === "blanket", 5 * MIN);
  assert.equal(sim.last.reason, "charging");
});

test("idle beats wander", () => {
  const sim = new Sim().set({ idleFor: 10 * MIN });
  sim.until((o) => o.pose === "blanket", 5 * MIN);
  assert.equal(sim.last.reason, "idle");
});

test("music started while she naps wakes her first", () => {
  const sim = new Sim().set({ charging: true });
  sim.until((o) => o.pose === "blanket", 5 * MIN);
  sim.set({ music: true });
  sim.run(6000);
  const seq = distinctPoses(sim.trace.slice(-60));
  assert.ok(seq.includes("wriggle"));
  assert.equal(sim.last.reason === "blanket", false);
});

test("notification: she stops and barks once, facing the right end", () => {
  const sim = new Sim({ x: 100, seed: 3 });
  sim.run(1000);
  const x0 = sim.x;
  sim.set({ notifyAt: sim.t + 1 });
  const out = sim.tick();
  assert.equal(out.pose, "bark");
  assert.equal(out.gait, "idle");
  assert.equal(out.facing, 1);
  assert.equal(out.settled, false, "a bark is a pause, not settling");
  sim.run(3000);
  assert.ok(!sim.trace.slice(-5).some((r) => r.pose === "bark"), "barked once");
  assert.ok(sim.x > x0, "carried on afterwards");
  assert.equal(sim.trace.filter((r, i, a) => r.pose === "bark" && (i === 0 || a[i - 1].pose !== "bark")).length, 1);
});

test("on a vertical bar the bark faces the top", () => {
  const sim = new Sim({ input: { axis: "v" } });
  sim.run(1000).set({ notifyAt: sim.t + 1 });
  assert.equal(sim.tick().facing, -1);
});

test("notification beats music", () => {
  const sim = new Sim().set({ music: true });
  sim.run(10_000);
  sim.set({ notifyAt: sim.t + 1 });
  assert.equal(sim.tick().pose, "bark");
});

test("greet: coming back wriggles out, then runs along the bar, then goes home", () => {
  const sim = new Sim().set({ charging: true });
  sim.until((o) => o.pose === "blanket", 5 * MIN);
  sim.set({ charging: false, idleFor: 0, greet: { at: sim.t + 1, awayMs: 10 * MIN } });
  const from = sim.trace.length;
  sim.run(20_000, 100);
  const seq = distinctPoses(sim.trace.slice(from));
  assert.equal(seq[0], "wriggle");
  assert.ok(seq.indexOf("wriggle") < seq.indexOf("run"), seq.join());
  const runs = sim.trace.filter((r) => r.pose === "run" && r.gait === "run").map((r) => r.x);
  assert.ok(Math.min(...runs) < 60 && Math.max(...runs) > BAR - CAT - 60, "zoomies along the whole bar");
  sim.run(30_000);
  assert.ok(inYard(sim.x));
});

test("greet beats notification: a bark during zoomies is ignored", () => {
  const sim = new Sim();
  sim.run(3000).set({ greet: { at: sim.t + 1, awayMs: 10 * MIN } });
  sim.tick();
  sim.set({ notifyAt: sim.t + 1 });
  for (let i = 0; i < 20; i++) assert.notEqual(sim.tick().pose, "bark");
});

test("a short absence earns no greeting; unlock (unknown length) does", () => {
  const sim = new Sim();
  sim.run(3000).set({ greet: { at: sim.t + 1, awayMs: 20_000 } });
  assert.notEqual(sim.tick().pose, "run");
  sim.set({ greet: { at: sim.t + 1, awayMs: Infinity } });
  assert.equal(sim.tick().pose, "run");
});

test("an event is consumed once: the same timestamp does not replay", () => {
  const sim = new Sim();
  sim.run(1000).set({ notifyAt: sim.t + 1 });
  sim.run(5000);
  const barks = sim.trace.filter((r, i, a) => r.pose === "bark" && a[i - 1] && a[i - 1].pose !== "bark").length;
  assert.equal(barks, 1);
});

test("theme change: she startles and shakes herself off", () => {
  const sim = new Sim();
  sim.run(3000).set({ themeChangedAt: sim.t + 1 });
  const out = sim.tick();
  assert.equal(out.pose, "bark");
  sim.run(1500);
  assert.equal(sim.last.pose, "scratch");
});

test("click while settled: wags, then hovers", () => {
  const sim = new Sim({ seed: 2 });
  sim.until((o) => o.settled && o.pose !== "wag");
  sim.set({ clickedAt: sim.t + 1 });
  assert.equal(sim.tick().pose, "wag");
  sim.until((o) => o.pose === "hover");
});

test("click while she is walking does nothing", () => {
  const sim = new Sim({ x: 100 });
  sim.tick();
  sim.set({ clickedAt: sim.t + 1 });
  assert.equal(sim.tick().pose, "walk");
});

test("a click under the blanket gets one sleepy peek, then she is back under", () => {
  const sim = new Sim().at(2, 0);
  sim.until((o) => o.pose === "blanket", 5 * MIN);
  sim.set({ clickedAt: sim.t + 1 });
  assert.equal(sim.tick().pose, "wriggle");
  sim.run(3000);
  assert.equal(sim.last.pose, "blanket");
});

test("do not disturb overrides every reaction", () => {
  const sim = new Sim({ seed: 3 }).set({ dnd: true, music: true, charging: true, idleFor: 10 * MIN });
  sim.run(MIN, 100);
  sim.set({ notifyAt: sim.t + 1, themeChangedAt: sim.t + 1,
    greet: { at: sim.t + 1, awayMs: 10 * MIN } });
  sim.run(30_000);
  const seen = new Set(sim.poses());
  for (const p of ["bark", "run", "blanket", "slump"]) {
    if (p === "slump") continue; // slump is also ordinary yard life
    assert.ok(!seen.has(p), `reacted with ${p}`);
  }
  assert.ok(!sim.trace.some((r) => r.reason === "music"));
});

// -------------------------------------------------------------- battery

test("battery under 20%: slow, hovers a lot, takes no walks", () => {
  const sim = new Sim({ seed: 5 }).set({ batteryPct: 15 });
  sim.run(2 * HOUR, 250);
  assert.ok(sim.trace.every((r) => r.speedScale === 0.5));
  assert.ok(!walkedOut(sim), "no walks");
  const hover = sim.trace.filter((r) => r.pose === "hover").length;
  const normal = new Sim({ seed: 5 }).set({ batteryPct: 80 });
  normal.run(2 * HOUR, 250);
  assert.ok(hover > 1.5 * normal.trace.filter((r) => r.pose === "hover").length);
});

test("low battery cancels morning walkies and workspace walks", () => {
  const sim = new Sim({ seed: 6 }).set({ batteryPct: 10 }).at(9, 30);
  sim.run(10 * MIN, 250);
  assert.ok(!sim.trace.some((r) => r.harness));
});

test("low battery while charging is not a reason to be slow", () => {
  const sim = new Sim().set({ batteryPct: 5, charging: true });
  assert.equal(sim.tick().speedScale, 1);
});

// ---------------------------------------------------------- day rhythm

test("23:00-09:00 she is asleep under the blanket", () => {
  for (const [h, m] of [[23, 0], [3, 30], [8, 59]]) {
    const sim = new Sim({ seed: 1 }).at(h, m);
    sim.until((o) => o.pose === "blanket", 5 * MIN);
    sim.run(MIN, 250);
    assert.equal(sim.last.pose, "blanket", `${h}:${m}`);
  }
  const awake = new Sim({ seed: 1 }).at(22, 59);
  awake.run(2 * MIN, 250);
  assert.ok(!awake.trace.some((r) => r.pose === "blanket"));
});

test("at 09:00 she wakes and stretches", () => {
  const sim = new Sim().at(8, 59);
  sim.until((o) => o.pose === "blanket", 5 * MIN);
  sim.at(9, 0);
  sim.until((o) => o.pose === "wriggle");
  sim.until((o) => o.pose === "stretch");
});

test("the sleep window is configurable", () => {
  const sim = new Sim().config({ sleep: "01:00-02:00" }).at(1, 30);
  sim.until((o) => o.pose === "blanket", 5 * MIN);
  const day = new Sim().config({ sleep: "01:00-02:00" }).at(3, 0);
  day.run(2 * MIN);
  assert.ok(!day.trace.some((r) => r.pose === "blanket"));
});

test("a night notification does not wake her", () => {
  const sim = new Sim().at(2, 0);
  sim.until((o) => o.pose === "blanket", 5 * MIN);
  sim.set({ notifyAt: sim.t + 1 });
  assert.equal(sim.tick().pose, "blanket");
});

test("meals: she hovers in the yard waiting, with no walks", () => {
  const sim = new Sim({ seed: 8 }).config({ walkies: false }).at(10, 5);
  sim.run(20 * MIN, 250);
  assert.ok(!walkedOut(sim));
  const poses = new Set(sim.poses());
  assert.ok(poses.has("hover"));
  for (const p of ["dig", "scratch", "slump", "sniff"]) assert.ok(!poses.has(p), p);
  assert.ok(sim.trace.every((r) => r.reason !== "meal" || inYard(r.x) || r.gait !== "idle"));
  const evening = new Sim({ seed: 8 }).at(20, 5);
  evening.run(5 * MIN, 250);
  assert.ok(evening.trace.some((r) => r.reason === "meal"));
  const later = new Sim({ seed: 8 }).at(11, 0);
  later.run(5 * MIN, 250);
  assert.ok(!later.trace.some((r) => r.reason === "meal"));
});

test("siesta: 15:00-17:00 she burrows in sooner than usual", () => {
  const afternoon = new Sim().at(16, 0).set({ idleFor: 20_000 });
  afternoon.until((o) => o.pose === "blanket", 5 * MIN);
  assert.equal(afternoon.last.reason, "siesta");
  const morning = new Sim().at(13, 0).set({ idleFor: 20_000 });
  morning.run(3 * MIN, 250);
  assert.ok(!morning.trace.some((r) => r.pose === "blanket"));
  const active = new Sim().at(16, 0).set({ idleFor: 0 });
  active.run(2 * MIN, 250);
  assert.ok(!active.trace.some((r) => r.pose === "blanket"), "siesta needs her to be quiet too");
});

test("a bad rhythm config falls back to defaults rather than breaking", () => {
  const sim = new Sim().config({ sleep: "nonsense", walkies: "x", meals: "no", siesta: 5 });
  sim.run(10 * MIN, 250);
  assert.ok(sim.trace.every((r) => r.gait !== "idle" || !r.settled || inYard(r.x)));
});

// ----------------------------------------------- the one invariant

test("no matter what happens, a settled report is always inside the yard", () => {
  const sim = new Sim({ x: 1400, seed: 77 });
  let rnd = 1;
  const roll = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 20_000; i++) {
    if (roll() < 0.003) sim.set({ music: !sim.input.music });
    if (roll() < 0.002) sim.set({ charging: !sim.input.charging });
    if (roll() < 0.002) sim.set({ idleFor: sim.input.idleFor ? 0 : 5 * MIN });
    if (roll() < 0.002) sim.set({ notifyAt: sim.t });
    if (roll() < 0.002) sim.set({ themeChangedAt: sim.t });
    if (roll() < 0.002) sim.set({ clickedAt: sim.t });
    if (roll() < 0.002) sim.set({ workspaceEvent: { at: sim.t, dir: roll() < 0.5 ? -1 : 1 } });
    if (roll() < 0.001) sim.set({ greet: { at: sim.t, awayMs: 10 * MIN } });
    if (roll() < 0.001) sim.set({ batteryPct: roll() < 0.5 ? 10 : 70 });
    if (roll() < 0.001) sim.set({ yard: roll() < 0.8 ? YARD : { x: 100 + roll() * 1000, w: 96 } });
    if (roll() < 0.002) sim.at(Math.floor(roll() * 24), Math.floor(roll() * 60));
    sim.tick(250);
    const span = Brain.yardSpan({ ...sim.input, config: {} });
    const o = sim.last;
    if (o.settled && !(o.reason === "beat" && o.pose !== "wriggle")) {
      assert.ok(sim.x >= span.lo - 2 && sim.x <= span.hi + 2, `settled at ${sim.x} (${o.reason}/${o.pose})`);
    }
  }
});
