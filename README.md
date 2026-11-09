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

The art is drawn as ASCII pixel grids in `art/grids/`, one file per frame.
Everything else is generated from them, so edit the grids, not the SVGs or
PNGs.

### Editing a frame

1. Edit `art/grids/<pose>-<n>.txt`.
2. Optionally check it with an enlarged, coloured preview:
   `tools/grid-to-svg.py --preview /tmp/check.png walk-1`
3. Convert grids to SVG (all, or only the ones named):
   `tools/grid-to-svg.py` or `tools/grid-to-svg.py walk-1`
4. Rebuild the sprite sheets and `Frames.js`:
   `tools/build-sprites.py` (needs `rsvg-convert` and ImageMagick)
5. Reload: `omarchy restart shell`

### Grid format

- 25 rows of 40 characters; lines starting with `;` are comments.
- `.` empty, `#` fill (body), `o` ink (dark detail), `a` accent.
- Colour comes from the bar's theme, not the grid: each layer is tinted
  separately. `o` and `a` pixels also count as fill, so the silhouette stays
  whole.
- She faces right (the sprite mirrors itself for left). Her feet sit on row 22
  so poses don't jump.

### Frames

- Files are named `<pose>-<n>.txt`, numbered 1..n with no gaps
  (`walk-1` ... `walk-4`), plus `yard-blanket.txt`. Add a frame by adding the
  next number; the build picks it up. The poses and their frame counts are in
  `docs/specs/2026-11-09-valkiria-design.md`.
- The red harness is drawn in ink. Morning walkies use `walk-harness-1` ...
  `walk-harness-4`: copies of `walk-<n>` with the harness straps added as `o`.

The build writes `art/*.svg`, `assets/valkiria-{1x,2x}-{fill,ink,accent}.png`
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
