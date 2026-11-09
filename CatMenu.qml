// The cat's right-click menu.
//
// A full-screen transparent layer with a small card near the cat. Full-screen
// is what makes click-anywhere-to-dismiss work: the surface has to receive the
// click that closes it, and a card-sized window would only ever hear clicks
// that land on the card.
//
// The window carries an input region only while it is open, so a closed menu is
// indistinguishable from not being here at all. It never takes keyboard focus —
// stealing focus from whatever you were typing in would be a poor trade for a
// cat menu.

import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Commons

PanelWindow {
  id: menu

  // Where the cat is (for placement), and the rows to show (Menu.items).
  property var cat: null
  property var rows: []
  property bool open: false
  // Where along the bar the cat is, so the card appears near it.
  property real anchorPos: 0

  signal picked(string id)

  Translations {
    id: strings
    directory: Qt.resolvedUrl("i18n")
  }

  visible: open && cat !== null
  screen: cat ? cat.catScreen : null
  color: "transparent"

  exclusionMode: ExclusionMode.Ignore
  WlrLayershell.namespace: "valkiria-menu"
  WlrLayershell.layer: WlrLayer.Overlay
  WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

  anchors { top: true; bottom: true; left: true; right: true }

  // Only claim input while actually open.
  mask: Region {
    width: menu.open ? menu.width : 0
    height: menu.open ? menu.height : 0
  }

  MouseArea {
    anchors.fill: parent
    acceptedButtons: Qt.LeftButton | Qt.RightButton
    onClicked: menu.open = false
  }

  Rectangle {
    id: card

    readonly property int pad: Style.space(10)
    readonly property bool vertical: menu.cat ? menu.cat.vertical : false
    readonly property int barSize: menu.cat ? menu.cat.barSize : 26

    color: Color.popups.background
    border.color: Color.popups.border
    border.width: 1
    radius: Style.cornerRadius
    // Fades in; with animations off (Style.duration is 0) it just appears.
    opacity: menu.open ? 1 : 0
    Behavior on opacity {
      NumberAnimation { duration: Style.duration(120); easing.type: Easing.OutCubic }
    }
    implicitWidth: column.implicitWidth + pad * 2
    implicitHeight: column.implicitHeight + pad * 2
    width: implicitWidth
    height: implicitHeight

    // Sit just clear of the bar, beside the cat, without running off screen.
    x: vertical
      ? Math.min(menu.width - width - Style.space(8),
          menu.cat && menu.cat.barPosition === "left" ? barSize + Style.space(6)
            : menu.width - width - barSize - Style.space(6))
      : Math.max(Style.space(8),
          Math.min(menu.width - width - Style.space(8), menu.anchorPos - width / 2))
    y: vertical
      ? Math.max(Style.space(8), Math.min(menu.height - height - Style.space(8), menu.anchorPos))
      : (menu.cat && menu.cat.barPosition === "bottom"
          ? menu.height - height - barSize - Style.space(6)
          : barSize + Style.space(6))

    Column {
      id: column
      x: card.pad
      y: card.pad
      spacing: Style.space(2)

      Text {
        text: strings.t("menu.title", "Valkiria")
        textFormat: Text.PlainText
        color: Color.popups.text
        opacity: 0.55
        font.family: Style.fontFamily
        font.pixelSize: Style.font.size ? Style.font.size : 12
        bottomPadding: Style.space(4)
      }

      // One tappable row.
      component MenuRow: Rectangle {
        id: row
        property string label: ""
        property bool active: false
        // Only the on/off row wears a marker.
        property bool toggle: false

        implicitWidth: Math.max(rowText.implicitWidth + Style.space(20), Style.space(150))
        implicitHeight: rowText.implicitHeight + Style.space(9)
        radius: Style.cornerRadius
        color: rowHover.hovered
          ? Qt.rgba(Color.popups.text.r, Color.popups.text.g, Color.popups.text.b, 0.10)
          : "transparent"

        Text {
          id: rowText
          x: Style.space(8)
          anchors.verticalCenter: parent.verticalCenter
          text: (row.toggle ? (row.active ? "● " : "○ ") : "") + row.label
          textFormat: Text.PlainText
          color: Color.popups.text
          opacity: row.active ? 1.0 : 0.7
          font.family: Style.fontFamily
          font.pixelSize: Style.font.size ? Style.font.size : 12
        }

        HoverHandler { id: rowHover }
        TapHandler { onTapped: row.tapped() }
        signal tapped()
      }

      Repeater {
        model: menu.rows
        MenuRow {
          required property var modelData
          label: strings.t(modelData.labelKey)
          active: modelData.active === true
          toggle: modelData.id === "dnd"
          onTapped: { menu.picked(modelData.id); menu.open = false }
        }
      }
    }
  }
}
