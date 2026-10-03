// Engine tests: ephemeris accuracy against JPL DE421 reference values, plus unit checks of the visibility logic.
// Run: node tools/test.mjs
import fs from 'node:fs';
import { ephem, siteFrame, topo, diskFraction } from '../app/js/astro.js';
import { ephemTable, siteSeries, summarize, windowScan, longestRun, horizonAt, DEFAULTS } from '../app/js/engine.js';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

// 1. Ephemeris vs JPL DE421 + MOON_ME_DE421 and JPL's current DE440 + MOON_ME_DE440_ME421 (both from tools/validate.py with Skyfield)
for (const set of ['de421', 'de440']) {
  const ref = JSON.parse(fs.readFileSync(new URL(`./fixtures/${set}_reference.json`, import.meta.url)));
  let maxS = 0, maxE = 0, maxSA = 0;
  for (const r of ref) {
    const e = ephem(r.ms), f = siteFrame(r.lat, r.lon, 0);
    const s = topo(f, e.sun), E = topo(f, e.earth);
    maxS = Math.max(maxS, Math.abs(s.el - r.sun[1]));
    maxE = Math.max(maxE, Math.abs(E.el - r.earth[1]));
    maxSA = Math.max(maxSA, Math.abs(((s.az - r.sun[0] + 540) % 360) - 180) * Math.cos(r.sun[1] * Math.PI / 180));
  }
  const S = set.toUpperCase();
  ok(maxS < 0.015, `${S}: Sun elevation max error ${maxS.toFixed(4)}° < 0.015° (${ref.length} cases)`);
  ok(maxE < 0.01, `${S}: Earth elevation max error ${maxE.toFixed(4)}° < 0.01°`);
  ok(maxSA < 0.015, `${S}: Sun azimuth max error ${maxSA.toFixed(4)}° < 0.015°`);
}

// 2. Disk fraction geometry
ok(diskFraction(1, 0.27) === 1 && diskFraction(-1, 0.27) === 0, 'disk fully above / below horizon');
ok(Math.abs(diskFraction(0, 0.27) - 0.5) < 1e-12, 'disk centered on horizon is half visible');
ok(diskFraction(0.1, 0.27) > 0.5 && diskFraction(0.1, 0.27) < 1, 'partial disk monotonic');

// 3. Horizon interpolation wraps at 360°
const hz = new Float32Array(720); hz[0] = 2; hz[719] = 1;
ok(Math.abs(horizonAt(hz, 359.75) - 1.5) < 1e-6, 'horizon interpolation wraps across north');

// 4. Physical sanity: equatorial near-side site sees Earth always; far-side never; pole sun stays low
const t0 = Date.UTC(2027, 0, 1), step = 3600e3, n = 24 * 60;
const tab = ephemTable(t0, step, n);
const eq = summarize(siteSeries({ lat: 0.67, lon: 23.47, hz: null }, tab, DEFAULTS), DEFAULTS);
ok(eq.earthPct === 100, `Apollo 11 site sees Earth 100% of the time (${eq.earthPct.toFixed(1)}%)`);
ok(Math.abs(eq.sunPct - 50) < 3, `Apollo 11 site sunlit ~50% (${eq.sunPct.toFixed(1)}%)`);
const far = summarize(siteSeries({ lat: 0, lon: 180, hz: null }, tab, DEFAULTS), DEFAULTS);
ok(far.earthPct === 0, `far side (0°, 180°) never sees Earth (${far.earthPct.toFixed(1)}%)`);
const pole = summarize(siteSeries({ lat: -89.9, lon: 0, hz: null }, tab, DEFAULTS), DEFAULTS);
ok(pole.maxSunEl < 1.8 && pole.minSunEl > -1.8, `polar Sun elevation stays within ±1.8° (${pole.minSunEl.toFixed(2)}…${pole.maxSunEl.toFixed(2)})`);

// 5. Terrain blocks everything when the horizon is a 10° wall
const wall = new Float32Array(720).fill(10);
const pit = summarize(siteSeries({ lat: -89.6, lon: 130, hz: wall }, tab, DEFAULTS), DEFAULTS);
ok(pit.sunPct === 0 && pit.earthPct === 0, 'a 10° horizon wall at the pole blocks Sun and Earth completely');

// 6. Run-length and window scan
ok(longestRun(Uint8Array.from([1, 0, 0, 1, 0, 0, 0, 1]), 0).len === 3, 'longest run of zeros');
const s = siteSeries({ lat: 0.67, lon: 23.47, hz: null }, tab, DEFAULTS);
const w = windowScan(s, 24 * 3, 24, { minLitPct: 90, maxDarkH: 0, minCommPct: 90, maxNoCommH: 1, useDSN: false, requireLanding: true, landSunMin: -2, landSunMax: 90 });
let feas = 0; for (let k = 0; k < w.n; k++) if (w.score[k] >= 0) feas++;
ok(feas > 5 && feas < w.n, `equatorial 3-day windows: some feasible (daylight) and some not (${feas}/${w.n})`);

