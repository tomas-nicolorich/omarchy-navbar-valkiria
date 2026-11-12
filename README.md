# Valkiria

An [Omarchy](https://omarchy.org) shell plugin: a black-and-tan miniature
dachshund that roams the bar and its yard. Early work in progress.

Two parts, one plugin (`tomas.valkiria`):

- an overlay panel (`Valkiria.qml`) that draws the character over the bar and
  decides what it does (`Brain.js`, pure and tested);
- a bar widget (`Widget.qml`), the yard, which reserves a slot in the bar and
  tells the overlay where it is through a plugin-local singleton (`Yard.qml`).

Place the yard with `omarchy bar move tomas.valkiria --section centerEnd`.

## Drawing Valkiria

She is drawn in parts (head, body, legs, tails, blanket...) in `art/parts/`,
and `art/frames.json` says which parts each frame is made of and where they
go. Everything else is generated from those two, so edit the parts, not the
grids, SVGs or PNGs.

### The sprite editor

```
tools/sprite-editor.py
```

It opens a page in the browser with the frame drawn in square pixels. Pick a
frame on the left and a part on the right, then draw. A part shared by
several frames changes in all of them at once; "Make unique" gives one frame
its own copy. Parts can be moved, reordered, added and removed per frame.

"Save & build" writes the parts and `frames.json`, then runs the three build
steps below (needs `rsvg-convert` and ImageMagick). After that, reload with
`omarchy restart shell`.

### Building by hand

1. Edit `art/parts/<part>.txt` or `art/frames.json`.
2. Compose the parts into frame grids: `tools/compose-frames.py`
3. Convert grids to SVG: `tools/grid-to-svg.py`
   (`--preview /tmp/check.png walk-1` also writes an enlarged preview)
4. Rebuild the sprite sheets and `Frames.js`: `tools/build-sprites.py`
5. Reload: `omarchy restart shell`

### Part format

- A rectangle of the grid characters below, plus `.` transparent, `_` erase
  what is underneath, and `B` blanket gingham (coloured by where it lands).
- In `frames.json` a frame is a list of parts, stamped in order, each with
  the `x`, `y` of its top-left corner. `"far": true` draws a far-side limb
  (fill and accent become shade); `"skip": n` leaves out its top `n` rows.

### Grid format

The grids in `art/grids/` are the composed frames, one file each.


- 25 rows of 40 characters; lines starting with `;` are comments.
- `.` empty, `#` fill (body), `+` shade, `o` ink, `a` accent.
- Colour comes from the bar's theme, not the grid: each layer is tinted
  separately. `+`, `o` and `a` pixels also count as fill, so the silhouette
  stays whole.
- Ink is the bar's background colour, so an `o` pixel looks like a hole cut in
  her. Use it for thin lines (collar, harness, eye), not for filled areas.
- Shade is the fill dimmed halfway to the bar. Her ear and the legs on her far
  side are drawn in it.
- She faces right (the sprite mirrors itself for left). Her feet sit on row 22
  so poses don't jump.

### Frames

- Frames are named `<pose>-<n>`, numbered 1..n with no gaps
  (`walk-1` ... `walk-4`), plus `yard-blanket`. Add a frame by adding the
  next number to `frames.json`; the build picks it up. The poses and their
  frame counts are in `docs/specs/2026-11-09-valkiria-design.md`.
- The red harness is drawn in ink. Morning walkies use `walk-harness-1` ...
  `walk-harness-4`: the `walk-<n>` parts plus the `harness` part.

The build writes `art/*.svg`, `assets/valkiria-{1x,2x}-{fill,shade,ink,accent}.png`
and `Frames.js` (pose to frame indices). All are committed.

## Tests

```
node --test test/
```

## Credit

Valkiria is a fork of [navbar-cat](https://github.com/tallsam/navbar-cat) by
tallsam (MIT). The behaviour core and the overlay structure come from it; the
pounce, cursor chasing, character picker and oneko artwork have been removed.
See `LICENSE`.
