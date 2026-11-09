// Valkiria — a character that walks along the Omarchy bar (fork of navbar-cat).
//
// The plugin is a `kind: "panel"` with `keepLoaded: true`, so the shell mounts
// it at startup (shell.qml:625) and it lives for the whole session. It draws a
// transparent strip over the bar on WlrLayer.Overlay — the same layer the bar's
// own drag ghost uses (Bar.qml:1167) — and is click-through everywhere except a
// small box around her while she is sitting still.
//
// All of her decision-making lives in Brain.js, which is pure and tested.
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
import "Config.js" as Config
import "Menu.js" as Menu

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

  // Settings live inline in shell.json: on this plugin's `plugins[]` entry, or
  // on its bar-layout entry when the yard widget is placed (the shell's
  // updateEntryInline saves to the layout entry in that case, so both are
  // read: Config.js). A third-party plugin gets a scoped `shell` with no
  // `shellConfig`, so the file is read directly and watched.
  property var shellJson: ({})
  // Saves not yet seen in the file, laid over it so a menu choice takes effect
  // at once. Dropped whenever the file is read, which is then the truth.
  property var overrides: ({})
  readonly property var config: {
    var merged = Config.pluginSettings(shellJson, root.pluginId)
    for (var key in overrides) merged[key] = overrides[key]
    return merged
  }

  FileView {
    path: Quickshell.env("HOME") + "/.config/omarchy/shell.json"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      try { root.shellJson = JSON.parse(text()) } catch (e) { root.shellJson = ({}) }
      root.overrides = ({})
      root.nudge()
    }
  }

  readonly property real speed: Number(config.speed) > 0 ? Number(config.speed) : 1.0
  readonly property bool pettable: config.pettable !== false
  readonly property var reactions: config.reactions && typeof config.reactions === "object"
    ? config.reactions : ({})
  // Do not disturb, and the Bedtime / Wake up override ("bed", "up" or unset):
  // both are saved by the menu.
  readonly property bool dnd: config.dnd === true
  readonly property string bedtime: config.bedtime ? String(config.bedtime) : ""
  // The brain's word on whether she is asleep, for the menu's Bedtime / Wake up.
  property bool sleeping: false
  // A one-off menu command (walkies, treat) for the brain.
  property var command: null
  // Her length along the bar, in logical px: the art is 40x25 art px drawn at
  // 32x20 logical px (1 art px = 0.8 logical px, 1:1 device px at scale 1.25).
  readonly property int dogSize: Number(config.size) > 0 ? Number(config.size) : 32
  readonly property int dogHeight: Math.round(dogSize * 25 / 40)

  // `config` is also the brain's config: sleep, walkies, meals, siesta,
  // yardWidth, tripsPerHour, greetAfter, idleBurrowAfter, siestaBurrowAfter,
  // lowBattery, reactions. Absent keys fall back to the brain's own defaults.

  // ------------------------------------------------------------ bar state

  readonly property var bar: shell ? shell.bar : null
  readonly property string barPosition: bar ? String(bar.position) : "top"
  readonly property bool vertical: barPosition === "left" || barPosition === "right"
  readonly property int barSize: bar && bar.barSize ? bar.barSize : 26
  readonly property bool barHidden: bar ? bar.barHidden === true : false

  // ------------------------------------------------------------- monitors

  // One Valkiria, on the output Hyprland has focused, so she follows you
  // between screens rather than multiplying. Not at once: Brain.followStep
  // waits for focus to settle, then walks her off one bar and onto the other,
  // and says which screen she is on (shownScreenName) meanwhile.
  readonly property string wantedScreenName: {
    var monitor = Hyprland.focusedMonitor
    return monitor ? String(monitor.name || "") : ""
  }
  readonly property var screenNames: {
    var names = []
    var screens = Quickshell.screens
    for (var i = 0; screens && i < screens.length; i++) names.push(String(screens[i].name))
    return names
  }
  property string shownScreenName: ""
  property var followState: null
  readonly property var dogScreen: {
    var screens = Quickshell.screens
    if (!screens || screens.length === 0) return null
    for (var i = 0; i < screens.length; i++) {
      if (String(screens[i].name) === root.shownScreenName) return screens[i]
    }
    return screens[0]
  }
  onWantedScreenNameChanged: nudge()

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

  // A theme switch repaints her mid-stride, which is a good excuse to have
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

  // A machine with no battery reports onBattery false forever, so only count
  // it as charging when there is actually a battery on the charger. This is a
  // state, used for the low-battery mood; the nap is a reaction to the plug
  // going in (chargerAt below).
  readonly property bool charging: {
    var device = UPower.displayDevice
    return !!(device && device.isPresent && !UPower.onBattery)
  }

  // When the charger was last plugged in (onBattery going true to false).
  property real chargerAt: -1
  Connections {
    target: UPower
    function onOnBatteryChanged() {
      var device = UPower.displayDevice
      if (UPower.onBattery || !device || !device.isPresent) return
      root.chargerAt = Date.now()
      root.nudge()
    }
  }

  // ---------------------------------------------------------- dog state

  // Her extent along the bar (the sprite is not rotated on a vertical bar).
  readonly property int alongSize: vertical ? dogHeight : dogSize

  readonly property real barLength: dogScreen
    ? (vertical ? dogScreen.height : dogScreen.width)
    : 0

  property real dogPos: 0
  property string dogPose: "sit"
  property int dogFacing: 1
  property bool dogSettled: false
  property int animTick: 0
  // Seeded from the clock so she does not live the same day twice (the brain's
  // generator is deterministic, which is what makes its tests reproducible).
  property var brainState: Brain.freshState(Date.now() % 2147483647)

  // Where the yard widget sits on the screen she is on (Yard.qml singleton).
  readonly property var yardRecord: dogScreen ? Yard.xs[String(dogScreen.name)] : undefined
  readonly property var yardForBrain: yardRecord ? { x: yardRecord.x, w: yardRecord.w } : null

  readonly property bool maskActive: dogSettled && root.pettable && !root.barHidden

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
  onDogScreenChanged: nudge()

  // ------------------------------------------------------------ the tick

  // 30fps: fast enough that a running dog does not visibly stutter, slow
  // enough to be free. The sprite's own frames advance far slower (below).
  readonly property int tickMs: 33

  function nudge() {
    // Something happened that she might care about — make sure the loop is
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
    interval: Brain.FRAME_MS
    repeat: true
    // With animations off (`omarchy toggle animations`) she holds one frame
    // per pose rather than cycling.
    running: ticker.running && root.motion
    onTriggered: root.animTick = (root.animTick + 1) & 0xff
  }

  property bool _placed: false

  // Motion follows the shell's animation switch: Style.duration(ms) is 0 with
  // animations off, in which case she moves between spots without the walk.
  readonly property bool motion: Style.duration(1000) > 0

  function step() {
    if (screenNames.length === 0) return

    // Which monitor she is on, and whether she is crossing between two.
    var follow = Brain.followStep(followState, {
      now: Date.now(), focused: wantedScreenName, screens: screenNames, dnd: dnd,
      x: dogPos, barLength: barLength, dogSize: alongSize,
    })
    followState = follow.mstate
    if (follow.screen !== null && follow.screen !== shownScreenName) shownScreenName = follow.screen
    // Property bindings (dogScreen, barLength) have caught up by now, so a
    // hand-over puts her at the entry edge of the new bar.
    if (follow.switched) dogPos = follow.transit.side < 0 ? -alongSize : barLength

    if (!dogScreen || barLength <= 0) return

    var now = Date.now()
    var date = new Date(now)
    var maxPos = Math.max(0, barLength - alongSize)
    // Off the end of a bar is only allowed on the way between two.
    var minPos = follow.transit ? -alongSize : 0
    var limitPos = follow.transit ? barLength : maxPos

    // She starts the session at home in the yard.
    if (!_placed) {
      _placed = true
      var span = Brain.yardSpan({ barLength: barLength, dogSize: alongSize,
        yard: yardForBrain, config: config })
      dogPos = span.lo
    }

    var decision = Brain.decide({
      now: now,
      axis: vertical ? "v" : "h",
      barLength: barLength,
      dogSize: alongSize,
      x: dogPos,
      yard: yardForBrain,
      minutes: date.getHours() * 60 + date.getMinutes(),
      day: date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate(),
      idleFor: idleMonitor.isIdle && awaySince > 0 ? now - awaySince : 0,
      music: musicPlaying,
      charging: charging,
      chargerAt: chargerAt >= 0 ? chargerAt : null,
      batteryPct: batteryPct,
      dnd: dnd,
      bedtime: bedtime,
      command: command,
      transit: follow.transit,
      greet: greet,
      notifyAt: notifyAt >= 0 ? notifyAt : null,
      themeChangedAt: themeChangedAt >= 0 ? themeChangedAt : null,
      workspaceEvent: workspaceEvent,
      clickedAt: clickedAt >= 0 ? clickedAt : null,
      config: config,
    }, brainState)

    brainState = decision.state

    // Move toward the target at whatever pace the brain asked for. Positions
    // are rounded to whole logical pixels: pixel art on fractional offsets
    // shimmers as it moves.
    var pixelsPerSecond = decision.gait === "run" ? Brain.RUN_PX_S
      : (decision.gait === "walk" ? Brain.WALK_PX_S : 0)
    if (pixelsPerSecond > 0) {
      var stepSize = pixelsPerSecond * decision.speedScale * speed * (tickMs / 1000)
      var delta = decision.target - dogPos
      dogPos = (Math.abs(delta) <= stepSize || !motion)
        ? decision.target
        : dogPos + (delta > 0 ? stepSize : -stepSize)
    }
    dogPos = Math.max(minPos, Math.min(limitPos, dogPos))

    dogPose = decision.pose
    dogFacing = decision.facing
    dogSettled = decision.pettable
    sleeping = decision.sleeping
    if (decision.clearBedtime && bedtime === "up") setSettings({ bedtime: null })
    Yard.dog(String(dogScreen.name), decision.pose)

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
  // updateEntryInline replaces the entry's settings, so send it that entry's
  // own keys plus the change (Config.settingsToSave), never the merged config.
  // A key patched to null is deleted from the file.
  function setSettings(patch) {
    var pending = JSON.parse(JSON.stringify(root.overrides))
    for (var key in patch) pending[key] = patch[key]
    // Show it now; the file watcher replaces this with what was really saved.
    root.overrides = pending
    nudge()
    if (!shell || typeof shell.updateEntryInline !== "function") return
    shell.updateEntryInline(root.pluginId, Config.settingsToSave(root.shellJson, root.pluginId, pending))
  }

  DogMenu {
    id: dogMenu
    dog: root
    rows: Menu.items({ sleeping: root.sleeping, dnd: root.dnd })
    onPicked: function (id) {
      var result = Menu.apply(id, root.config, Date.now())
      if (result.patch) root.setSettings(result.patch)
      if (result.command) {
        root.command = result.command
        root.nudge()
      }
    }
  }


  // ---------------------------------------------------------- the window

  PanelWindow {
    id: window

    screen: root.dogScreen
    visible: root.dogScreen !== null && !root.barHidden
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

    // Click-through everywhere she is not. While she is walking the region
    // is empty, so a moving dog can never swallow a click meant for the bar;
    // she only becomes clickable once she has settled somewhere.
    mask: Region {
      x: root.maskActive ? Math.round(sprite.x) : 0
      y: root.maskActive ? Math.round(sprite.y) : 0
      width: root.maskActive ? sprite.width : 0
      height: root.maskActive ? sprite.height : 0
    }

    DogSprite {
      id: sprite

      // The art cell is 40x25, so the sprite is 1.6 times as wide as it is tall.
      width: root.dogSize
      height: root.dogHeight
      devicePixels: width * (root.dogScreen ? root.dogScreen.devicePixelRatio : 1)
      assetDir: root.assetDir

      pose: root.dogPose
      mirror: root.dogFacing < 0
      animTick: root.animTick
      fillColor: Color.bar.text
      inkColor: Color.bar.background
      accentColor: Color.accent

      // Along the bar she sits where the brain put her; across the bar she
      // stays centred in the strip.
      readonly property real crossPos:
        window.stripCentre - (root.vertical ? width : height) / 2

      x: root.vertical ? Math.round(crossPos) : Math.round(root.dogPos)
      y: root.vertical ? Math.round(root.dogPos) : Math.round(crossPos)

      MouseArea {
        anchors.fill: parent
        enabled: root.maskActive
        acceptedButtons: Qt.LeftButton | Qt.RightButton
        onClicked: function (mouse) {
          if (mouse.button === Qt.RightButton) {
            dogMenu.anchorPos = root.vertical
              ? sprite.y + sprite.height / 2
              : sprite.x + sprite.width / 2
            dogMenu.open = true
            return
          }
          root.clickedAt = Date.now()
          root.nudge()
        }
      }
    }
  }
}
