pragma Singleton

// The channel between the yard bar-widget and the overlay panel. Both entry
// points of this plugin load in one QML engine, so this plugin-local singleton
// is one shared instance (docs/tickets/001-yard-position-spike.md). Needs the
// `qmldir` next to it to be registered.

import QtQuick

QtObject {
  // screenName -> { x, w }: where the yard widget sits in that screen's bar
  // window (logical px). A missing key means "no yard on that screen".
  property var xs: ({})

  // Reassigns `xs` rather than mutating it, so bindings fire. Writes only when
  // something actually changed, so a polling caller costs nothing.
  function report(name, x, w) {
    var cur = xs[name]
    if (cur && cur.x === x && cur.w === w) return
    var next = ({})
    for (var k in xs) next[k] = xs[k]
    next[name] = { x: x, w: w }
    xs = next
  }

  function clear(name) {
    if (xs[name] === undefined) return
    var next = ({})
    for (var k in xs) if (k !== name) next[k] = xs[k]
    xs = next
  }
}
