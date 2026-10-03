// Learn: the physics of polar lighting and communications, with live demos, plus methods and data sources.
import { h, getSite, engineOpts, fmtPct, fmtDur, startOfDayUTC, store } from '../ui.js';
import { ephemTable, siteSeries, summarize, DAY } from '../engine.js';
import { timeline, colors } from '../charts.js';

const SECTIONS = [
  ['poles', 'Why the poles are extreme'], ['terrain', 'Terrain decides everything'], ['earth', 'Earth in the lunar sky'],
  ['power', 'Solar power and batteries'], ['comms', 'Talking to Earth'], ['howto', 'Using LunaHorizon'], ['methods', 'Methods & accuracy'], ['glossary', 'Glossary'],
];

export function mount(root, params) {
  const t0 = startOfDayUTC(Date.now());
  const charts = [];

  // Demo 1: Sun elevation over a lunar month at a chosen latitude (smooth horizon)
  const latOut = h('output', '-89.5°');
  const demo1Box = h('div.chart', { style: { height: '200px' } });
  const demo1Info = h('p.muted', { style: { fontSize: '13px' } });
  let demo1 = null;
  const lat = h('input', { type: 'range', min: -89.9, max: 0, step: 0.1, value: -89.5, 'aria-label': 'Latitude', oninput: () => { latOut.textContent = `${(+lat.value).toFixed(1)}°`; runDemo1(); } });
  function runDemo1() {
    const site = { id: 'demo', lat: +lat.value, lon: 0, hz: null, elev_m: 0 };
    const step = 2 * 3600000, n = Math.round(60 * DAY / step);
    const s = siteSeries(site, ephemTable(t0, step, n), engineOpts());
    const x = summarize(s, engineOpts());
    demo1 = s;
    demo1Info.textContent = `Over the next 60 days at ${Math.abs(+lat.value).toFixed(1)}°S on a perfectly smooth Moon: the Sun reaches ${x.maxSunEl.toFixed(2)}° at most and is up ${fmtPct(x.sunPct)} of the time. The longest night is ${fmtDur(x.longestDarkH)}.`;
    d1.redraw();
  }
  const d1 = timeline(demo1Box, () => demo1 && ({ series: demo1, lanes: [{ type: 'line', label: 'Sun elevation', data: demo1.sunEl, color: colors().sun, fill: getComputedStyle(document.documentElement).getPropertyValue('--sun-soft'), baseline: 0, unit: '°' }] }));
  charts.push(d1);

  // Demo 2: terrain contrast between a ridge and a crater floor
  const demo2 = h('div.kpis');
  function runDemo2() {
    const step = 3600000, n = 30 * 24;
    const tab = ephemTable(t0, step, n);
    const pick = [['connecting-ridge', 'Connecting Ridge (ridge crest)'], ['shackleton-floor', 'Shackleton floor (crater bottom)'], ['malapert-massif', 'Malapert Massif (tall peak)']];
    demo2.replaceChildren(...pick.filter(([id]) => getSite(id)).map(([id, label]) => {
      const x = summarize(siteSeries(getSite(id), tab, engineOpts()), engineOpts());
      return h('a.kpi', { href: `#/site/${id}`, style: { textDecoration: 'none', color: 'inherit' } }, h('div.k', label), h('div.v', { html: `${x.sunPct.toFixed(0)}% <small>sunlit</small>` }), h('div.s', `Earth in view ${x.earthPct.toFixed(0)}% · longest shadow ${fmtDur(x.longestDarkH)}`));
    }));
  }

  // Demo 3: Earth elevation over 2 months at Connecting Ridge (libration)
  const demo3Box = h('div.chart', { style: { height: '200px' } });
  let demo3 = null;
  const d3 = timeline(demo3Box, () => demo3 && ({ series: demo3, lanes: [
    { type: 'line', label: 'Earth elevation', data: demo3.earthEl, color: colors().earth, baseline: 0, unit: '°' },
    { type: 'line', label: 'Terrain in Earth\'s direction', data: demo3.earthHz, color: colors().text3, unit: '°' }] }));
  charts.push(d3);
  const site3 = getSite('connecting-ridge');
  if (site3) demo3 = siteSeries(site3, ephemTable(t0, 2 * 3600000, 60 * 12), engineOpts());

  const P = (...t) => h('p', ...t);
  const sec = (id, title, ...body) => h('section', { id: 'learn-' + id, style: { scrollMarginTop: '80px' } }, h('h2', title), ...body);

  root.append(
    h('div.pagehead', h('div', h('h1', 'Learn: light and line of sight at the lunar poles'), h('p', 'For students, educators and new team members: the few ideas you need to read every chart in this tool.'))),
    h('div.grid', { style: { gridTemplateColumns: 'minmax(0,1fr)' } },
      h('div.card', h('nav.row', { 'aria-label': 'Sections' }, SECTIONS.map(([id, t]) => h('a.btn.small', { href: `#/learn/${id}` }, t)))),
      h('div.card.prose', { style: { maxWidth: 'none' } },
        sec('poles', 'Why the poles are extreme',
          P('The Moon\'s spin axis is tilted only about 1.5° from the ecliptic, compared with 23.4° for Earth. At the poles the Sun never climbs high: it circles the horizon once per lunar day (about 29.5 Earth days) and rises or sinks only by ±1.5° over the year.'),
          P('So a ridge 1 km above you and 20 km away, which rises about 2.5° above your horizon once the Moon\'s curvature is allowed for, can hide the Sun for days. Move the slider toward the pole and watch the Sun\'s elevation collapse into a thin band around 0°.'),
          h('label.field', { style: { maxWidth: '420px' } }, h('span', 'Latitude', latOut), lat), demo1Box, demo1Info),
        sec('terrain', 'Terrain decides everything',
          P('Because the Sun is always near the horizon, the local skyline controls the lighting. Crater floors such as Shackleton\'s are permanently shadowed regions (PSRs): they stay below 100 K and can trap water ice. Nearby ridges and peaks can be sunlit about 80% of the time and are nicknamed "peaks of near-eternal light".'),
          P('LunaHorizon traces the horizon at every site from NASA\'s Lunar Orbiter Laser Altimeter (LOLA) topography, out to 260 km in 720 directions. Here are the next 30 days at three contrasting spots:'),
          demo2,
          h('div.callout', 'Ridges and crater floors only a few kilometres apart can differ by 100 percentage points in sunlight. That is why site selection is done point by point.')),
        sec('earth', 'Earth in the lunar sky',
          P('The Moon keeps one face toward Earth, so Earth barely moves in the lunar sky. Libration makes it wander in a small loop of about ±8° in longitude and ±7° in latitude each month. At the south pole Earth sits right on the horizon, above 0° longitude, and bobs up and down with the monthly latitude libration. Mountains in that direction can hide it for about half of every month.'),
          P('On the far side (for example Schrödinger basin) Earth never rises, so missions there need a relay satellite. Earth also shows phases, opposite to the Moon\'s: at new Moon a lunar observer sees a "full Earth".'),
          demo3Box,
          h('p.muted', { style: { fontSize: '13px' } }, 'Connecting Ridge, next 60 days. Earth is visible whenever the blue line is above the gray terrain line.')),
        sec('power', 'Solar power and batteries',
          P('With the Sun near the horizon, polar landers mount solar arrays vertically. They often rotate them to follow the Sun, which is always within a few degrees of level. Output ≈ 1361 W/m² × area × cell efficiency × cos(Sun elevation) × fraction of the solar disk above the terrain.'),
          P('The design driver is the longest shadow: the battery must carry the platform load through it, and the survival heaters in the cold dark are the hardest part. The Explorer runs a battery state-of-charge model with the array, load and capacity you set in Settings.'),
          h('div.callout', 'Rule of thumb: required battery (Wh) ≳ load (W) × longest shadow (h), plus margin for heaters and aging.'),
          P('Height matters as much as location. With the Sun only a degree or two up, even a gentle 2–3° slope nearby can hide it from a panel near the ground. In LunaHorizon\'s high-resolution analysis of 2027, raising the array from 2 m to 10 m lifts sunlight at Malapert Massif from 56% to 80% of the time, and at de Gerlache Rim 2 from 58% to 78%. Switch heights in Settings.')),
        sec('comms', 'Talking to Earth',
          P('Direct-to-Earth (DTE) communication needs two things at once: a clear line of sight from the lander to Earth over the local terrain, and a ground antenna on Earth that can see the Moon. NASA\'s Deep Space Network has three complexes, about 120° apart in longitude (Goldstone, Madrid, Canberra), so the Moon is almost always above the horizon at one of them.'),
          P('At the pole the limiting factor is almost always lunar terrain. When Earth is hidden, missions rely on relay orbiters (for example Lunar Pathfinder, or the relay services of NASA\'s LunaNet / LCRNS architecture) or wait for Earthrise.'),
          P('The Settings panel lets you require a terrain clearance margin for your antenna beam and set the DSN elevation mask.'),
          P('Settings also offers two representative relay orbiters. A frozen elliptical orbit like ESA\'s Lunar Pathfinder (12 h period) spends most of each orbit high over the south pole. An approximation of Gateway\'s near-rectilinear halo orbit (6.6 days) hangs up to 70,000 km above it. With a relay switched on, a link counts when the relay is above your skyline and can itself see Earth, so far-side and Earth-hidden sites gain coverage.')),
        sec('howto', 'Using LunaHorizon',
          h('ul',
            h('li', h('b', 'Mission planners: '), 'Window Finder → choose a mission profile and constraints → read the feasibility calendar → export .ics or CSV → open any opportunity in the Explorer to check the exact geometry.'),
            h('li', h('b', 'Engineers: '), 'set the array, load and battery in Settings; the Explorer and Compare pages then show energy per day, longest shadow and minimum battery charge for every site.'),
            h('li', h('b', 'Educators: '), 'use the Explorer\'s play button (Space) to animate a lunar day, switch to the Sky dome, and compare a ridge with a crater floor. Every view has a shareable link.'),
            h('li', h('b', 'Everyone: '), 'tap anywhere on the Site Map to trace that spot\'s horizon in your browser and add it as your own site.'),
            h('li', h('b', '3D view: '), 'fly over the real terrain while the Sun moves; shadows are traced toward the Sun on your graphics card, including the Sun\'s disk size and the Moon\'s curvature.'),
            h('li', h('b', 'Keyboard: '), '← / → step one hour (Shift for a day), Space plays or pauses, N jumps to now.'))),
        sec('methods', 'Methods & accuracy',
          h('ul',
            h('li', h('b', 'Ephemeris: '), 'geocentric Moon from Meeus\' truncated ELP-2000/82 series; Sun from Meeus ch. 25 with aberration; precession to J2000; IAU WGCCRE 2009 lunar orientation (approximating the Mean-Earth/Polar-Axis frame of the LOLA products). Topocentric parallax is included for both bodies.'),
            h('li', h('b', 'Validation: '), 'compared with JPL DE421 plus the MOON_ME_DE421 frame, and with JPL\'s current DE440 plus MOON_ME_DE440_ME421 (via Skyfield), for 240 random site-times over 2024–2036 at four sites. Sun elevation: mean |error| 0.0015°, max 0.009°. Earth elevation: mean 0.0008°, max 0.003°, the same against both.'),
            h('li', h('b', 'Terrain: '), 'LOLA GDR polar stereographic DEMs (PDS). Curated site horizons are ray-traced for sensors 2 m and 10 m above the ground, over 1440 azimuths out to 260 km with the Moon\'s curvature, layering the finest data first: 5 m (LDEM_875S_5M, within 4 km, sites south of 87.5°S), 20 m (LDEM_80S_20M, within 15 km), then 80 m and 240 m. They are reduced to 720 bins by taking the maximum. Horizons for your own sites are traced in the browser from 400 m and 1.6 km resamplings.'),
            h('li', h('b', 'Maps: '), 'sunlight and Earth-visibility percentages for every year of one 18.6-year lunar cycle (2026–2044), in 6-hour steps on a 1 km grid (160,000 cells), plus their average and the year-to-year swing. They use 2° horizon sampling from the 240 m DEM out to 200 km and the same validated ephemeris, so they are screening maps, not certification products. Finding: sunlight varies little between years (a typical cell swings about 3 percentage points); the season within a year matters far more.'),
            h('li', h('b', 'Relay orbits: '), 'representative geometry for coverage studies, not official ephemerides: a Keplerian frozen orbit (a = 6,143 km, e = 0.6, i = 57.8°, apolune over the south pole) and a body-fixed ellipse approximating the 9:2 NRHO (perilune 3,200 km over the north pole, apolune 70,000 km over the south pole). A link needs the relay above the skyline by the set margin and a clear line from the relay to Earth.'),
            h('li', h('b', 'Visibility rules: '), '"Sunlit" means at least the set fraction of the solar disk is above the terrain (default 50%). "Earth in view" means Earth\'s center clears the terrain by the set margin. DTE additionally needs a DSN complex with the Moon above its elevation mask.'),
            h('li', h('b', 'Site coordinates: '), 'published points where available (Gracy & Lee LPSC 2024; the LROC region centre for Mons Mouton Plateau; IM-1/IM-2/Blue Ghost landing sites). For Artemis III regions without published points, the app uses a representative point: the 1 km map cell with the most sunlight and Sun-and-Earth time near the approximate region center. These are labeled as such.'),
            h('li', h('b', 'Data freshness: '), 'Sun, Earth, relay and DSN positions are computed live on your device for any moment, including right now. The terrain comes from NASA\'s LOLA archive at the PDS Geosciences Node',
              store.meta?.nasa_sources ? ` (files as published on ${[...new Set(Object.values(store.meta.nasa_sources).map((d) => new Date(d).toISOString().slice(0, 10)))].join(', ')})` : '',
              '. Every 6 hours GitHub\'s servers ask NASA whether any of these files has changed; if one has, all maps, horizons and terrain are rebuilt from the new files and the app updates itself on every device.'),
            h('li', h('b', 'Limitations: '), 'no local shadows smaller than the DEM cell, a spherical horizon outside polar DEM coverage, no refraction (the Moon has no atmosphere), and TT − UTC fixed at 69.184 s (no leap seconds after 2016). For flight operations, confirm with SPICE-based tools.'))),
        sec('glossary', 'Glossary',
          h('dl.gloss',
            ...[['CLPS', 'Commercial Lunar Payload Services: NASA buys deliveries of science payloads to the Moon from commercial landers.'],
              ['DTE', 'Direct-to-Earth communication, from the surface straight to a ground antenna with no relay.'],
              ['DSN', 'Deep Space Network: NASA\'s antenna complexes at Goldstone (USA), Madrid (Spain) and Canberra (Australia).'],
              ['Libration', 'Apparent wobble of the Moon as seen from Earth. On the Moon it shows up as Earth drifting in a small loop in the sky.'],
              ['LOLA', 'Lunar Orbiter Laser Altimeter on NASA\'s Lunar Reconnaissance Orbiter. It measured the Moon\'s topography with billions of laser shots.'],
              ['PSR', 'Permanently Shadowed Region: ground that never receives direct sunlight and is a likely cold trap for water ice.'],
              ['Azimuth / elevation', 'Compass direction (0° = north, 90° = east) and angle above the ideal horizontal plane.'],
              ['Terrain horizon', 'For each azimuth, the elevation of the highest terrain seen from the site. A body is visible only when it is above this line.'],
              ['Lunar day', 'One full solar day on the Moon: about 29.53 Earth days, or 14.8 days of light and 14.8 of night at low latitudes.']].flatMap(([t, d]) => [h('dt', t), h('dd', d)])))),
    ));

  runDemo1(); runDemo2(); d3.redraw();
  if (params[0]) requestAnimationFrame(() => document.getElementById('learn-' + params[0])?.scrollIntoView({ behavior: 'smooth' }));
  return {
    update(p) { if (p[0]) document.getElementById('learn-' + p[0])?.scrollIntoView({ behavior: 'smooth' }); },
    unmount() { charts.forEach((c) => c.destroy()); },
  };
}
