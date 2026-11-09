// Valkiria — a character that walks along the Omarchy bar (fork of navbar-cat).
//
// The plugin is a `kind: "panel"` with `keepLoaded: true`, so the shell mounts
// it at startup (shell.qml:625) and it lives for the whole session. It draws a
// transparent strip over the bar on WlrLayer.Overlay — the same layer the bar's
// own drag ghost uses (Bar.qml:1167) — and is click-through everywhere except a
// small box around the cat while it is sitting still.
//
// All of the cat's decision-making lives in Brain.js, which is pure and tested.
// This file is the body: it gathers what is going on, hands a snapshot to the
// brain each tick, and moves the sprite toward whatever the brain asked for.

import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Hyprland
import Quickshell.Services.Mpris
import Quickshell.Services.UPower
import qs.Commons
import "Brain.js" as Brain

Item {
  id: root

  // Injected by the shell host (shell.qml:629-637).
  property var shell: null
  property var manifest: null
  property string omarchyPath: ""

  readonly property string pluginId: manifest && manifest.id ? String(manifest.id) : "tomas.valkiria"
  readonly property string assetDir: {
    var dir = manifest && manifest.__sourceDir ? String(manifest.__sourceDir) : ""
    if (dir === "") return ""
    return (dir.indexOf("file://") === 0 ? dir : "file://" + dir) + "/assets"
  }
  // The shell assigns `manifest` after the component is constructed, so every
  // path derived from it is empty for the first moments of life. Nothing that
  // touches the filesystem may start before this turns true.
  readonly property bool ready: assetDir !== ""

  // ---------------------------------------------------------------- config

  // Settings live inline on this plugin's entry in shell.json's `plugins[]`,
  // per the shell's storage rules. A third-party plugin gets a scoped `shell`
  // with no `shellConfig`, so the file is read directly and watched.
  property var shellJson: ({})
  readonly property var config: {
    var settings = shellJson ? shellJson.plugins : null
    if (Array.isArray(settings)) {
      for (var i = 0; i < settings.length; i++) {
        if (settings[i] && String(settings[i].id || "") === root.pluginId) return settings[i]
      }
    }
    return ({})
  }

  FileView {
    path: Quickshell.env("HOME") + "/.config/omarchy/shell.json"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      try { root.shellJson = JSON.parse(text()) } catch (e) { root.shellJson = ({}) }
    }
  }

  readonly property real speed: Number(config.speed) > 0 ? Number(config.speed) : 1.0
  readonly property bool pettable: config.pettable !== false
  readonly property int sleepAfter: Number(config.sleepAfter) > 0 ? Number(config.sleepAfter) : 180
  readonly property var reactions: config.reactions && typeof config.reactions === "object"
    ? config.reactions : ({})
  readonly property int catSize: Number(config.size) > 0 ? Number(config.size) : 25

  // Fraction of the bar to keep clear when the cat picks its own spot. Omarchy
  // centres the clock, so the middle is the one place reliably occupied.
  readonly property real avoidCenter: config.avoidCenter !== undefined
    ? Math.max(0, Math.min(0.9, Number(config.avoidCenter)))
    : 0.2
  readonly property bool rhythm: config.rhythm !== false
  readonly property int stirEvery: Number(config.stirEvery) > 0 ? Number(config.stirEvery) : 150
  readonly property int stirFor: Number(config.stirFor) > 0 ? Number(config.stirFor) : 25

  // ------------------------------------------------------------ bar state

  readonly property var bar: shell ? shell.bar : null
  readonly property string barPosition: bar ? String(bar.position) : "top"
  readonly property bool vertical: barPosition === "left" || barPosition === "right"
  readonly property int barSize: bar && bar.barSize ? bar.barSize : 26
  readonly property bool barHidden: bar ? bar.barHidden === true : false

  // ------------------------------------------------------------- monitors

  // One cat, on the output Hyprland has focused, so it follows you between
  // screens rather than multiplying.
  readonly property string pinnedMonitor: {
    var wanted = String(config.monitor || "focused")
    return wanted === "focused" ? "" : wanted
  }
  readonly property string wantedScreenName: {
    if (pinnedMonitor !== "") return pinnedMonitor
    var monitor = Hyprland.focusedMonitor
    return monitor ? String(monitor.name || "") : ""
  }
  readonly property var catScreen: {
    var screens = Quickshell.screens
    if (!screens || screens.length === 0) return null
    for (var i = 0; i < screens.length; i++) {
      if (String(screens[i].name) === root.wantedScreenName) return screens[i]
    }
    return screens[0]
  }

  // --------------------------------------------------------- world inputs

  // The user counts as away after this long without input. The brain applies
  // its own (longer) sleep delay on top.
  readonly property int awayAfterSec: 15
  property real lastActivityAt: 0

  IdleMonitor {
    id: idleMonitor
    timeout: root.awayAfterSec
    respectInhibitors: false
    onIsIdleChanged: {
      // Backdate the start of the absence; on return, the clock restarts.
      root.lastActivityAt = Date.now() - (isIdle ? root.awayAfterSec * 1000 : 0)
      if (!isIdle) root.nudge()
    }
  }

  property real pettedAt: -1
  property var workspaceEvent: null
  property real notifyAt: -1
  property real themeChangedAt: -1

  // The shell owns the notification server, so a plugin cannot run a second
  // one — but it does not need to. `serviceFor` hands out the running service
  // (shell.qml:275) and its popup list is deliberately aliased for exactly
  // this: "consumers outside this Item's id scope can bind to it".
  readonly property var notifications: shell && shell.serviceFor
    ? shell.serviceFor("omarchy.notifications") : null
  readonly property var popupModel: notifications && notifications.popupModel
    ? notifications.popupModel : null
  property int _popupCount: 0

  Connections {
    target: root.popupModel
    function onCountChanged() {
      var n = root.popupModel ? root.popupModel.count : 0
      // Only an arrival is interesting; a toast expiring is not news.
      if (n > root._popupCount && root.reactions.notification !== false) {
        root.notifyAt = Date.now()
        root.nudge()
      }
      root._popupCount = n
    }
  }

  // A theme switch repaints the cat mid-stride, which is a good excuse to have
  // it startle. The first assignment is the initial colour, not a change.
  readonly property color themeInk: Color.bar.text
  property bool _themeSeen: false
  onThemeInkChanged: {
    if (_themeSeen && reactions.theme !== false) {
      themeChangedAt = Date.now()
      nudge()
    }
    _themeSeen = true
  }

  readonly property bool musicPlaying: {
    if (reactions.music === false) return false
    var players = Mpris.players ? Mpris.players.values : []
    for (var i = 0; i < players.length; i++) {
      if (players[i] && players[i].isPlaying) return true
    }
    return false
  }

  // A machine with no battery reports onBattery false forever, which would
  // read as "permanently charging" and leave the cat asleep for good. Only
  // count it as charging when there is actually a battery being charged.
  readonly property bool charging: {
    if (reactions.charging === false) return false
    var device = UPower.displayDevice
    return !!(device && device.isPresent && !UPower.onBattery)
  }

  // ------------------------------------------------------------ cat state

  readonly property real barLength: catScreen
    ? (vertical ? catScreen.height : catScreen.width)
    : 0

  property real catPos: 0
  property string catPose: "stop"
  property bool catBob: false
  property bool catSettled: false
  property int animTick: 0
  // Seeded from the clock so the cat does not live the same day twice. The
  // brain's generator is deterministic by design — that is what makes the
  // wander tests reproducible — but a fixed seed would mean every session
  // started in the same spot and wandered the same route.
  property var brainState: Brain.freshState(Date.now() % 2147483647)

  readonly property bool maskActive: catSettled && root.pettable && !root.barHidden

  // ------------------------------------------------------- event sources

  Connections {
    target: Hyprland
    function onFocusedWorkspaceChanged() {
      var workspace = Hyprland.focusedWorkspace
      if (!workspace) return
      var id = Number(workspace.id)
      if (root._lastWorkspaceId >= 0 && id !== root._lastWorkspaceId) {
        root.workspaceEvent = { at: Date.now(), dir: id > root._lastWorkspaceId ? 1 : -1 }
        root.nudge()
      }
      root._lastWorkspaceId = id
    }
  }
  property int _lastWorkspaceId: -1

  onMusicPlayingChanged: nudge()
  onChargingChanged: nudge()
  onBarPositionChanged: nudge()
  onCatScreenChanged: nudge()

  // ------------------------------------------------------------ the tick

  // 30fps: fast enough that a running cat does not visibly stutter, slow
  // enough to be free. The sprite's own frames advance far slower (below).
  readonly property int tickMs: 33

  function nudge() {
    // Something happened that the cat might care about — make sure the loop is
    // running to notice it.
    if (!ticker.running && !barHidden) ticker.running = true
  }

  Timer {
    id: ticker
    interval: root.tickMs
    repeat: true
    running: false
    onTriggered: root.step()
  }

  Timer {
    id: animator
    // oneko alternates its two frames far slower than the movement updates;
    // matching that keeps the walk cycle looking hand-drawn rather than frantic.
    interval: 150
    repeat: true
    running: ticker.running
    onTriggered: root.animTick = (root.animTick + 1) & 0xff
  }

  property bool _placed: false

  function step() {
    if (!catScreen || barLength <= 0) return

    var now = Date.now()
    var maxPos = Math.max(0, barLength - catSize)

    // Drop the cat somewhere arbitrary the first time we know how long the bar
    // is. Starting at zero every session meant that on a machine left plugged
    // in — where the cat settles straight away — it always dozed off in the
    // same left-hand corner.
    if (!_placed) {
      _placed = true
      catPos = Brain.pickSpot(brainState, maxPos, barLength, avoidCenter)
    }

    var decision = Brain.decide({
      now: now,
      axis: vertical ? "v" : "h",
      edge: barPosition,
      barLength: barLength,
      catSize: catSize,
      x: catPos,
      pettedAt: pettedAt >= 0 ? pettedAt : null,
      lastActivityAt: idleMonitor.isIdle ? lastActivityAt : now,
      music: musicPlaying,
      charging: charging,
      workspaceEvent: workspaceEvent,
      notifyAt: notifyAt >= 0 ? notifyAt : null,
      notifying: reactions.notification !== false && popupModel !== null
        && popupModel.count > 0,
      themeChangedAt: themeChangedAt >= 0 ? themeChangedAt : null,
      hour: new Date().getHours(),
      config: {
        pettable: pettable,
        sleepAfter: sleepAfter,
        rhythm: rhythm,
        avoidCenter: avoidCenter,
        stirEvery: stirEvery,
        stirFor: stirFor,
        reactions: reactions,
      },
    }, brainState)

    brainState = decision.state

    // Move toward the target at whatever pace the brain asked for. Positions
    // are rounded to whole logical pixels: pixel art on fractional offsets
    // shimmers as it moves.
    var pixelsPerSecond = decision.gait === "run" ? 150 : (decision.gait === "walk" ? 55 : 0)
    if (pixelsPerSecond > 0) {
      var stepSize = pixelsPerSecond * speed * (tickMs / 1000)
      var delta = decision.target - catPos
      catPos = Math.abs(delta) <= stepSize
        ? decision.target
        : catPos + (delta > 0 ? stepSize : -stepSize)
    }
    catPos = Math.max(0, Math.min(maxPos, catPos))

    catPose = decision.pose
    catBob = decision.bob
    catSettled = decision.gait === "idle"

    // Let a stale scamper expire so it cannot re-fire.
    if (workspaceEvent && now - workspaceEvent.at > 4000) workspaceEvent = null
    if (notifyAt >= 0 && now - notifyAt > 20000) notifyAt = -1
    if (themeChangedAt >= 0 && now - themeChangedAt > 4000) themeChangedAt = -1

    // A sleeping cat needs no frames until something wakes it, and every event
    // source above calls nudge() to start the loop again.
    if (decision.idle) {
      ticker.running = false
      animTick = 0
      // The brain books its own next stir while it sleeps, so the body has to
      // set an alarm. Without it the cat would sleep until you touched the
      // mouse, which on an unattended machine is never.
      if (decision.wakeIn > 0) {
        stirAlarm.interval = Math.max(1000, Math.round(decision.wakeIn))
        stirAlarm.restart()
      }
    }
  }

  Timer {
    id: stirAlarm
    repeat: false
    onTriggered: root.nudge()
  }

  onBarHiddenChanged: {
    if (barHidden) ticker.running = false
    else nudge()
  }

  Component.onCompleted: {
    lastActivityAt = Date.now()
    var workspace = Hyprland.focusedWorkspace
    if (workspace) _lastWorkspaceId = Number(workspace.id)
    nudge()
  }

  // ------------------------------------------------------------- settings

  // The menu is the one thing here that writes. It touches only this plugin's
  // own entry in shell.json, only when you pick something, and it goes through
  // the shell's scoped API (a third-party panel has no mutateShellConfig).
  // updateEntryInline replaces the entry's settings, so merge into a copy.
  function setSetting(key, value) {
    if (!shell || typeof shell.updateEntryInline !== "function") return
    var next = JSON.parse(JSON.stringify(root.config))
    next[key] = value
    shell.updateEntryInline(root.pluginId, next)
  }

  CatMenu {
    id: catMenu
    cat: root
    onChose: function (key, value) { root.setSetting(key, value) }
  }


  // ---------------------------------------------------------- the window

  PanelWindow {
    id: window

    screen: root.catScreen
    visible: root.catScreen !== null && !root.barHidden
    color: "transparent"

    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.namespace: "valkiria"
    // Above the bar (which sits on Top), matching what the bar's own drag
    // ghost does when it needs to float over everything.
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

    anchors {
      top: root.barPosition !== "bottom"
      bottom: root.barPosition !== "top"
      left: root.barPosition !== "right"
      right: root.barPosition !== "left"
    }
    // The window covers exactly the bar strip.
    implicitWidth: root.vertical ? root.barSize : 0
    implicitHeight: root.vertical ? 0 : root.barSize

    // Where the middle of the bar strip sits inside this window.
    readonly property real stripCentre: root.barSize / 2

    // Click-through everywhere the cat is not. While it is walking the region
    // is empty, so a moving cat can never swallow a click meant for the bar;
    // it only becomes clickable once it has settled somewhere.
    mask: Region {
      x: root.maskActive ? Math.round(sprite.x) : 0
      y: root.maskActive ? Math.round(sprite.y) : 0
      width: root.maskActive ? sprite.width : 0
      height: root.maskActive ? sprite.height : 0
    }

    DogSprite {
      id: sprite

      // The art cell is 40x25, so the sprite is 1.6 times as wide as it is tall.
      width: Math.round(root.catSize * 1.6)
      height: root.catSize
      devicePixels: width * (root.catScreen ? root.catScreen.devicePixelRatio : 1)
      assetDir: root.assetDir

      pose: root.catPose
      animTick: root.animTick
      fillColor: Color.bar.text
      inkColor: Color.bar.background

      // Along the bar the cat sits where the brain put it; across the bar it
      // stays centred in the strip.
      readonly property real crossPos:
        window.stripCentre - height / 2 + bobOffset

      x: root.vertical ? Math.round(crossPos) : Math.round(root.catPos)
      y: root.vertical ? Math.round(root.catPos) : Math.round(crossPos)

      // A cat listening to music bobs; everything else sits still.
      property int bobOffset: root.catBob ? ((root.animTick & 1) ? -1 : 0) : 0

      MouseArea {
        anchors.fill: parent
        enabled: root.maskActive
        acceptedButtons: Qt.LeftButton | Qt.RightButton
        onClicked: function (mouse) {
          if (mouse.button === Qt.RightButton) {
            catMenu.anchorPos = root.vertical
              ? sprite.y + sprite.height / 2
              : sprite.x + sprite.width / 2
            catMenu.open = true
            return
          }
          root.pettedAt = Date.now()
          root.nudge()
        }
      }
    }
  }
}
