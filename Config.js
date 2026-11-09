// Reading Valkiria's settings out of shell.json.
//
// Where the shell keeps them depends on how the plugin is placed. Panels and
// services keep inline settings on their entry in `plugins[]`; bar widgets keep
// theirs on their `bar.layout.<section>[]` entry. Valkiria is both, and the
// shell's updateEntryInline writes to the layout entry whenever there is one
// (shell.qml:1118-1130) and leaves plugins[] alone, so a setting saved from the
// menu would never be found if only plugins[] were read. Read both; the layout
// entry, being where saves land, wins.

// Copy the keys of every object in `entries` whose id is `id` into `out`.
// Returns true if one matched.
function copyMatching(entries, id, out) {
  var found = false
  if (!Array.isArray(entries)) return found
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i]
    if (entry && typeof entry === "object" && String(entry.id || "") === id) {
      for (var k in entry) out[k] = entry[k]
      found = true
    }
  }
  return found
}

// Copy the keys of the layout entry for `id`, from whichever section holds it.
function copyLayoutEntry(shellJson, id, out) {
  var found = false
  var layout = shellJson.bar && typeof shellJson.bar === "object" ? shellJson.bar.layout : null
  if (layout && typeof layout === "object") {
    for (var section in layout) {
      if (copyMatching(layout[section], id, out)) found = true
    }
  }
  return found
}

function pluginSettings(shellJson, id) {
  var out = {}
  if (!shellJson || typeof shellJson !== "object") return out
  copyMatching(shellJson.plugins, id, out)
  copyLayoutEntry(shellJson, id, out)
  return out
}

// What to hand updateEntryInline to save `patch`: the keys of the one entry the
// shell will overwrite (the layout entry if there is one, else the plugins[]
// entry) plus the change, with keys patched to null deleted. The merged config
// from pluginSettings() must not be used for this: it mixes both entries, and
// would copy plugins[] keys into the layout entry.
function settingsToSave(shellJson, id, patch) {
  var out = {}
  if (shellJson && typeof shellJson === "object") {
    if (!copyLayoutEntry(shellJson, id, out)) {
      out = {}
      copyMatching(shellJson.plugins, id, out)
    }
  }
  for (var key in patch) {
    if (patch[key] === null || patch[key] === undefined) delete out[key]
    else out[key] = patch[key]
  }
  delete out.id
  return out
}
