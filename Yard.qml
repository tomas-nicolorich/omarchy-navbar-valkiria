pragma Singleton

// The channel between the yard bar-widget and the overlay panel. Both entry
// points of this plugin load in one QML engine, so this plugin-local singleton
// is one shared instance. Needs the `qmldir` next to it to be registered.

import QtQuick

QtObject {
  // screenName -> { x, w }: where the yard widget sits in that screen's bar
  // window (logical px). A missing key means "no yard on that screen".
  property var xs: ({})

  // A copy of `xs` without the entry for `skip`. `xs` is reassigned rather
  // than mutated, so bindings fire.
  function _copyXs(skip) {
    var next = ({})
    for (var k in xs) if (k !== skip) next[k] = xs[k]
    return next
  }

  // Writes only when something actually changed, so a polling caller costs
  // nothing.
  function report(name, x, w) {
    var cur = xs[name]
    if (cur && cur.x === x && cur.w === w) return
    var next = _copyXs(name)
    next[name] = { x: x, w: w }
    xs = next
  }

  // Where she is and what she is doing, so each yard can show its folded
  // blanket unless she is under it.
  property string dogScreen: ""
  property string dogPose: ""
  function dog(screenName, pose) {
    if (dogScreen !== screenName) dogScreen = screenName
    if (dogPose !== pose) dogPose = pose
  }

  function clear(name) {
    if (xs[name] === undefined) return
    xs = _copyXs(name)
  }
}