// 7. Relay orbiters
const { relayPosition, RELAYS } = await import('../app/js/astro.js');
{
  const o = RELAYS.elfo, T = o.periodH * 3600e3;
  const apo = relayPosition('elfo', ephem(o.epoch + T / 2)); // half a period after perilune = apolune
  const r = Math.hypot(...apo);
  ok(Math.abs(r - o.a * (1 + o.e)) < 1 && apo[2] < 0, `frozen-orbit relay apolune is over the south (z ${apo[2].toFixed(0)} km, r ${r.toFixed(0)} km)`);
  const farTab = ephemTable(t0, step, 24 * 30, 'nrho');
  const farSide = summarize(siteSeries({ lat: -75, lon: 132.4, hz: null }, farTab, { ...DEFAULTS, relay: 'nrho', requireDSN: false }), { ...DEFAULTS, relay: 'nrho' });
  ok(farSide.earthPct === 0 && farSide.commsPct > 30, `far-side Schrödinger: no Earth, but NRHO relay gives comms ${farSide.commsPct.toFixed(0)}% of the time`);
  const none = summarize(siteSeries({ lat: -75, lon: 132.4, hz: null }, ephemTable(t0, step, 24 * 30), DEFAULTS), DEFAULTS);
  ok(none.commsPct === none.dtePct, 'without a relay, comms equal direct-to-Earth');
}

// 8. Regression checks for fixed defects
{
  const site = { lat: 0.67, lon: 23.47, hz: null };
  const c = { minLitPct: 0, maxDarkH: 1e9, minCommPct: 0, maxNoCommH: 1e9, useDSN: false, requireLanding: false, landSunMin: -90, landSunMax: 90 };
  const short = windowScan(siteSeries(site, ephemTable(t0, step, 24 * 30), DEFAULTS), 72, 24, c);
  const long = windowScan(siteSeries(site, ephemTable(t0, step, 24 * 365), DEFAULTS), 72, 24, c);
  let worst = 0; for (let k = 0; k < short.n; k++) worst = Math.max(worst, Math.abs(short.score[k] - long.score[k]));
  ok(worst < 1e-4, `window score does not depend on the search span (max difference ${worst.toExponential(1)})`);
  const { snapshot } = await import('../app/js/engine.js');
  const ser = siteSeries({ lat: -89.53432, lon: -150.05233, hz: null }, ephemTable(t0, step, 48), DEFAULTS);
  let dp = 0; for (let i = 0; i < 48; i += 7) dp = Math.max(dp, Math.abs(snapshot({ lat: -89.53432, lon: -150.05233, hz: null }, t0 + i * step, DEFAULTS).power - ser.power[i]));
  ok(dp < 1e-3, `snapshot and time series agree on solar power (float32 storage) (max difference ${dp.toExponential(1)} W)`);
  const { runJob } = await import('../app/js/jobs.js');
  const msgs = [];
  const mk = (id) => ({ type: 'scan', id, t0, step, n: 24 * 10, sites: [{ id: 'a', name: 'A', lat: -89.5, lon: 0, hz: null }], opts: DEFAULTS });
  await Promise.all([runJob(mk(1), (m) => msgs.push([1, m])), runJob(mk(2), (m) => msgs.push([2, m]))]);
  ok(msgs.length > 4 && msgs.every(([who, m]) => m.id === who), `overlapping jobs keep their own message ids (${msgs.length} messages)`);
}

// 9. Performance: one year hourly ephemeris
const tp = performance.now(); ephemTable(t0, 3600e3, 8760); const ms = performance.now() - tp;
ok(ms < 1500, `one year of hourly ephemeris in ${ms.toFixed(0)} ms`);

// 10. Offline: the "Save everything for offline" list, its content hashes and the service-worker cache names are current,
//     and the service worker precaches every code file (one source of truth: tools/build_offline_manifest.py --check)
{
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('python3', [new URL('./build_offline_manifest.py', import.meta.url).pathname, '--check'], { encoding: 'utf8' });
  ok(r.status === 0, `offline file list and cache names are current${r.status === 0 ? '' : ': ' + (r.stdout + r.stderr).trim().replace(/\n/g, '; ')}`);
}

// 11. Security: the Content-Security-Policy allows exactly the one inline script in index.html (by its SHA-256 hash)
{
  const { createHash } = await import('node:crypto');
  const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
  const hashes = inline.map((t) => `'sha256-${createHash('sha256').update(t).digest('base64')}'`);
  ok(csp.includes("default-src 'self'") && hashes.length === 1 && hashes.every((x) => csp.includes(x)), `CSP present and matches the inline script (${hashes.length} inline script)`);
}

console.log(fails ? `\n${fails} test(s) failed` : '\nAll tests passed');
process.exit(fails ? 1 : 0);
