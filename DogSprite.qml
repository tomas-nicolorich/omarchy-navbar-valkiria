// Draws one frame of Valkiria, themed.
//
// Each frame is drawn as three layers (see "Drawing Valkiria" in the README):
// `fill` is the whole silhouette, and `ink` and `accent` are painted on top of
// it. They are kept as separate alpha-only sheets and tinted separately, so
// she takes the bar's own colours and follows a theme switch without any
// asset rebuild.
//
// The fill sheet holds the *whole* silhouette rather than being cut into
// disjoint regions, because disjoint regions show hairline seams wherever the
// compositor scales the sprite by a fractional factor, which is the normal
// case on a scaled output.

import QtQuick
import QtQuick.Effects
import "Frames.js" as Frames

Item {
  id: root

  property string pose: "sit"
  property int animTick: 0
  // The art faces right; true flips her to face left.
  property bool mirror: false
  property color fillColor: "white"
  property color inkColor: "black"
  // The owner binds this to a theme colour; the default is only a fallback.
  property color accentColor: "#c08040"
  property string assetDir: ""
  // Device pixels this sprite actually occupies, which decides which sheet is
  // the better source.
  property real devicePixels: width

  implicitWidth: Frames.CELL_W
  implicitHeight: Frames.CELL_H

  // The 1x sheet is drawn one art pixel per device pixel; it beats letting
  // the GPU shrink the 2x art, but only while it is not itself being
  // stretched. Past that the 2x sheet has the detail to spare.
  readonly property int scale: devicePixels <= Frames.CELL_W ? 1 : 2
  // Scaling by exactly 1:1 wants nearest-neighbour so the pixels stay hard;
  // anything else wants filtering, because fractional nearest-neighbour drops
  // and doubles rows at random.
  // Compared against device pixels, not logical width: at scale 1.25 a 32px
  // sprite is 40 device pixels, exactly the 1x art.
  readonly property bool crisp: Math.abs(Frames.CELL_W * scale - devicePixels) < 0.01

  readonly property var pattern: Frames.POSES[pose] !== undefined
    ? Frames.POSES[pose]
    : Frames.POSES["sit"]
  readonly property int frame: pattern[animTick % pattern.length]

  transform: Scale {
    origin.x: root.width / 2
    xScale: root.mirror ? -1 : 1
  }

  // Tinting goes through `layer.effect` rather than MultiEffect's `source`
  // property. The source form needs a visible source item, so hiding the
  // untinted sheet to stop it drawing over the tinted one leaves the effect
  // with nothing to render. Layering the item and replacing its own rendering
  // avoids the problem entirely.
  component SheetLayer: Item {
    id: sheetLayer

    property string sheet
    property color tint

    anchors.fill: parent
    // The layer renders into an item-sized texture, which crops the sheet to
    // the current frame without a separate clip pass.
    layer.enabled: true
    layer.smooth: !root.crisp
    layer.effect: MultiEffect {
      colorization: 1.0
      colorizationColor: sheetLayer.tint
    }

    Image {
      // The whole sheet is laid out at the target cell size and slid sideways,
      // so changing frame is a translation rather than a texture reload.
      //
      // Empty until the plugin knows where it lives on disk; asking for
      // "/valkiria-1x-fill.png" resolves against the filesystem root and warns.
      source: root.assetDir === ""
        ? ""
        : root.assetDir + "/valkiria-" + root.scale + "x-" + sheetLayer.sheet + ".png"
      width: root.width * Frames.COUNT
      height: root.height
      x: -root.frame * root.width
      smooth: !root.crisp
      mipmap: false
      cache: true
      fillMode: Image.Stretch
    }
  }

  SheetLayer { sheet: "fill"; tint: root.fillColor }
  SheetLayer { sheet: "ink"; tint: root.inkColor }
  SheetLayer { sheet: "accent"; tint: root.accentColor }
}
