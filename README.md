# Valkiria

An [Omarchy](https://omarchy.org) shell plugin: a valkyrie that roams the bar
and its yard. Early work in progress.

Two parts, one plugin (`tomas.valkiria`):

- an overlay panel (`Valkiria.qml`) that draws the character over the bar and
  decides what it does (`Brain.js`, pure and tested);
- a bar widget (`Widget.qml`), the yard, which reserves a slot in the bar and
  tells the overlay where it is through a plugin-local singleton (`Yard.qml`).

Place the yard with `omarchy bar move tomas.valkiria --section centerEnd`.

## Drawing Valkiria

The art in `art/` is placeholder: blocky dachshund silhouettes, correctly
sized. Replace any file with a real drawing and rebuild:

```
tools/build-sprites.py     # needs rsvg-convert and ImageMagick
omarchy restart shell
```

The contract for a frame:

- One file per frame, `art/<pose>-<n>.svg`, numbered from 1 (`walk-1.svg` ...
  `walk-4.svg`), plus `art/yard-blanket.svg`. The poses and their frame counts
  are in `docs/specs/2026-11-09-valkiria-design.md`.
- `viewBox="0 0 40 25"`, one unit per art pixel, everything snapped to whole
  units (use `shape-rendering="crispEdges"`).
- Three top-level groups with ids `fill`, `ink` and `accent`. Colour inside
  them doesn't matter, only alpha does: the plugin tints each layer from the
  bar's colours. `fill` covers the whole silhouette; `ink` and `accent` are
  painted on top of it, so don't cut holes in `fill` for them.
- She faces right (the sprite mirrors itself for left). Her feet sit on row 22
  (the bottom edge of the feet at y=23) so poses don't jump.

The build writes `assets/valkiria-{1x,2x}-{fill,ink,accent}.png` and
regenerates `Frames.js` (pose to frame indices). Both are committed.

## Tests

```
node --test test/
```

## Credit

Valkiria is a fork of [navbar-cat](https://github.com/tallsam/navbar-cat) by
tallsam (MIT). The behaviour core and the overlay structure come from it; the
pounce, cursor chasing, character picker and oneko artwork have been removed.
See `LICENSE`.
