# Tales from the Stars

A live, naked-eye view of the night sky, built for an educational project that pairs
each constellation with its mythology and history.

You are standing outside, facing a compass direction. The horizon runs along the
bottom, stars sit above it, and the Milky Way runs where it really runs. Click any
constellation — in the sky or in the list — and the view turns to face it and tells
you its story.

Default location is **Bergamo, Italy** (45.695° N, 9.670° E, Europe/Rome), but the
place can be changed to anywhere on Earth.

![the twelve of the zodiac and the five that never set](docs/screenshot.png)

## Running it

No build step and no dependencies to install.

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Opening `index.html` directly from disk works too —
the star catalogue is loaded as a plain script (`data/catalog.js`) precisely so that
`file://` works, where browsers block `fetch()` of local JSON.

The only network request is the CDN copy of
[astronomy-engine](https://github.com/cosinekitty/astronomy), used for the Sun and
Moon. If it is unavailable the page falls back to compact built-in series and stays
fully usable — Sun altitude then agrees to within 0.005°, the Moon to about 1°, and
the reported Moon phase is unchanged.

## What you can do

| | |
|---|---|
| **Look around** | Drag the sky, use `←` `→` `↑` `↓`, or the N/E/S/W buttons |
| **Zoom** | Scroll wheel (45°–150° field of view) |
| **Scrub time** | *Time of night* and *time of year* sliders |
| **Watch it move** | `Play` — up to a week a second, to see the seasonal handoff |
| **Back to now** | `Now`, or press `N` |
| **Read a story** | Click a constellation, star, or list row; `Esc` closes |
| **Your sky** | City centre → dark countryside, which changes how many stars show |
| **Move location** | Anywhere on Earth, under *Where you are* |

The view can also be set from the URL, which is how it is tested:

```
?t=2026-09-10T22:30      wall clock in the active zone (append Z for UTC)
?lat=45.695&lon=9.670    observer position
?tz=Europe/Rome          IANA time zone
?facing=180              compass direction to look towards
```

## What it draws

**The twelve of the zodiac**, in **gold** — Aries, Taurus, Gemini, Cancer, Leo,
Virgo, Libra, Scorpius, Sagittarius, Capricornus, Aquarius, Pisces. Always listed in
the order the Sun travels through them, whether or not they happen to be up, because
the zodiac is the point of the project.

**The five that never set** from this latitude, in **grey-blue** — Ursa Major, Ursa
Minor, Cassiopeia, Cepheus, Draco. Above the horizon every night of the year.

**And the rest of the sky.** Every star down to magnitude 5.2 is drawn, all 2,072 of
them across all 88 constellations, so the 17 told constellations sit in a real sky
rather than floating in a void. Hover any star for its name; only the 17 have
stories behind them.

## The astronomy

Star positions are catalogued for epoch J2000 and drawn for the moment you are
looking at:

1. **Precession** from J2000 to the equinox of date (Lieske 1977 angles).
2. **Local sidereal time** from the Julian date and your longitude.
3. **Altitude and azimuth** from the hour angle `H = LST − RA`:
   `sin(alt) = sin δ sin φ + cos δ cos φ cos H`.
4. **Atmospheric refraction** (Bennett 1982), which lifts objects near the horizon
   by about half a degree — exactly where "is it up yet?" gets decided.

Cross-checked against astronomy-engine's independent implementation: above the
horizon the altitudes agree to **0.002°** and the azimuths to **0.006°**. The
precession routine matches its rotation matrix to within 12 arcseconds, the
difference being nutation, which this project does not model — about 1/70th of a
pixel on screen.

Nothing in the interface is expressed in degrees. Positions are rendered as
"high in the south-east" or "just clearing the horizon in the north-west", because
that is how you would say it to someone standing next to you.

### Projection

Stereographic, centred on wherever you are looking: angular distance `θ` from the
centre of view maps to a radius of `2·tan(θ/2)`. A plain perspective projection
stretches the corners badly at a 110° field of view, whereas this keeps
constellation shapes recognisable right out to the edge.

## Data sources

All open data. Nothing is scraped, and nothing is fetched live in the browser.

| What | Source | License |
|---|---|---|
| Star positions and magnitudes | [HYG Database v4.1](https://github.com/astronexus/HYG-Database) (`hygdata_v41.csv`) — merges Hipparcos, Yale Bright Star and Gliese | Public domain / CC0 |
| Constellation line figures | [Stellarium](https://github.com/Stellarium/stellarium) `skycultures/modern_iau/index.json`, keyed by HIP number | GPL-2.0-or-later |
| Sun and Moon | [astronomy-engine](https://github.com/cosinekitty/astronomy) | MIT |
| Mythology and history text | Written for this project | See LICENSE |

`data/stars.json` holds 2,072 stars: every star brighter than magnitude 5.2 anywhere
in the sky, plus every star used as a vertex in one of the 17 figures however faint.
Spot-checked against published J2000 positions — the reference stars agree to under
an arcsecond in declination and under two seconds in right ascension.

### Rebuilding the data

`data/*.json` and `data/catalog.js` are generated. To regenerate them, fetch the two
upstream files and run the build script:

```bash
curl -L -o /tmp/hyg.csv https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv
curl -L -o /tmp/iau.json https://raw.githubusercontent.com/Stellarium/stellarium/master/skycultures/modern_iau/index.json

python3 tools/build_data.py --hyg /tmp/hyg.csv --iau /tmp/iau.json \
        --myths tools/mythology.json --out data
```

The 34 MB HYG catalogue is deliberately not committed — only the trimmed 17 kB
extract is. To edit or extend the stories, edit `tools/mythology.json` and re-run the
build; to add a constellation, add its abbreviation to `TARGETS` in
`tools/build_data.py` and give it an entry in `tools/mythology.json`.

## A note on licensing

The code and the mythology text are MIT (see `LICENSE`). The constellation *line
figures* in `data/constellations.json` derive from Stellarium's sky-culture data,
which is **GPL-2.0-or-later** — so that file carries the stronger obligation, not
MIT. The underlying IAU star groupings are standard astronomical fact rather than
anyone's creative work, so if the GPL is inconvenient for redistribution the line
lists can be rebuilt by hand from any IAU reference and the dependency drops away.
Flagging it rather than quietly relabelling everything MIT.

## The backdrop

Behind the live sky sits a deep-space plate, `assets/nebula.jpg`, at partial opacity.
It fades out as the Sun rises, so it never shows through a daylit sky, and it can be
turned off under *What you can see*.

The plate is **generated, not downloaded** — `tools/make_nebula.html` draws it from
seeded noise, so the repo carries no third-party artwork. Regenerate or restyle it
with:

```bash
chrome --headless --window-size=2560,1440 --virtual-time-budget=6000 \
       --screenshot=nebula.png tools/make_nebula.html
sips -Z 1600 nebula.png --out nebula-small.png
sips -s format jpeg -s formatOptions 88 nebula-small.png --out assets/nebula.jpg
```

It deliberately contains **no stars** — the app draws the real catalogue on top, and
a second painted star field just reads as noise. Downsampling to 1600px is what
removes the gradient dithering.

### Using a video instead

Swap the `<img>` in `index.html` for a `<video>` and change nothing else — the CSS
styles both identically:

```html
<video id="backdropMedia" class="backdrop-media" src="assets/backdrop.mp4"
       autoplay loop muted playsinline></video>
```

`muted` and `playsinline` are required, or browsers will refuse to autoplay.

## Layout

```
index.html               markup and the control panel
styles.css               dark star-chart styling
js/astro.js              time, precession, alt/az, refraction, Sun and Moon
js/sky.js                stereographic projection and all canvas drawing
js/app.js                state, interaction, and the plain-language layer
data/stars.json          trimmed HYG extract (217 stars)
data/constellations.json line figures plus the mythology content
data/catalog.js          generated: both payloads as globals, so file:// works
assets/nebula.jpg        generated backdrop plate
tools/build_data.py      the build script
tools/mythology.json     the story content, edit this
tools/make_nebula.html   draws the backdrop plate
```

## Accessibility

Every constellation is reachable by keyboard, and each list row carries a text
description of where it currently is, so the sky has a spoken equivalent rather than
being canvas-only. `prefers-reduced-motion` turns off twinkling and the animated
turn-to-face.
