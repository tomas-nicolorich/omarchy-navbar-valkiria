// Tests for the cat's behaviour core.
//
// Brain.js is loaded by evaluating it rather than importing it, because it is
// a QML .js resource: QML exposes its top-level functions directly and has no
// export statement for node to read. Evaluating it here keeps one copy of the
// logic serving both the shell and this suite.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(REPO, "Brain.js"), "utf8");
const Brain = new Function(
  `${source}\nreturn { decide, freshState, pickSpot, CHAIN, PET_MS, PET_PERK_MS,`
    + ` AWAKE_MS, SCAMPER_MS, NOTIFY_MS, rhythmFor };`,
)();

// The middle of the bar, in cat-position terms, and the default keep-clear
// band. These are functions because BAR and CAT are declared further down.
function middle() { return (BAR - CAT) / 2; }
function inCentre(x, avoid = 0.2) {
  const half = (BAR * avoid) / 2;
  return x > middle() - half && x < middle() + half;
}

const DIAGONALS = new Set(["upleft", "upright", "dwleft", "dwright"]);

// Drive the cat all the way down to sleep from a fresh state, and hand back the
// decision and the clock reading at that moment. Several tests need a genuinely
// sleeping cat as their starting point.
function sleepingCat(overrides = {}) {
  const chainTotal = Brain.CHAIN.reduce(
    (sum, step) => sum + (Number.isFinite(step.ms) ? step.ms : 0),
    0,
  );
  const start = 300_000;
  let out = Brain.decide(
    input({ now: start, lastActivityAt: 10_000, x: 500, ...overrides }),
    Brain.freshState(),
  );
  const asleepAt = start + chainTotal + 1000;
  out = Brain.decide(
    input({ now: asleepAt, lastActivityAt: 10_000, x: out.target, ...overrides }),
    out.state,
  );
  return { out, asleepAt, chainTotal };
}

const BAR = 1000;
const CAT = 16;

// A snapshot with nothing going on: nothing playing, on battery,
// the user active a moment ago. Every test overrides just the field
// it cares about, so a rung firing is unambiguous.
function input(overrides = {}) {
  return {
    now: 10_000,
    axis: "h",
    barLength: BAR,
    catSize: CAT,
    x: 500,
    pettedAt: null,
    lastActivityAt: 10_000,
    music: false,
    charging: false,
    workspaceEvent: null,
    config: {
      pettable: true,
      sleepAfter: 180,
      reactions: { music: true, charging: true, workspace: true },
    },
    ...overrides,
  };
}

function decide(overrides, state = Brain.freshState()) {
  return Brain.decide(input(overrides), state);
}

test("rung 7: with nothing happening the cat wanders", () => {
  const out = decide({});
  assert.equal(out.reason, "wander");
});

test("rung 7: a wander target stays put across ticks until reached", () => {
  let state = Brain.freshState();
  const first = Brain.decide(input({}), state);
  const second = Brain.decide(input({ now: 10_100 }), first.state);
  assert.equal(first.target, second.target, "cat should not re-roll its target every tick");
});

test("rung 6: no pointer movement past sleepAfter puts the cat to sleep", () => {
  // Far past the threshold and standing on its target, so the idle chain has
  // had time to run all the way down to sleep.
  let state = Brain.freshState();
  let out = Brain.decide(
    input({ now: 300_000, lastActivityAt: 10_000, x: 500 }),
    state,
  );
  // Let the chain elapse: feed the same resting situation well past its end.
  const chainTotal = Brain.CHAIN.reduce(
    (sum, step) => sum + (Number.isFinite(step.ms) ? step.ms : 0),
    0,
  );
  out = Brain.decide(
    input({ now: 300_000 + chainTotal + 1000, lastActivityAt: 10_000, x: out.target }),
    out.state,
  );
  assert.equal(out.pose, "sleep");
  assert.equal(out.reason, "idle-sleep");
});

test("rung 6: the idle chain runs stop -> wash -> scratch -> yawn -> sleep", () => {
  // Faithful to oneko's own progression (oneko.c:1107 onward).
  const seen = [];
  let state = Brain.freshState();
  let t = 300_000;
  let x = 500;
  // Prime: arrive at rest.
  let out = Brain.decide(input({ now: t, lastActivityAt: 10_000, x }), state);
  x = out.target;
  for (const step of Brain.CHAIN) {
    out = Brain.decide(
      input({ now: t, lastActivityAt: 10_000, x }),
      out.state,
    );
    seen.push(out.pose);
    t += Number.isFinite(step.ms) ? step.ms : 1000;
  }
  assert.deepEqual(seen, ["stop", "wash", "scratch", "yawn", "sleep"]);
});

