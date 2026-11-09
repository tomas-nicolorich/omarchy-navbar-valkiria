// Valkiria's behaviour core.
//
// Pure: no QML, no clock of its own, nothing outside its arguments. `decide()`
// takes a snapshot of the world plus her carried-over state and says what she
// does next. test/brain.test.mjs drives it with a fake clock.
//
// The one rule everything else hangs on: she SETTLES only inside her yard.
// Every stationary step of every script is checked against the yard span each
// tick; if she is somewhere she must not be, the script is dropped and she
// walks home. The only things she does outside the yard are moving (walks,
// zoomies) and brief "beats" (a bark, a shake) that are never reported as
// settled.
//
// Coordinates are logical px along the bar (x for a horizontal bar, y for a
// vertical one); `catSize` is her length along the bar.

var WALK_PX_S = 55
var RUN_PX_S = 150
var ARRIVE_EPS = 2

var BARK_MS = 1500
var SHAKE_MS = 1500
var PEEK_MS = 1500
var GLANCE_MS = 1500
var BURROW_MS = 1800
var WRIGGLE_MS = 1200
var STRETCH_MS = 2000
var CLICK_WAG_MS = 2500
var CLICK_HOVER_MS = 2000
var TREAT_WIGGLE_MS = 1200
var TREAT_WAG_MS = 3000
// Chance that a workspace switch also sends her on a walk.
var WORKSPACE_WALK_P = 0.35
// A meal lasts this long from its time.
var MEAL_MS = 30 * 60000
// Morning walkies are still on offer this long after their time.
var WALKIES_WINDOW_MIN = 180

var DEFAULTS = {
  sleep: "23:00-09:00",
  walkies: "09:15",
  meals: ["10:00", "20:00"],
  siesta: "15:00-17:00",
  tripsPerHour: 4,
  lowBattery: 20,
  // Away at least this long (seconds) and coming back earns a greeting.
  greetAfter: 60,
  // Seconds of absence before she burrows, normally and during the siesta.
  idleBurrowAfter: 120,
  siestaBurrowAfter: 10,
}

function freshState(seed) {
  return {
    seed: seed === undefined ? 987654321 : seed,
    act: null,
    beat: null,
    glance: null,
    tripWanted: null,
    nextTripAt: null,
    lastWalkiesDay: null,
    lastNow: null,
    lastPose: null,
    facing: 1,
    settled: false,
    seen: { greet: -1, notify: -1, theme: -1, workspace: -1, click: -1, command: -1 },
  }
}

// A small LCG so a given seed always lives the same day.
function nextRandom(state) {
  state.seed = (state.seed * 1103515245 + 12345) % 2147483648
  return state.seed / 2147483648
}

function between(state, low, high) { return low + nextRandom(state) * (high - low) }

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v) }

// ---------------------------------------------------------------- clock

// "HH:MM" -> minutes since midnight, or null.
function parseClock(text) {
  var m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(text === undefined ? "" : text))
  if (!m) return null
  var h = Number(m[1]), mm = Number(m[2])
  if (h > 24 || mm > 59) return null
  return (h % 24) * 60 + mm
}

// "23:00-09:00" -> { from, to } in minutes; may wrap midnight.
function parseRange(text) {
  var parts = String(text === undefined ? "" : text).split("-")
  if (parts.length !== 2) return null
  var from = parseClock(parts[0]), to = parseClock(parts[1])
  if (from === null || to === null) return null
  return { from: from, to: to }
}

function inRange(minutes, range) {
  if (!range || range.from === range.to) return false
  return range.from < range.to
    ? minutes >= range.from && minutes < range.to
    : minutes >= range.from || minutes < range.to
}

function setting(config, key) {
  return config && config[key] !== undefined ? config[key] : DEFAULTS[key]
}

// ------------------------------------------------------------------ yard

// The stretch of bar she may settle on: the yard widget's slot, less her own
// length. With no yard placed, a default slot a bit right of the middle.
function yardSpan(input) {
  var config = input.config || {}
  var cat = input.catSize
  var maxX = Math.max(0, input.barLength - cat)
  var yard = input.yard
  if (!yard) {
    var w = Number(config.yardWidth) > 0 ? Number(config.yardWidth) : cat * 3
    yard = { x: input.barLength * 0.62 - w / 2, w: w }
  }
  var lo = clamp(yard.x, 0, maxX)
  var hi = clamp(yard.x + yard.w - cat, lo, maxX)
  return { lo: lo, hi: hi }
}

