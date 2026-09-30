# LunaHorizon: CLPS Lunar Mission Browser

**NASA Space Apps Challenge 2026: CLPS Lunar Mission Browser**

At the Moon's south pole the Sun skims the horizon and Earth bobs in and out of view behind mountains.
LunaHorizon lets mission planners, educators and the public **compare landing sites and dates in seconds**.
It shows where the **Sun and Earth sit relative to the real terrain horizon**, so you can judge **solar power** and
**direct-to-Earth (DTE) communication windows** at a glance.

It runs on phones, tablets and desktops, installs as an app (PWA), and works offline after the first visit.
There is no build step and no framework: plain ES modules and canvas.

## What it does

| Page | Answers |
|---|---|
| **Site Map** | Where is the light? A LOLA hillshade of the south pole with yearly **sunlight %, Earth-visibility % and Sun+Earth %** maps on a 1 km grid. Tap any spot to trace its terrain horizon in the browser and save it as your own site. |
| **Explorer** | What does the sky look like from this site right now, or at any date? A 360° **horizon panorama** (or sky dome) shows the LOLA skyline, the Sun and Earth (with phase) and their ±15-day tracks. It includes a time machine (play, step, scrub), live readouts (elevation, % of disk visible, array power, net power, DSN complexes), next sunrise / Earthrise events, and a timeline of Sun and Earth clearance, sunlight / Earth / DSN / Sun+Earth flags, **solar power and battery state of charge**. Exports CSV and PNG. |
| **Compare** | Which site is best for a given period? Ranking by sunlit %, Earth %, DTE %, Sun+Earth %, longest shadow, longest Earth loss, energy per day and minimum battery charge. Adds synchronized swimlanes and a **daily calendar heatmap**. One click jumps to any site at any moment. |
| **Window Finder** | When can we land? It tests every landing time (every 3 h) against the full surface stay using mission profiles (Artemis III crewed, CLPS lander, long-duration rover, custom). The result is a **feasibility calendar**, a list of landing opportunities with reasons for rejection, and **.ics** and CSV export. |
| **Learn** | Why the poles are extreme, terrain and PSRs, Earth libration, power and batteries, DTE and DSN, how to use the tool, methods and accuracy, and a glossary. It includes live demos. |

Other features: shareable deep links for every view, UTC or local time, light and dark themes, keyboard shortcuts
(←/→ hour, Shift for day, Space to play, N for now), configurable visibility rules (solar-disk fraction, antenna terrain
margin, DSN elevation mask) and power system (array type, area, efficiency, load, battery).

## Sites included

* **Artemis III candidate regions (Oct 2024 list of 9)** plus Connecting Ridge and Peak near Shackleton. Published points are used where
  they exist (Gracy & Lee, LPSC 2024; Nobile Rim 2 DM2). Otherwise the app uses a representative point: the best-lit 1 km cell near the approximate
  region center. These points are labeled in the app.
* **CLPS missions:** IM-1 Odysseus, IM-2 Athena, Blue Ghost M1 (Mare Crisium), and the Schrödinger basin (far side, Blue Ghost M2 region).
* **References:** Shackleton floor (a permanently shadowed region), the LCROSS impact site, and Apollo 11.
* **Any location on the Moon** can be added from the map or by coordinates.

## Accuracy

* Ephemeris: Meeus ELP-2000/82 (truncated) Moon, Meeus Sun with aberration, precession to J2000, and the IAU 2009 lunar orientation model
  (≈ Mean-Earth/Polar-Axis frame), with topocentric parallax.
* Validated against **JPL DE421 + MOON_ME_DE421** (Skyfield) for 240 random site-times:
  Sun elevation mean 0.0015°, max 0.009°; Earth elevation mean 0.0008°, max 0.003°.
  The solar disk's radius is 0.27°, so these errors are far smaller than the Sun itself. Run `npm test` to reproduce.
* Terrain: NASA LRO **LOLA** polar DEMs `LDEM_80S_80M` and `LDEM_75S_240M` (PDS Geosciences Node). Horizons are ray-traced out to 260 km
  with Earth-curvature geometry.

This is a planning and education tool; confirm flight operations with SPICE-based tools.

## Run it

```bash
npm start            # serves app/ at http://localhost:8080  (or: python3 -m http.server -d app 8080)
npm test             # engine tests (ephemeris accuracy, visibility logic, performance)
```

Any static host works (GitHub Pages, Netlify, S3). Serve the `app/` folder.

## Rebuild the data (optional)

```bash
# 1. Download LOLA DEMs into raw/ (see tools/build_data.py header for URLs)
# 2. Screening maps (parallel, all CPU cores):
node tools/overlay.mjs
# 3. Site horizons, basemaps, browser DEMs:
python3 tools/build_data.py
```

## Project layout

```
app/                 static web app (deploy this)
  index.html         shell, navigation
  css/app.css        design system (light/dark tokens, responsive)
  js/astro.js        ephemeris: Moon, Sun, lunar orientation, topocentric geometry, DSN
  js/engine.js       visibility, disk fractions, power/battery model, statistics, window scan
  js/worker.js       Web Worker: multi-site scans, in-browser terrain horizon tracing
  js/charts.js       canvas renderers: panorama, sky dome, timeline, swimlanes, heatmap
  js/views/*.js      pages (lazy-loaded)
  data/              sites + horizons, basemaps, overlay maps, compressed DEMs
  sw.js              offline cache
tools/               data pipeline, validation and tests
```

## Data sources

* LOLA GDR polar DEMs: https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/
* JPL DE421 and lunar PA kernels (validation only): https://naif.jpl.nasa.gov/
* NASA Artemis III candidate regions (Oct 2024 update); LPSC 2024 #1695 (Gracy & Lee); LPSC 2026 #1901 (George et al.)