test("rung 4: music makes the cat dance where it already is", () => {
  // It used to walk to the centre of the bar to dance, which is exactly where
  // most people's clock sits.
  for (const x of [80, 400, BAR - CAT]) {
    const out = decide({ music: true, x });
    assert.equal(out.reason, "music");
    assert.equal(out.target, x, "music should not relocate the cat");
    assert.equal(out.gait, "idle");
    assert.equal(out.bob, true, "and it should be dancing immediately");
  }
});

test("rung 4: music is ignored when its reaction is switched off", () => {
  const out = decide({
    music: true,
    config: { ...input().config, reactions: { music: false, charging: true, workspace: true } },
  });
  assert.equal(out.reason, "wander");
});

test("rung 4: charging makes the cat sleepy where it stands", () => {
  // It used to be marched to the right third to "nap by the power widget".
  // A cat sleeps where it is, and being summoned to a fixed spot meant it
  // always slept in the same place and trudged back there after every stir.
  for (const x of [40, 500, BAR - CAT]) {
    const out = decide({ charging: true, x });
    assert.equal(out.reason, "charging");
    assert.equal(out.target, x, "charging should not relocate the cat");
    assert.equal(out.gait, "idle");
  }
});

test("music outranks charging, so mains power cannot silence it", () => {
  // Regression: charging used to come first. Because charging is a sleepy rung
  // that returns immediately, a laptop on mains power — which is most laptops,
  // most of the time — made the music reaction unreachable entirely.
  const out = decide({ charging: true, music: true, x: 100 });
  assert.equal(out.reason, "music");

  // Charging still wins when there is nothing playing.
  const quiet = decide({ charging: true, music: false, x: 100 });
  assert.equal(quiet.reason, "charging");
});

test("waking reactions all beat charging", () => {
  // The general rule the bug above violated: anything that means the cat
  // should be up and doing something outranks anything that puts it to sleep.
  const cases = [
    [{ pettedAt: 9_500 }, "petted"],
    [{ workspaceEvent: { at: 9_800, dir: 1 } }, "workspace"],
    [{ music: true }, "music"],
  ];
  for (const [extra, expected] of cases) {
    const out = decide({ charging: true, x: 100, ...extra });
    assert.equal(out.reason, expected, `${expected} should beat charging`);
  }
});

test("rung 4: a charging cat eventually naps, right where it was", () => {
  const chainTotal = Brain.CHAIN.reduce(
    (sum, step) => sum + (Number.isFinite(step.ms) ? step.ms : 0),
    0,
  );
  let out = decide({ charging: true, x: 100 });
  assert.equal(out.pose, "stop", "settles before it sleeps");
  out = Brain.decide(
    input({ charging: true, x: 100, now: 10_000 + chainTotal + 2000 }),
    out.state,
  );
  assert.equal(out.pose, "sleep");
  assert.equal(out.target, 100, "and sleeps where it already was");
});

test("rung 3: a workspace switch scampers the cat that way", () => {
  const right = decide({ workspaceEvent: { at: 9_800, dir: 1 }, x: 500 });
  assert.equal(right.reason, "workspace");
  assert.ok(right.target > 500, "switching right should send the cat right");
  assert.equal(right.gait, "run");

  const left = decide({ workspaceEvent: { at: 9_800, dir: -1 }, x: 500 });
  assert.ok(left.target < 500, "switching left should send the cat left");
});

test("rung 3: a stale workspace switch stops mattering", () => {
  const out = decide({ workspaceEvent: { at: 1_000, dir: 1 } });
  assert.equal(out.reason, "wander");
});

test("rung 3: a scamper cannot leave the bar", () => {
  const out = decide({ workspaceEvent: { at: 9_800, dir: 1 }, x: BAR - CAT - 5 });
  assert.ok(out.target <= BAR - CAT, `target ${out.target} escaped the bar`);
});

test("rung 1: a freshly petted cat holds still and looks pleased", () => {
  const out = decide({ pettedAt: 9_500, x: 400 });
  assert.equal(out.reason, "petted");
  assert.equal(out.gait, "idle");
  assert.equal(out.target, 400, "a petted cat should not wander off");
});

