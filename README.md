# LunaHorizon: CLPS Lunar Mission Browser

**NASA Space Apps Challenge 2026: CLPS Lunar Mission Browser**

At the Moon's south pole the Sun skims the horizon and Earth bobs in and out of view behind mountains.
LunaHorizon lets mission planners, educators and the public **compare landing sites and dates in seconds**.
It shows where the **Sun and Earth sit relative to the real terrain horizon**, so you can judge **solar power** and
**direct-to-Earth (DTE) communication windows** at a glance.

It runs on any phone, tablet or computer and installs there as an app (the Install button in the top bar gives the right steps for each browser). It works offline after the first visit, and **Save everything for offline** (in the Install guide, Settings and on Home) stores the whole app (about 12 MB) so every page, map year and terrain spot works in airplane mode; an Offline badge shows when there is no connection.
There is no build step and no framework: plain ES modules and canvas.

**Demo video and slides:** [30-second demo video](submission/LunaHorizon_Demo_30s.mp4) ·
[slides (PDF)](submission/LunaHorizon_Slides.pdf) · [slides (PowerPoint)](submission/LunaHorizon_Slides.pptx)

## What it does

| Page | Answers |
|---|---|
| **Site Map** | Where is the light? A LOLA hillshade of the south pole with yearly **sunlight %, Earth-visibility % and Sun+Earth %** maps on a 1 km grid. Tap any spot to trace its terrain horizon in the browser and save it as your own site. |
| **Explorer** | What does the sky look like from this site right now, or at any date? A 360° **horizon panorama** (or sky dome) shows the LOLA skyline, the Sun and Earth (with phase) and their ±15-day tracks. It includes a time machine (play, step, scrub), live readouts (elevation, % of disk visible, array power, net power, DSN complexes), next sunrise / Earthrise events, and a timeline of Sun and Earth clearance, sunlight / Earth / DSN / Sun+Earth flags, **solar power and battery state of charge**. Exports CSV and PNG. |
| **Compare** | Which site is best for a given period? Ranking by sunlit %, Earth %, DTE %, Sun+Earth %, comms % (DTE + relay), longest comms gap, longest shadow, longest Earth loss, energy per day and minimum battery charge. Adds synchronized swimlanes and a **daily calendar heatmap**. One click jumps to any site at any moment. |
| **Window Finder** | When can we land? It tests every landing time (every 3 h) against the full surface stay using mission profiles (Artemis III crewed, CLPS lander, long-duration rover, custom). The result is a **feasibility calendar**, a list of landing opportunities with reasons for rejection, and **.ics** and CSV export. |
| **3D South Pole** | WebGL2 terrain (±80 km detail, ±200 km context) lit by the Sun at any moment. Shadows are ray-traced toward the Sun on the GPU through true LOLA heights, including the Moon's curvature and the Sun's disk size; modes for live light, average yearly sunlight and Earth visibility; adjustable relief. |
| **Learn** | Why the poles are extreme, terrain and PSRs, Earth libration, power and batteries, DTE, DSN and relays, how to use the tool, methods and accuracy, and a glossary. It includes live demos. |

**Relay satellites.** Settings adds an optional relay orbiter: a Lunar Pathfinder-class frozen elliptical orbit (12 h) or an approximation of Gateway's NRHO (6.6 d). Communications then count when Earth or the relay is above the skyline and the relay can see Earth, so far-side and Earth-hidden sites show relay coverage everywhere: Explorer, Compare and Window Finder.

**The 18.6-year cycle.** The maps cover every year from 2026 to 2044 (one full lunar nodal cycle), with a year picker, a cycle average and a year-to-year variability layer; Compare adds a 19-year heatmap of every chosen site. Finding: sunlight at a spot typically swings only about 3 percentage points between years; the season within a year matters far more.

**High-resolution horizons.** Site horizons layer LOLA 5 m data (within 4 km, sites south of 87.5°S) and 20 m data (within 15 km) over the 80 m and 240 m grids, fetched as small windows with HTTP range requests.

**Sensor height.** Settings switches site horizons between 2 m (lander deck) and 10 m (mast): with the Sun a degree or two up, gentle nearby slopes matter (Malapert Massif: 56% → 80% sunlit in 2027).

