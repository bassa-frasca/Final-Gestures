# Star glyphs

Seven glyph ids referenced by `glyph` on every star in `zodiac-constellations.json`.

- `svg/g1.svg` … `g7.svg` — square `viewBox="-200 -200 400 400"`, artwork centred on (0,0), paths only, transparent, single colour via `currentColor` (set `color` on the SVG or a parent, or `fill`/`stroke` after stripping).
- `png-512-white/g1.png` … — 512×512, transparent, white artwork, same centring.

## Scale

All glyphs share the canvas. `g4` is drawn to outer radius 180; the other six to 100 — matching `glyphOuterRadius` in the JSON. Do not normalise them to fill the canvas; the size difference is intentional (g4 marks the brightest star in each figure).

To place a glyph so its outer radius equals R pixels on screen, draw the canvas at `400 * R / glyphOuterRadius[id]` pixels square, centred on the star's projected position.

## Glyphs

- `g1` (r 100) — six-point folk star in dotted annulus
- `g2` (r 100) — double-outline twelve-point star
- `g3` (r 100) — twelve-point star in ringed dot circle
- `g4` (r 180) — eight-point burst with radiating sparkle rays (largest, outer radius 180)
- `g5` (r 100) — needle sparkle, fine radiating rays
- `g6` (r 100) — twelve-point solid star
- `g7` (r 100) — four-point curved sparkle

Assignment is by brightness rank within a constellation: rank 0 (brightest) → `g4`, then `g5`, `g3`, `g1`, `g2`, `g7`, `g6`, wrapping for figures with more than seven stars.

Strokes are real path strokes in user units (no `vector-effect`), so they scale with the glyph.