test("rung 1: petting gets an acknowledgement before the grooming", () => {
  // Clicking and being met instantly with face-washing reads as the cat
  // ignoring you. It should look up first, then settle into grooming.
  const now = 10_000;
  const immediate = decide({ pettedAt: now - 10, x: 400 });
  assert.equal(immediate.pose, "awake", "should look up when clicked");

  const later = decide({ pettedAt: now - Brain.PET_PERK_MS - 10, x: 400 });
  assert.equal(later.pose, "wash", "then settle into contented grooming");

  const done = decide({ pettedAt: now - Brain.PET_MS - 1, x: 400 });
  assert.notEqual(done.reason, "petted");
});

test("rung 1: the pleasure wears off", () => {
  const out = decide({ pettedAt: 9_500 - Brain.PET_MS - 1, x: 400 });
  assert.notEqual(out.reason, "petted");
});

test("waking: a sleeping cat plays its awake frame before it moves", () => {
  // Put it to sleep, then give it a reason to move.
  let out = decide({ now: 300_000, lastActivityAt: 10_000, x: 500 });
  const chainTotal = Brain.CHAIN.reduce(
    (sum, s) => sum + (Number.isFinite(s.ms) ? s.ms : 0),
    0,
  );
  const asleepAt = 300_000 + chainTotal + 1000;
  out = Brain.decide(
    input({ now: asleepAt, lastActivityAt: 10_000, x: out.target }),
    out.state,
  );
  assert.equal(out.pose, "sleep");

  const woken = Brain.decide(
    input({ now: asleepAt + 10, workspaceEvent: { at: asleepAt + 5, dir: -1 }, x: out.target }),
    out.state,
  );
  assert.equal(woken.pose, "awake");
  assert.equal(woken.gait, "idle", "the cat should not sprint before its eyes open");

  const moving = Brain.decide(
    input({
      now: asleepAt + Brain.AWAKE_MS + 20,
      workspaceEvent: { at: asleepAt + Brain.AWAKE_MS + 10, dir: -1 },
      x: out.target,
    }),
    woken.state,
  );
  assert.equal(moving.gait, "run", "after waking it should get going");
});

test("petting is only offered while the cat is settled", () => {
  const moving = decide({ workspaceEvent: { at: 9_800, dir: 1 }, x: 100 });
  assert.equal(moving.pettable, false, "a walking cat must not hold an input region");

  const settled = decide({ pettedAt: 9_500, x: 500 });
  assert.equal(settled.pettable, true);
});

test("petting is never offered when the user has switched it off", () => {
  const out = decide({
    pettedAt: 9_500,
    x: 500,
    config: { ...input().config, pettable: false },
  });
  assert.equal(out.pettable, false);
});

test("the cat never targets a position that would hang off the bar", () => {
  // Sweep the ladder with hostile geometry and check the invariant holds.
  const cases = [
    { charging: true },
    { music: true },
    { workspaceEvent: { at: 9_800, dir: 1 } },
    { workspaceEvent: { at: 9_800, dir: -1 } },
    {},
  ];
  for (const c of cases) {
    for (const x of [0, 250, BAR - CAT]) {
      const out = decide({ ...c, x });
      assert.ok(
        out.target >= 0 && out.target <= BAR - CAT,
        `target ${out.target} out of bounds for ${JSON.stringify(c)} at x=${x}`,
      );
    }
  }
});

test("a bar too narrow for the cat does not produce a negative target", () => {
  const out = decide({ barLength: 10, x: 0 });
  assert.ok(out.target >= 0 && Number.isFinite(out.target), `got ${out.target}`);
});

// ------------------------------------------------------------------ stirring

test("stir: a sleeping cat says when it next wants waking", () => {
  const { out } = sleepingCat();
  assert.equal(out.pose, "sleep");
  assert.ok(out.wakeIn > 0, "a sleeping cat must ask to be woken, or it sleeps forever");
});

test("stir: the cat rouses itself after a while and wanders", () => {
  const { out, asleepAt } = sleepingCat();
  // Well past the longest possible randomised interval.
  const later = asleepAt + out.wakeIn + 10;
  const stirred = Brain.decide(
    input({ now: later, lastActivityAt: 10_000, x: out.target }),
    out.state,
  );
  assert.equal(stirred.reason, "stir");
  assert.notEqual(stirred.pose, "sleep", "it should be up and about");
});