function inSpan(x, span) { return x >= span.lo - ARRIVE_EPS && x <= span.hi + ARRIVE_EPS }

// Where a step's target points: a fraction of the yard span (so it follows a
// yard that moves) or an absolute position.
function resolve(to, ctx) {
  if (typeof to === "object") return ctx.span.lo + to.f * (ctx.span.hi - ctx.span.lo)
  return clamp(to, 0, ctx.maxX)
}

// --------------------------------------------------------------- scripts
//
// A script is a list of steps run in order. A step with `to` moves her there
// (and ends on arrival); a step with `ms` holds the pose for that long
// (Infinity holds until the script is replaced). `beat` steps may happen
// outside the yard.

function go(pose, to, gait) { return { pose: pose, to: to, gait: gait || "walk" } }
function hold(pose, ms) { return { pose: pose, ms: ms } }

function script(kind, steps, extra) {
  var act = { kind: kind, reason: kind, want: "free", steps: steps, i: 0, stepAt: null, harness: false }
  if (extra) for (var k in extra) act[k] = extra[k]
  return act
}

function homeScript(state) {
  return script("return", [go("walk", { f: nextRandom(state) })])
}

function napScript(reason) {
  return script("nap", [
    go("walk", { f: 1 }),
    hold("burrow", BURROW_MS),
    hold("blanket", Infinity),
  ], { want: "nap", reason: reason })
}

// Rising from the blanket, then the play-bow.
function wakeScript() {
  return script("wake", [hold("wriggle", WRIGGLE_MS), hold("stretch", STRETCH_MS)],
    { want: "none" })
}

function musicScript(state) {
  var steps = [go("walk", { f: nextRandom(state) }), hold("hover", 1500)]
  for (var i = 0; i < 3; i++) {
    steps.push(hold("slump", between(state, 5000, 8000)))
    steps.push(hold("wag", 2500))
  }
  return script("music", steps, { want: "music" })
}

function greetScript(input, state, ctx) {
  var steps = []
  if (state.lastPose === "blanket" || state.lastPose === "burrow") {
    steps.push(hold("wriggle", WRIGGLE_MS))
  }
  var far = input.x < ctx.maxX / 2 ? ctx.maxX : 0
  steps.push(go("run", far, "run"))
  steps.push(go("run", ctx.maxX - far, "run"))
  steps.push(go("run", { f: nextRandom(state) }, "run"))
  return script("greet", steps, { want: "greet" })
}

// A walk away from the yard, to somewhere outside it. `dir` prefers a side.
function tripScript(state, ctx, dir) {
  var leftRoom = ctx.span.lo - ctx.cat
  var rightRoom = ctx.maxX - ctx.span.hi - ctx.cat
  var side = 0
  if (dir > 0 && rightRoom > 0) side = 1
  else if (dir < 0 && leftRoom > 0) side = -1
  else if (leftRoom > 0 && rightRoom > 0) side = nextRandom(state) < 0.5 ? -1 : 1
  else if (rightRoom > 0) side = 1
  else if (leftRoom > 0) side = -1
  if (side === 0) return null
  var target = side > 0
    ? ctx.span.hi + ctx.cat + nextRandom(state) * rightRoom
    : nextRandom(state) * leftRoom
  return script("trip", [go("walk", target)])
}

// Morning walkies: the whole bar, nearest end first, then home.
function walkiesScript(input, ctx) {
  var first = input.x < ctx.maxX / 2 ? 0 : ctx.maxX
  return script("walkies", [go("walk", first), go("walk", ctx.maxX - first)],
    { harness: true })
}

function yardScript(state, low) {
  var r = nextRandom(state)
  var spot = { f: nextRandom(state) }
  // Low battery: she mostly just hovers about, and what she does is slow.
  if (low && r < 0.6) return script("yard", [hold("hover", between(state, 4000, 9000))])
  if (r < 0.2) return script("yard", [go("walk", spot)])
  if (r < 0.4) return script("yard", [go("sniff", spot)])
  if (r < 0.52) return script("yard", [hold("dig", between(state, 2500, 4500))])
  if (r < 0.62) return script("yard", [hold("scratch", between(state, 2000, 3500))])
  if (r < 0.75) return script("yard", [hold("hover", 1500), hold("slump", between(state, 7000, 14000))])
  if (r < 0.9) return script("yard", [hold("hover", 1200), hold("sit", between(state, 3000, 6000)),
    hold("wag", 2500), hold("sit", 2000)])
  return script("yard", [hold("hover", between(state, 3000, 6000))])
}