Other features: install help for each browser, shareable deep links for every view, UTC or local time, light and dark themes, keyboard shortcuts
(←/→ hour, Shift for day, Space to play, N for now), configurable visibility rules (solar-disk fraction, antenna terrain
margin, DSN elevation mask) and power system (array type, area, efficiency, load, battery).

## Sites included

* **Artemis III candidate regions (Oct 2024 list of 9)** plus Connecting Ridge and Peak near Shackleton. Published points are used where
  they exist (Gracy & Lee, LPSC 2024; Nobile Rim 2 DM2; the LROC region centre for Mons Mouton Plateau). Otherwise the app uses a representative point: the 1 km cell with the most sunlight and Sun-and-Earth time near the approximate
  region center. These points are labeled in the app.
* **CLPS missions:** IM-1 Odysseus, IM-2 Athena, Blue Ghost M1 (Mare Crisium), and the Schrödinger basin (far side, Blue Ghost M2 region).
* **References:** Shackleton floor (a permanently shadowed region), the LCROSS impact site, and Apollo 11.
* **Any location on the Moon** can be added from the map or by coordinates.

## Accuracy

* Ephemeris: Meeus ELP-2000/82 (truncated) Moon, Meeus Sun with aberration, precession to J2000, and the IAU 2009 lunar orientation model
  (≈ Mean-Earth/Polar-Axis frame), with topocentric parallax.
* Validated against **JPL DE421 + MOON_ME_DE421** and JPL's current **DE440 + MOON_ME_DE440_ME421** (Skyfield) for 240 random
  site-times: Sun elevation mean 0.0015°, max 0.009°; Earth elevation mean 0.0008°, max 0.003° (the same against both).
  The solar disk's radius is 0.27°, so these errors are far smaller than the Sun itself. Run `npm test` to reproduce.
* Terrain: NASA LRO **LOLA** polar DEMs (PDS Geosciences Node): `LDEM_875S_5M` and `LDEM_80S_20M` windows near each site,
  `LDEM_80S_80M` and `LDEM_75S_240M` beyond. Horizons are ray-traced out to 260 km allowing for the Moon's curvature,
  for sensors 2 m and 10 m above the ground.

This is a planning and education tool; confirm flight operations with SPICE-based tools.

## Privacy and security

No accounts, cookies, tracking or server: everything runs in the browser, and settings, your own sites and offline
files stay on your device. See [SECURITY.md](SECURITY.md) for the protections in place and how to report a problem.

## Fresh NASA data

* **Live geometry:** Sun, Earth, relay and DSN positions are computed on each visitor's device for any moment, including
  right now. No server or download is involved.
* **Terrain:** the app's data is built from NASA's LOLA files at the PDS Geosciences Node; `tools/nasa_sources.json`
  records the versions it was built from, and Learn → Methods shows their dates.
* **Following NASA's updates:** every 6 hours the deploy workflow (`.github/workflows/pages.yml`) runs on GitHub's servers
  and asks NASA's server whether any of those files is newer than the versions the live app was built from
  (`python3 tools/nasa_sources.py --check --live <site>`). When one is,
  it downloads NASA's current files, rebuilds every map, horizon and terrain tile, re-picks the region points, runs the
  tests and republishes the app; installed copies then replace their saved data. It needs no computer of yours and
  commits nothing. *Actions → Deploy to GitHub Pages → Run workflow* with "rebuild" ticked forces a full rebuild.
  To bring the repository's own copy of the data up to date afterwards, run the rebuild steps below and commit.
* GitHub pauses scheduled workflows in a public repository after 60 days without any repository activity; it emails
  the owner first, and the workflow's page has an *Enable workflow* button.

## Run it

```bash
npm start            # serves app/ at http://localhost:8080  (or: python3 -m http.server -d app 8080)
npm test             # ephemeris accuracy vs JPL DE421 and DE440, visibility, relays, windows, performance,
                     # offline file list and cache names, security policy
```

Any static host works (GitHub Pages, Netlify, S3). Serve the `app/` folder.

## Rebuild the data (optional)