test("stir: having pottered about, it goes back to sleep", () => {
  const { out, asleepAt, chainTotal } = sleepingCat();
  let state = out.state;
  let now = asleepAt + out.wakeIn + 10;

  let stirred = Brain.decide(input({ now, lastActivityAt: 10_000, x: out.target }), state);
  assert.equal(stirred.reason, "stir");

  // Run past the whole stir window, standing where it was asked to go.
  now += 25_000 + 1000;
  let back = Brain.decide(
    input({ now, lastActivityAt: 10_000, x: stirred.target }),
    stirred.state,
  );
  assert.equal(back.reason, "idle-sleep", "the stir should expire back into sleeping");

  // And then settle all the way down again.
  now += chainTotal + 1000;
  const asleepAgain = Brain.decide(
    input({ now, lastActivityAt: 10_000, x: back.target }),
    back.state,
  );
  assert.equal(asleepAgain.pose, "sleep");
});

test("stir: a cat asleep on the charger stirs too, not just an idle one", () => {
  // Regression: the stir originally lived inside the idle-sleep rung, so a cat
  // that had nodded off on AC power booked a wake-up and then went straight
  // back to sleep without ever getting up.
  const chainTotal = Brain.CHAIN.reduce(
    (sum, s) => sum + (Number.isFinite(s.ms) ? s.ms : 0),
    0,
  );
  let out = decide({ charging: true, x: 100 });
  out = Brain.decide(
    input({ charging: true, x: 100, now: 10_000 + chainTotal + 2000 }),
    out.state,
  );
  assert.equal(out.pose, "sleep");
  assert.ok(out.wakeIn > 0, "a charging cat should book its own stir");

  const stirred = Brain.decide(
    input({
      charging: true,
      x: 100,
      now: 10_000 + chainTotal + 2000 + out.wakeIn + 10,
    }),
    out.state,
  );
  assert.equal(stirred.reason, "stir");
});

test("stir: after pottering about it settles wherever it ended up", () => {
  // The point of letting it sleep anywhere: having stirred and wandered off,
  // the cat must not walk all the way back to where it slept before.
  const chainTotal = Brain.CHAIN.reduce(
    (sum, s) => sum + (Number.isFinite(s.ms) ? s.ms : 0),
    0,
  );
  let out = decide({ charging: true, x: 100 });
  out = Brain.decide(
    input({ charging: true, x: 100, now: 10_000 + chainTotal + 2000 }),
    out.state,
  );
  let now = 10_000 + chainTotal + 2000 + out.wakeIn + 10;

  const stirred = Brain.decide(input({ charging: true, x: 100, now }), out.state);
  assert.equal(stirred.reason, "stir");
  const wanderedTo = stirred.target;
  assert.notEqual(wanderedTo, 100, "it should have somewhere new in mind");

  // Let the stir run out while standing at the new spot.
  now += 25_000 + 1000;
  const settling = Brain.decide(
    input({ charging: true, x: wanderedTo, now }),
    stirred.state,
  );
  assert.equal(settling.reason, "charging");
  assert.equal(
    settling.target, wanderedTo,
    "it should settle where it wandered to, not march back",
  );
});

test("stir: waking for a real reason clears the stir schedule", () => {
  const { out, asleepAt } = sleepingCat();
  const chased = Brain.decide(
    input({ now: asleepAt + 50, workspaceEvent: { at: asleepAt + 40, dir: 1 }, x: out.target }),
    out.state,
  );
  assert.equal(chased.wakeIn, 0, "an awake cat has no pending self-wake");
});

test("the sleeping cat reports that it needs no ticks", () => {
  let out = decide({ now: 300_000, lastActivityAt: 10_000, x: 500 });
  const chainTotal = Brain.CHAIN.reduce(
    (sum, s) => sum + (Number.isFinite(s.ms) ? s.ms : 0),
    0,
  );
  out = Brain.decide(
    input({ now: 300_000 + chainTotal + 1000, lastActivityAt: 10_000, x: out.target }),
    out.state,
  );
  assert.equal(out.pose, "sleep");
  assert.equal(out.idle, true, "a sleeping cat should let the render timer stop");

  const busy = decide({ workspaceEvent: { at: 9_800, dir: 1 }, x: 100 });
  assert.equal(busy.idle, false);
});


// ------------------------------------------------- keeping clear of the clock

