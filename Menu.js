// The right-click menu, as data: which rows it shows and what choosing each does.
// DogMenu.qml draws it; Valkiria.qml acts on the result. No strings live here,
// only keys into i18n/en.json.

// `sleeping` is the brain's report that she is asleep (or going to bed) by
// bedtime or the clock; `dnd` is the saved do-not-disturb setting. Only the
// do-not-disturb row is a toggle, so only it carries `toggle` and `active`.
function items(view) {
  return [
    { id: "walkies", labelKey: "menu.walkies" },
    view.sleeping
      ? { id: "wake", labelKey: "menu.wake" }
      : { id: "bedtime", labelKey: "menu.bedtime" },
    { id: "treat", labelKey: "menu.treat" },
    { id: "dnd", labelKey: "menu.dnd", toggle: true, active: view.dnd === true },
  ]
}

// What choosing a row does. `patch` is saved into her settings; `command` is a
// one-off event for the brain (stamped with `now` so it is only seen once).
// Settings are `{dnd, bedtime, ...}` as currently saved.
function apply(id, settings, now) {
  if (id === "walkies" || id === "treat") return { command: { at: now, kind: id } }
  if (id === "bedtime") return { patch: { bedtime: "bed" } }
  if (id === "wake") return { patch: { bedtime: "up" } }
  if (id === "dnd") return { patch: { dnd: !(settings && settings.dnd === true) } }
  return {}
}