Everything in `app/data/` is generated from public NASA data. Python 3.10+ with `pip install -r tools/requirements.txt` (in a virtual environment), and Node 20+.

```bash
# 1. LOLA polar DEMs (PDS Geosciences Node), about 145 MB
mkdir -p raw && cd raw
B=https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img
curl -O $B/ldem_80s_80m.img && curl -O $B/ldem_75s_240m.img && cd ..
# 2. 5 m and 20 m windows around each site (HTTP range requests; resumable), site horizons (2 m and 10 m),
#    basemaps, browser DEMs, terrain tiles and 3D tiles
npm run data
# 3. Sunlight / Earth-visibility maps for 2026–2044 (all CPU cores, ~30 min), the map layers, and a check that every
#    representative region point still matches its selection rule
npm run maps
# 4. Optional: regenerate the JPL accuracy references used by the tests (needs skyfield + NAIF kernels)
python3 tools/validate.py <kernel-dir> de421 && python3 tools/validate.py <kernel-dir> de440
# 5. Optional: redraw the app icons
python3 tools/make_icons.py
```

The site list is `tools/sites.py`. Artemis III regions without a published point use a representative point: the 1 km map
cell with the highest 2027 sunlight % plus Sun-and-Earth % within a set radius of the approximate region centre;
`python3 tools/pick_region_points.py` recomputes all of them and fails if one no longer matches.

After changing any file in `app/`, run `python3 tools/build_offline_manifest.py`. It refreshes the "Save everything for
offline" list (`app/data/offline.json`) and bumps the service worker's cache names from content hashes: the app shell
cache when code changes, the data cache only when data changes, so installed copies update while terrain users
downloaded survives code updates. `npm test` fails if this step was skipped.

With the versions pinned in `tools/requirements.txt`, a rebuild from the same NASA files reproduces `app/data/` byte for
byte (other Pillow versions encode the two JPEG basemaps slightly differently).

## Project layout

```
app/                 static web app (deploy this)
  index.html         shell, navigation
  css/app.css        design system (light/dark tokens, responsive)
  js/astro.js        ephemeris: Moon, Sun, lunar orientation, topocentric geometry, DSN
  js/engine.js       visibility, disk fractions, power/battery model, statistics, window scan
  js/jobs.js         heavy jobs: multi-site scans, 19-year statistics, in-browser terrain horizon tracing
  js/worker.js       Web Worker entry for jobs.js (the page runs jobs.js itself where module workers are missing)
  js/gz.js           gzip decoding (built-in DecompressionStream, else vendor/fflate.js)
  js/charts.js       canvas renderers: panorama, sky dome, timeline, swimlanes, heatmap
  js/install.js      install-as-an-app button and per-browser steps
  js/offline.js      save everything for offline use, Offline badge
  js/views/*.js      pages (lazy-loaded)
  data/              sites + horizons, basemaps, overlay maps, compressed DEMs, offline.json file list
  vendor/fflate.js   fallback gzip decoder (MIT, see fflate.LICENSE)
  sw.js              offline cache
tools/               data pipeline, NASA source check, validation and tests
.github/workflows/    pages.yml: tests, the 6-hourly NASA data check and rebuild, deploy to GitHub Pages
LICENSE, SECURITY.md MIT license; security notes and how to report a problem
```

## Data sources

* LOLA GDR polar DEMs: https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/
* JPL DE421 and DE440 ephemerides with their lunar orientation kernels (validation only): https://naif.jpl.nasa.gov/pub/naif/generic_kernels/
* NASA Artemis III candidate regions (Oct 2024 update); LPSC 2024 #1695 (Gracy & Lee); LPSC 2026 #1901 (George et al., https://ntrs.nasa.gov/citations/20250011660), also the source of the 5.75–6.25-day Artemis III surface stay
* Mons Mouton Plateau region centre (84.3°S, 30.6°E): LROC NAC Artemis III region mosaic `NAC_ROI_MOUTNPLTLOA` (https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_ROI_MOUTNPLTLOA)

## License

Code: MIT, see [LICENSE](LICENSE). NASA data products (LOLA, ephemerides) are public domain; fflate is MIT.