test("spots the cat picks for itself avoid the middle of the bar", () => {
  // Omarchy centres the clock, so the middle is the one place reliably
  // occupied on nearly every setup.
  let state = Brain.freshState();
  const picks = [];
  for (let i = 0; i < 400; i++) {
    picks.push(Brain.pickSpot(state, BAR - CAT, BAR, 0.2));
  }
  const offenders = picks.filter((x) => inCentre(x));
  assert.equal(offenders.length, 0, `${offenders.length} picks landed on the clock`);
  // ...and it still uses both sides, rather than hugging one end.
  assert.ok(picks.some((x) => x < middle()), "should use the left of the bar");
  assert.ok(picks.some((x) => x > middle()), "should use the right of the bar");
  assert.ok(picks.every((x) => x >= 0 && x <= BAR - CAT), "and stay on the bar");
});

test("wandering keeps clear of the middle", () => {
  const config = { ...input().config, avoidCenter: 0.2 };
  let state = Brain.freshState();
  for (let i = 0; i < 60; i++) {
    // Arrive each time so the cat re-rolls a fresh target.
    const out = Brain.decide(input({ x: state.wanderTarget ?? 0, config }), state);
    state = out.state;
    if (out.reason === "wander") {
      assert.ok(!inCentre(out.target), `wander target ${out.target} sat on the clock`);
    }
  }
});

test("a stirring cat also keeps clear of the middle", () => {
  const chainTotal = Brain.CHAIN.reduce(
    (sum, s) => sum + (Number.isFinite(s.ms) ? s.ms : 0),
    0,
  );
  const config = { ...input().config, avoidCenter: 0.2 };
  let out = Brain.decide(input({ charging: true, x: 100, config }), Brain.freshState());
  out = Brain.decide(
    input({ charging: true, x: 100, now: 10_000 + chainTotal + 2000, config }),
    out.state,
  );
  const stirred = Brain.decide(
    input({
      charging: true, x: 100, config,
      now: 10_000 + chainTotal + 2000 + out.wakeIn + 10,
    }),
    out.state,
  );
  assert.equal(stirred.reason, "stir");
  assert.ok(!inCentre(stirred.target), `stir target ${stirred.target} sat on the clock`);
});

test("avoidCenter: 0 lets the cat use the whole bar again", () => {
  let state = Brain.freshState();
  const picks = [];
  for (let i = 0; i < 400; i++) picks.push(Brain.pickSpot(state, BAR - CAT, BAR, 0));
  assert.ok(picks.some((x) => inCentre(x)), "with avoidance off the middle is fair game");
});

test("a bar with no room outside the middle still yields a valid spot", () => {
  let state = Brain.freshState();
  for (const [maxX, len] of [[4, 20], [0, 16], [40, 56]]) {
    const x = Brain.pickSpot(state, maxX, len, 0.9);
    assert.ok(x >= 0 && x <= Math.max(0, maxX) && Number.isFinite(x), `got ${x}`);
  }
});


// --------------------------------------------------------------- notifications

test("a notification sends the cat to the end of the bar nearest the toast", () => {
  // Omarchy anchors toasts top-right, so on a horizontal bar that is the right
  // end; on a vertical bar it is the top.
  const out = decide({ notifyAt: 9_900, x: 200 });
  assert.equal(out.reason, "notification");
  assert.equal(out.gait, "run");
  assert.equal(out.target, BAR - CAT, "should head for the right end");

  const vertical = decide({ axis: "v", notifyAt: 9_900, x: 500 });
  assert.equal(vertical.target, 0, "on a vertical bar the toast is at the top");
});

test("having arrived under the toast the cat sits and watches", () => {
  const out = decide({ notifyAt: 9_900, x: BAR - CAT });
  assert.equal(out.reason, "notification");
  assert.equal(out.gait, "idle");
  assert.equal(out.pose, "stop", "it should watch, not fall asleep");
});

test("the notification wears off once the toast has gone", () => {
  const out = decide({ notifyAt: 10_000 - Brain.NOTIFY_MS - 1, x: 200 });
  assert.notEqual(out.reason, "notification");
});

test("a toast still on screen holds the cat's attention", () => {
  // The bar is wider than a short toast lives: at a run the cat needs about ten
  // seconds to cross it, and a low-priority toast is gone in five. Attention is
  // therefore tied to the toast actually being there, not to a timer, so a
  // long-lived or critical toast is still watched and the cat is not left
  // turning back halfway.
  const stale = 10_000 - Brain.NOTIFY_MS * 10;
  const out = decide({ notifying: true, notifyAt: stale, x: 200 });
  assert.equal(out.reason, "notification", "still on screen, still interesting");

  const gone = decide({ notifying: false, notifyAt: stale, x: 200 });
  assert.notEqual(gone.reason, "notification");
});

