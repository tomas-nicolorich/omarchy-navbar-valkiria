// The yard bar-widget. It reserves a slot in the bar, reports where that slot
// is (in its screen's bar-window coordinates) through the Yard singleton so
// Valkiria knows where she may settle, and draws the folded blanket at the
// slot's right end, where she lies down. Every yard shows its blanket; she
// only hides it on the screen she is on, while she is under it.

import QtQuick
import Quickshell
import qs.Commons

Item {
  id: root

  // Injected by the bar (plugins/bar/Bar.qml injectProps).
  property var bar: null
  property string moduleName: ""
  property var settings: null
  property real fixedEdge: 0

  // About three Valkiria-lengths (32 logical px each) unless configured.
  readonly property real yardWidth:
    settings && Number(settings.yardWidth) > 0 ? Number(settings.yardWidth) : 96
  implicitWidth: yardWidth
  implicitHeight: 28

  property string _screenName: ""

  function publish() {
    var win = root.QsWindow.window
    if (!win || !win.screen) return
    _screenName = win.screen.name
    var p = root.mapToItem(null, 0, 0)
    Yard.report(_screenName, p.x, root.width)
  }

  onXChanged: publish()
  onWidthChanged: publish()
  Component.onCompleted: Qt.callLater(publish)
  Component.onDestruction: if (_screenName !== "") Yard.clear(_screenName)

  // A neighbour resizing moves this slot without changing the item's own x, so
  // no signal fires; poll. `report` ignores unchanged values.
  Timer {
    interval: 500
    running: true
    repeat: true
    onTriggered: root.publish()
  }

  // She is under the blanket (or getting under it) in this yard.
  readonly property bool occupied: Yard.catScreen === root._screenName
    && (Yard.catPose === "burrow" || Yard.catPose === "blanket")

  DogSprite {
    id: blanket
    visible: !root.occupied
    width: 32
    height: 20
    devicePixels: width * (root.QsWindow.window && root.QsWindow.window.screen
      ? root.QsWindow.window.screen.devicePixelRatio : 1)
    assetDir: Qt.resolvedUrl("assets").toString().replace(/\/$/, "")
    pose: "yard-blanket"
    fillColor: Color.bar.text
    inkColor: Color.bar.background
    // The blanket sits at the right end of the slot, as the brain expects.
    x: root.width - width
    y: Math.round((root.height - height) / 2)
  }
}
