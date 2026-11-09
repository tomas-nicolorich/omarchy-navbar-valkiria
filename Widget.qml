// The yard bar-widget (stub). It reserves a slot in the bar and reports where
// that slot is, in its screen's bar-window coordinates, through the Yard
// singleton. Full yard behaviour comes in later tickets.

import QtQuick
import Quickshell

Item {
  id: root

  // Injected by the bar (plugins/bar/Bar.qml injectProps).
  property var bar: null
  property string moduleName: ""
  property var settings: null
  property real fixedEdge: 0

  implicitWidth: 90
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
}