// Waiting hopefully at meal time.
function mealScript(state) {
  var steps = [go("walk", { f: nextRandom(state) }), hold("hover", between(state, 5000, 9000)),
    hold("sit", 4000), hold("wag", 2500)]
  return script("meal", steps)
}

// ----------------------------------------------------------------- brain

function context(input, state) {
  var config = input.config || {}
  var cat = input.catSize
  var minutes = Number(input.minutes)
  var batteryPct = input.batteryPct === undefined ? null : input.batteryPct
  var reactions = config.reactions || {}
  var dnd = input.dnd === true
  var react = function (name) { return !dnd && reactions[name] !== false }
  var low = batteryPct !== null && batteryPct < Number(setting(config, "lowBattery"))
    && input.charging !== true
  return {
    cat: cat,
    maxX: Math.max(0, input.barLength - cat),
    span: yardSpan(input),
    minutes: isFinite(minutes) ? minutes : 720,
    low: low,
    dnd: dnd,
    react: react,
    sleepRange: parseRange(setting(config, "sleep")),
    siestaRange: parseRange(setting(config, "siesta")),
  }
}

function inMeal(input, ctx) {
  var meals = setting(input.config, "meals")
  if (!Array.isArray(meals)) return false
  for (var i = 0; i < meals.length; i++) {
    var at = parseClock(meals[i])
    if (at === null) continue
    var since = ((ctx.minutes - at) % 1440 + 1440) % 1440
    if (since * 60000 < MEAL_MS) return true
  }
  return false
}

function walkiesDue(input, state, ctx) {
  var at = parseClock(setting(input.config, "walkies"))
  if (at === null || state.lastWalkiesDay === input.day) return false
  var since = ctx.minutes - at
  return since >= 0 && since < WALKIES_WINDOW_MIN && !inRange(ctx.minutes, ctx.sleepRange)
}

// What she is standing by to do, by the priority order: music > charging >
// idle, then the day's rhythm (siesta, night). Greet and notification are
// events and are handled before this.
function standing(input, ctx) {
  var idleFor = Number(input.idleFor) || 0
  var config = input.config || {}
  if (ctx.dnd) return { want: "nap", reason: "dnd" }
  // Menu: Bedtime puts her to bed whatever the clock says; Wake up ("up")
  // keeps her up through the night until the sleep window has passed.
  if (input.bedtime === "bed") return { want: "nap", reason: "bedtime" }
  if (ctx.react("music") && input.music === true) return { want: "music" }
  if (ctx.react("charging") && input.charging === true) return { want: "nap", reason: "charging" }
  if (ctx.react("idle") && idleFor >= Number(setting(config, "idleBurrowAfter")) * 1000) {
    return { want: "nap", reason: "idle" }
  }
  if (inRange(ctx.minutes, ctx.siestaRange)
      && idleFor >= Number(setting(config, "siestaBurrowAfter")) * 1000) {
    return { want: "nap", reason: "siesta" }
  }
  if (inRange(ctx.minutes, ctx.sleepRange) && input.bedtime !== "up") {
    return { want: "nap", reason: "night" }
  }
  return { want: "free" }
}

function underBlanket(act) {
  return !!act && act.kind === "nap" && act.i >= 1
}

