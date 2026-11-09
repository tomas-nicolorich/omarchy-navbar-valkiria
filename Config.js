// Reading Valkiria's settings out of shell.json.
//
// Where the shell keeps them depends on how the plugin is placed. Panels and
// services keep inline settings on their entry in `plugins[]`; bar widgets keep
// theirs on their `bar.layout.<section>[]` entry. Valkiria is both, and the
// shell's updateEntryInline writes to the layout entry whenever there is one
// (shell.qml:1118-1130) and leaves plugins[] alone, so a setting saved from the
// menu would never be found if only plugins[] were read. Read both; the layout
// entry, being where saves land, wins.

function pluginSettings(shellJson, id) {
  var out = {}
  if (!shellJson || typeof shellJson !== "object") return out

  var plugins = shellJson.plugins
  if (Array.isArray(plugins)) {
    for (var i = 0; i < plugins.length; i++) {
      if (plugins[i] && typeof plugins[i] === "object" && String(plugins[i].id || "") === id) {
        for (var k in plugins[i]) out[k] = plugins[i][k]
      }
    }
  }

  var layout = shellJson.bar && typeof shellJson.bar === "object" ? shellJson.bar.layout : null
  if (layout && typeof layout === "object") {
    for (var section in layout) {
      var entries = layout[section]
      if (!Array.isArray(entries)) continue
      for (var j = 0; j < entries.length; j++) {
        var entry = entries[j]
        if (entry && typeof entry === "object" && String(entry.id || "") === id) {
          for (var key in entry) out[key] = entry[key]
        }
      }
    }
  }
  return out
}
