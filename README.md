# Valkiria

An [Omarchy](https://omarchy.org) shell plugin: a valkyrie that roams the bar
and its yard. Early work in progress.

Two parts, one plugin (`tomas.valkiria`):

- an overlay panel (`Cat.qml`) that draws the character over the bar and
  decides what it does (`Brain.js`, pure and tested);
- a bar widget (`Widget.qml`), the yard, which reserves a slot in the bar and
  tells the overlay where it is through a plugin-local singleton (`Yard.qml`).

Place the yard with `omarchy bar move tomas.valkiria --section centerEnd`.

Sprites are not drawn yet; placeholder art comes with the sprite pipeline.

## Tests

```
node --test test/
```

## Credit

Valkiria is a fork of [navbar-cat](https://github.com/tallsam/navbar-cat) by
tallsam (MIT). The behaviour core and the overlay structure come from it; the
pounce, cursor chasing, character picker and oneko artwork have been removed.
See `LICENSE`.