function takeEvents(input, state, ctx) {
  var seen = state.seen
  var now = input.now

  var g = input.greet
  if (g && g.at > seen.greet) {
    seen.greet = g.at
    var away = Number(g.awayMs)
    if (ctx.react("greet") && (!isFinite(away) || away >= Number(setting(input.config, "greetAfter")) * 1000)) {
      state.act = greetScript(input, state, ctx)
      state.beat = null
    }
  }

  var busyGreeting = state.act && state.act.kind === "greet"

  if (input.notifyAt !== null && input.notifyAt !== undefined && input.notifyAt > seen.notify) {
    seen.notify = input.notifyAt
    var nightAsleep = state.act && state.act.kind === "nap" && state.act.reason === "night"
    if (ctx.react("notification") && !busyGreeting && !nightAsleep) {
      state.beat = { steps: [{ pose: "bark", ms: BARK_MS }], t0: now, settled: false,
        // Notifications come in at the top right of the screen.
        face: input.axis === "v" ? -1 : 1 }
    }
  }

  if (input.themeChangedAt !== null && input.themeChangedAt !== undefined
      && input.themeChangedAt > seen.theme) {
    seen.theme = input.themeChangedAt
    if (ctx.react("theme") && !busyGreeting && !state.beat && !underBlanket(state.act)) {
      state.beat = { steps: [{ pose: "bark", ms: 500 }, { pose: "scratch", ms: SHAKE_MS }],
        t0: now, settled: false }
    }
  }

  var w = input.workspaceEvent
  if (w && w.at > seen.workspace) {
    seen.workspace = w.at
    if (ctx.react("workspace") && !busyGreeting) {
      state.glance = { until: now + GLANCE_MS, dir: w.dir < 0 ? -1 : 1 }
      if (nextRandom(state) < WORKSPACE_WALK_P) state.tripWanted = state.glance.dir
    }
  }

  var cmd = input.command
  if (cmd && cmd.at > seen.command) {
    seen.command = cmd.at
    if (!ctx.dnd && !busyGreeting) {
      if (cmd.kind === "walkies") {
        state.lastWalkiesDay = input.day
        var walk = walkiesScript(input, ctx)
        walk.want = "any"
        if (underBlanket(state.act)) walk.steps.unshift(hold("wriggle", WRIGGLE_MS))
        state.act = walk
        state.beat = null
      } else if (cmd.kind === "treat") {
        state.act = script("treat", [hold("wriggle", TREAT_WIGGLE_MS), hold("wag", TREAT_WAG_MS)],
          { want: "any" })
        state.beat = null
      }
    }
  }

  if (input.clickedAt !== null && input.clickedAt !== undefined && input.clickedAt > seen.click) {
    seen.click = input.clickedAt
    if (state.settled && !state.beat && !ctx.dnd) {
      if (underBlanket(state.act)) {
        // A sleepy peek, then back under.
        state.beat = { steps: [{ pose: "wriggle", ms: PEEK_MS }], t0: now, settled: true }
      } else if (state.act && state.act.kind !== "greet" && state.act.kind !== "wake") {
        state.act = script("click", [hold("wag", CLICK_WAG_MS), hold("hover", CLICK_HOVER_MS)],
          { want: "any" })
      }
    }
  }
}

// Replace the running script when what she is standing by to do has changed.
function reconcile(state, standingNow) {
  var act = state.act
  if (!act) return
  if (act.want === "any" || act.want === "greet" || act.want === "none") return
  var want = standingNow.want
  if (act.want === want) {
    if (want === "nap") act.reason = standingNow.reason
    return
  }
  state.act = underBlanket(act) ? wakeScript() : null
}

function select(input, state, ctx, standingNow) {
  if (standingNow.want === "music") return musicScript(state)
  if (standingNow.want === "nap") return napScript(standingNow.reason)
  if (!inSpan(input.x, ctx.span)) return homeScript(state)

  var now = input.now
  var canWalk = !ctx.low
  var meal = inMeal(input, ctx)

  if (canWalk && walkiesDue(input, state, ctx)) {
    state.lastWalkiesDay = input.day
    return walkiesScript(input, ctx)
  }
  if (canWalk && state.tripWanted !== null) {
    var dir = state.tripWanted
    state.tripWanted = null
    var wanted = tripScript(state, ctx, dir)
    if (wanted) return wanted
  }
  if (canWalk && !meal) {
    var mean = 3600000 / Math.max(0.1, Number(setting(input.config, "tripsPerHour")))
    if (state.nextTripAt === null) state.nextTripAt = now + mean * between(state, 0.5, 1.5)
    if (now >= state.nextTripAt) {
      state.nextTripAt = now + mean * between(state, 0.5, 1.5)
      var trip = tripScript(state, ctx, 0)
      if (trip) return trip
    }
  }
  if (meal) return mealScript(state)
  return yardScript(state, ctx.low)
}