test("notifications outrank music and charging, but not petting", () => {
  assert.equal(decide({ notifyAt: 9_900, music: true, charging: true }).reason, "notification");
  assert.equal(
    decide({ notifyAt: 9_900, pettedAt: 9_800 }).reason, "petted",
    "petting still wins",
  );
});

test("notifications can be switched off", () => {
  const out = decide({
    notifyAt: 9_900,
    config: { ...input().config, reactions: { notification: false } },
  });
  assert.notEqual(out.reason, "notification");
});

// ------------------------------------------------------------- theme startle

test("switching theme startles the cat into a run", () => {
  const out = decide({ themeChangedAt: 9_800, x: 500 });
  assert.equal(out.reason, "theme");
  assert.equal(out.gait, "run");
  assert.notEqual(out.target, 500, "it should bolt somewhere");
});

test("a stale theme change stops mattering", () => {
  assert.notEqual(decide({ themeChangedAt: 1_000 }).reason, "theme");
});

test("a workspace switch outranks a theme change", () => {
  const out = decide({
    themeChangedAt: 9_800,
    workspaceEvent: { at: 9_800, dir: 1 },
    x: 500,
  });
  assert.equal(out.reason, "workspace", "a thing you did beats a thing that happened");
});

// -------------------------------------------------------- crepuscular rhythm

test("the day has phases, and they are the ones cats keep", () => {
  const phases = [0, 3, 5].map((h) => Brain.rhythmFor(h).phase);
  assert.deepEqual(phases, ["night", "night", "night"]);
  assert.equal(Brain.rhythmFor(7).phase, "dawn");
  assert.equal(Brain.rhythmFor(12).phase, "day");
  assert.equal(Brain.rhythmFor(18).phase, "dusk");
  assert.equal(Brain.rhythmFor(21).phase, "evening");
  assert.equal(Brain.rhythmFor(23).phase, "night");
});

test("dawn and dusk are the brisk ones", () => {
  assert.equal(Brain.rhythmFor(7).brisk, true);
  assert.equal(Brain.rhythmFor(18).brisk, true);
  assert.equal(Brain.rhythmFor(12).brisk, false);
  assert.equal(Brain.rhythmFor(2).brisk, false);
});

test("at night the cat gives up on the day sooner", () => {
  // Same idle gap, different hour: asleep at night, still pottering by day.
  const idle = { lastActivityAt: 10_000, now: 10_000 + 70_000, x: 500 };
  const night = decide({ ...idle, hour: 2 });
  const day = decide({ ...idle, hour: 12 });
  assert.equal(night.reason, "idle-sleep", "70s of quiet is enough at 2am");
  assert.equal(day.reason, "wander", "but not at midday");
});

test("a brisk cat wanders at a run", () => {
  assert.equal(decide({ hour: 7 }).gait, "run", "dawn zoomies");
  assert.equal(decide({ hour: 12 }).gait, "walk", "ordinary daytime amble");
});

test("the rhythm can be switched off", () => {
  const config = { ...input().config, rhythm: false };
  const idle = { lastActivityAt: 10_000, now: 10_000 + 70_000, x: 500, config };
  assert.equal(decide({ ...idle, hour: 2 }).reason, "wander", "night no longer special");
  assert.equal(decide({ hour: 7, config }).gait, "walk", "and dawn is not brisk");
});

test("an unknown hour behaves like an ordinary day", () => {
  // Every older test omits `hour`; none of them should change behaviour.
  const r = Brain.rhythmFor(undefined);
  assert.equal(r.phase, "day");
  assert.equal(r.sleepAfterScale, 1);
  assert.equal(r.stirEveryScale, 1);
  assert.equal(r.brisk, false);
});

// ------------------------------------------------------------- stripped features

test("the pointer is not an input: a pointer on the bar changes nothing", () => {
  const out = decide({ pointer: { onBar: true, pos: 900 }, x: 100 });
  assert.equal(out.reason, "wander");
});

test("the cat never pounces: arriving anywhere just settles", () => {
  const first = Brain.decide(input({ x: 500 }), Brain.freshState());
  const at = Brain.decide(input({ x: first.target }), first.state);
  const later = Brain.decide(input({ now: 20_000, x: at.target }), at.state);
  for (const out of [first, at, later]) {
    assert.notEqual(out.reason, "pounce");
    assert.equal(out.pettable || out.gait !== "idle", true);
  }
});
