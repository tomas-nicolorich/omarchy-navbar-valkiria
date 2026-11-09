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
  readonly property var reactions: config.reactions && typeof config.reactions === "object"
    ? config.reactions : ({})
  // Do not disturb (the menu in ticket 005 writes it).
  readonly property bool dnd: config.dnd === true
  // Her length along the bar, in logical px: the art is 40x25 art px drawn at
  // 32x20 logical px (1 art px = 0.8 logical px, 1:1 device px at scale 1.25).
  readonly property int catSize: Number(config.size) > 0 ? Number(config.size) : 32
  readonly property int catHeight: Math.round(catSize * 25 / 40)

  // Brain config: sleep, walkies, meals, siesta, yardWidth, tripsPerHour,
  // greetAfter, idleBurrowAfter, siestaBurrowAfter, lowBattery, reactions.
  // Absent keys fall back to the brain's own defaults.
  readonly property var brainConfig: config

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

  // The user counts as away after this long without input; the brain applies
  // its own, longer, delays on top.
  readonly property int awayAfterSec: 15
  // When the current absence began (backdated by the idle timeout), or 0.
  property real awaySince: 0
  property var greet: null

  // There is no shell signal for "screen unlocked" or "idle ended". The lock
  // screen is an ext-session-lock surface that takes input, so touching the
  // keyboard to unlock ends the idle period too: idle-end after a long enough
  // absence is the greeting, and covers unlock.
  IdleMonitor {
    id: idleMonitor
    timeout: root.awayAfterSec
    respectInhibitors: false
    onIsIdleChanged: {
      if (isIdle) {
        root.awaySince = Date.now() - root.awayAfterSec * 1000
      } else {
        var away = root.awaySince > 0 ? Date.now() - root.awaySince : 0
        root.awaySince = 0
        root.greet = { at: Date.now(), awayMs: away }
      }
      root.nudge()
    }
  }

  property real clickedAt: -1
  property var workspaceEvent: null
  property real notifyAt: -1
  property real themeChangedAt: -1

  // Notification arrivals. The shell hands third-party plugins no way to see
  // them: `serviceFor` is null for them, the first-party proxy is only given to
  // plugins of kind "bar", and that proxy exposes nothing but doNotDisturb. A
  // second NotificationServer is impossible (the shell owns the bus name). So
  // watch the session bus instead: every notification is a Notify method call
  // on org.freedesktop.Notifications, and dbus-monitor can see those without
  // owning the name. Verified: one `notify-send` produces one Notify call.
  Process {
    id: notifyWatch
    command: ["dbus-monitor", "--session",
      "type='method_call',interface='org.freedesktop.Notifications',member='Notify'"]
    running: root.reactions.notification !== false
    stdout: SplitParser {
      onRead: function (line) {
        if (line.indexOf("member=Notify") === -1) return
        root.notifyAt = Date.now()
        root.nudge()
      }
    }
  }

  // Battery percentage for the "low battery" mood; null with no battery.
  readonly property var batteryPct: {
    var device = UPower.displayDevice
    if (!device || !device.isPresent) return null
    return Math.round(Number(device.percentage) * (Number(device.percentage) <= 1 ? 100 : 1))
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

  // Her extent along the bar (the sprite is not rotated on a vertical bar).
  readonly property int alongSize: vertical ? catHeight : catSize

  readonly property real barLength: catScreen
    ? (vertical ? catScreen.height : catScreen.width)
    : 0

  property real catPos: 0
  property string catPose: "sit"
  property int catFacing: 1
  property bool catSettled: false
  property int animTick: 0
  // Seeded from the clock so she does not live the same day twice (the brain's
  // generator is deterministic, which is what makes its tests reproducible).
  property var brainState: Brain.freshState(Date.now() % 2147483647)

  // Where the yard widget sits on the screen she is on (Yard.qml singleton).
  readonly property var yardRecord: catScreen ? Yard.xs[String(catScreen.name)] : undefined
  readonly property var yardForBrain: yardRecord ? { x: yardRecord.x, w: yardRecord.w } : null

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
    ticker.interval = tickMs
    if (!ticker.running && !barHidden) ticker.running = true
  }

  Timer {
    id: ticker
    // The brain asks (wakeIn) for a slower tick while she lies under the
    // blanket; the clock still has to be checked for waking time.
    interval: root.tickMs
    repeat: true
    running: false
    onTriggered: root.step()
  }

  Timer {
    id: animator
    // Frames advance far slower than the movement updates; this keeps the
    // walk cycle looking drawn rather than frantic.
    interval: 150
    repeat: true
    running: ticker.running
    onTriggered: root.animTick = (root.animTick + 1) & 0xff
  }

  property bool _placed: false

  function step() {
    if (!catScreen || barLength <= 0) return

    var now = Date.now()
    var date = new Date(now)
    var maxPos = Math.max(0, barLength - alongSize)

    // She starts the session at home in the yard.
    if (!_placed) {
      _placed = true
      var span = Brain.yardSpan({ barLength: barLength, catSize: alongSize,
        yard: yardForBrain, config: brainConfig })
      catPos = span.lo
    }

    var decision = Brain.decide({
      now: now,
      axis: vertical ? "v" : "h",
      barLength: barLength,
      catSize: alongSize,
      x: catPos,
      yard: yardForBrain,
      minutes: date.getHours() * 60 + date.getMinutes(),
      day: date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate(),
      idleFor: idleMonitor.isIdle && awaySince > 0 ? now - awaySince : 0,
      music: musicPlaying,
      charging: charging,
      batteryPct: batteryPct,
      dnd: dnd,
      greet: greet,
      notifyAt: notifyAt >= 0 ? notifyAt : null,
      themeChangedAt: themeChangedAt >= 0 ? themeChangedAt : null,
      workspaceEvent: workspaceEvent,
      clickedAt: clickedAt >= 0 ? clickedAt : null,
      config: brainConfig,
    }, brainState)

    brainState = decision.state

    // Move toward the target at whatever pace the brain asked for. Positions
    // are rounded to whole logical pixels: pixel art on fractional offsets
    // shimmers as it moves.
    var pixelsPerSecond = decision.gait === "run" ? Brain.RUN_PX_S
      : (decision.gait === "walk" ? Brain.WALK_PX_S : 0)
    if (pixelsPerSecond > 0) {
      var stepSize = pixelsPerSecond * decision.speedScale * speed * (tickMs / 1000)
      var delta = decision.target - catPos
      catPos = Math.abs(delta) <= stepSize
        ? decision.target
        : catPos + (delta > 0 ? stepSize : -stepSize)
    }
    catPos = Math.max(0, Math.min(maxPos, catPos))

    catPose = decision.pose
    catFacing = decision.facing
    catSettled = decision.pettable

    ticker.interval = decision.wakeIn > tickMs ? decision.wakeIn : tickMs
  }

  onBarHiddenChanged: {
    if (barHidden) ticker.running = false
    else nudge()
  }

  Component.onCompleted: {
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
      width: root.catSize
      height: root.catHeight
      devicePixels: width * (root.catScreen ? root.catScreen.devicePixelRatio : 1)
      assetDir: root.assetDir

      pose: root.catPose
      mirror: root.catFacing < 0
      animTick: root.animTick
      fillColor: Color.bar.text
      inkColor: Color.bar.background

      // Along the bar the cat sits where the brain put it; across the bar it
      // stays centred in the strip.
      readonly property real crossPos:
        window.stripCentre - (root.vertical ? width : height) / 2

      x: root.vertical ? Math.round(crossPos) : Math.round(root.catPos)
      y: root.vertical ? Math.round(root.catPos) : Math.round(crossPos)

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
          root.clickedAt = Date.now()
          root.nudge()
        }
      }
    }
  }
}