// Run the current script as far as it will go this tick. Returns what she is
// doing, or null when the script has finished or been abandoned.
function advance(input, state, ctx) {
  var act = state.act
  for (var guard = 0; act && guard < 12; guard++) {
    var step = act.steps[act.i]
    if (!step) { state.act = null; return null }
    if (act.stepAt === null) act.stepAt = input.now
    if (step.to !== undefined) {
      var target = resolve(step.to, ctx)
      if (Math.abs(target - input.x) <= ARRIVE_EPS) {
        act.i++
        act.stepAt = input.now
        continue
      }
      return { step: step, moving: true, target: target }
    }
    // Stationary. Never settle anywhere but the yard.
    if (!inSpan(input.x, ctx.span)) { state.act = null; return null }
    if (input.now - act.stepAt >= step.ms) {
      act.i++
      act.stepAt = input.now
      continue
    }
    return { step: step, moving: false, target: input.x }
  }
  state.act = null
  return null
}

function beatStep(beat, now) {
  var elapsed = now - beat.t0
  for (var i = 0; i < beat.steps.length; i++) {
    if (elapsed < beat.steps[i].ms) return beat.steps[i]
    elapsed -= beat.steps[i].ms
  }
  return null
}

function decide(input, state) {
  state = state || freshState()
  var now = input.now
  var ctx = context(input, state)
  var dt = state.lastNow === null ? 0 : Math.max(0, now - state.lastNow)
  state.lastNow = now
  var speedScale = ctx.low ? 0.5 : 1
  var standingNow = standing(input, ctx)
  ctx.sleeping = standingNow.want === "nap"
    && (standingNow.reason === "bedtime" || standingNow.reason === "night")
  ctx.clearBedtime = input.bedtime === "up" && !inRange(ctx.minutes, ctx.sleepRange)

  takeEvents(input, state, ctx)

  // A beat (bark, shake, peek) pauses whatever she was doing: the script's
  // clock is held until it is over.
  if (state.beat) {
    var bs = beatStep(state.beat, now)
    if (bs) {
      if (state.act && state.act.stepAt !== null) state.act.stepAt += dt
      var f = state.beat.face !== undefined ? state.beat.face : state.facing
      state.facing = f
      state.lastPose = bs.pose
      state.settled = state.beat.settled
      return output(state, ctx, "beat", false, input.x, "idle", bs.pose, f, state.beat.settled, speedScale, 100)
    }
    state.beat = null
  }

  reconcile(state, standingNow)
  if (state.tripWanted !== null && state.act && state.act.kind === "yard") state.act = null
  if (ctx.low || state.act && (state.act.kind === "nap" || state.act.kind === "music")) {
    state.tripWanted = null
  }

  var r = null
  for (var attempt = 0; attempt < 3 && !r; attempt++) {
    if (!state.act) state.act = select(input, state, ctx, standingNow)
    r = advance(input, state, ctx)
  }
  if (!r) {
    // Nothing runnable (should not happen): stand and hover where she is.
    state.act = homeScript(state)
    r = { step: go("walk", { f: 0.5 }), moving: true, target: clamp(input.x, ctx.span.lo, ctx.span.hi) }
  }

  var act = state.act
  var facing = state.facing
  var pose = r.step.pose
  var gait = "idle"
  if (r.moving) {
    gait = r.step.gait
    var delta = r.target - input.x
    if (delta > ARRIVE_EPS) facing = 1
    else if (delta < -ARRIVE_EPS) facing = -1
  } else if (state.glance && now < state.glance.until) {
    facing = state.glance.dir
  }
  state.facing = facing
  state.lastPose = pose
  state.settled = !r.moving
  // Sleeping needs no frames; check back in a second for the clock.
  var wakeIn = pose === "blanket" ? 1000 : 0
  return output(state, ctx, act.reason, act.harness, r.target, gait, pose, facing, !r.moving, speedScale, wakeIn)
}

function output(state, ctx, reason, harness, target, gait, pose, facing, settled, speedScale, wakeIn) {
  return {
    reason: reason,
    target: target,
    gait: gait,
    pose: pose,
    facing: facing,
    settled: settled,
    // Click and menu are for a settled Valkiria only.
    pettable: settled,
    harness: harness === true,
    speedScale: speedScale,
    wakeIn: wakeIn,
    // For the menu: she is asleep (or about to be) by bedtime or the clock, so
    // it should offer Wake up rather than Bedtime.
    sleeping: ctx.sleeping,
    // A Wake-up override that has outlived the night; the body can drop it.
    clearBedtime: ctx.clearBedtime,
    state: state,
  }
}
