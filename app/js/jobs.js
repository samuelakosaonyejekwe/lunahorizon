// Heavy computations: multi-site scans (compare + planner), multi-year statistics and terrain horizons for custom sites.
// Runs inside a Web Worker (worker.js) or, on browsers that cannot start module workers, on the page itself.
import { ephemTable, siteSeries, summarize, windowScan, HOUR, DAY } from './engine.js';
import { gunzip } from './gz.js';
import { MOON_R_KM } from './astro.js';

const R_M = MOON_R_KM * 1000;

/** Fetch a gzip file, reporting compressed bytes as they arrive; returns the decompressed bytes */
async function fetchGz(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Terrain download failed: ' + res.status);
  let gz;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader(), chunks = [];
    let n = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; onBytes(value.length); }
    gz = new Uint8Array(n); let o = 0; for (const c of chunks) { gz.set(c, o); o += c.length; }
  } else { gz = new Uint8Array(await res.arrayBuffer()); onBytes(gz.length); }
  return gunzip(gz);
}

const NEAR_KM = 100;            // fine 400 m terrain is fetched within this radius of the tapped spot; beyond it the 1.6 km grid
let farG = null, nearG = null, farLoad = null;
const tileLoads = new Map();    // tile key -> promise, shared by overlapping requests so nothing downloads twice

/**
 * Make sure the coarse far-field grid and the fine tiles around (lat, lon) are loaded; download only what is missing.
 * `send` posts progress for the job that asked (jobs can overlap in the worker).
 */
async function ensureTerrain(base, meta, lat, lon, send, nearKm = NEAR_KM) {
  const tm = meta.dem_near_tiles;
  if (!nearG) nearG = { a: new Int16Array(tm.n * tm.n).fill(-32768), half_m: tm.half_m, cell: tm.cell, n: tm.n };
  const [px, py] = llToXY(lat * Math.PI / 180, lon * Math.PI / 180);
  const span = tm.tile * tm.cell, want = [];
  for (let r = 0; r < tm.rows; r++) for (let c = 0; c < tm.rows; c++) {
    const x0 = -tm.half_m + c * span, x1 = x0 + span, y1 = tm.half_m - r * span, y0 = y1 - span;
    const dx = Math.max(x0 - px, 0, px - x1), dy = Math.max(y0 - py, 0, py - y1);
    if (Math.hypot(dx, dy) <= nearKm * 1000) want.push([r, c]);
  }
  const missing = want.filter(([r, c]) => !tileLoads.has(r * 1000 + c));
  if (!missing.length && farLoad) { await Promise.all([farLoad, ...want.map(([r, c]) => tileLoads.get(r * 1000 + c))]); return; }
  // progress by compressed bytes (sizes come from meta.json), so one large file does not stall the percentage
  const total = missing.reduce((a, [r, c]) => a + (tm.bytes?.[r * tm.rows + c] || 30000), 0) + (farLoad ? 0 : (meta.dem_far.bytes || 560000));
  let bytes = 0, lastMsg = 0;
  const report = (force) => {
    const now = Date.now();
    if (!force && now - lastMsg < 250) return;
    lastMsg = now;
    send({ type: 'progress', msg: `Downloading LOLA terrain… ${Math.min(99, Math.round(bytes / total * 100))}% (${(bytes / 1e6).toFixed(2)} of ${(total / 1e6).toFixed(2)} MB)` });
  };
  const onBytes = (n) => { bytes += n; report(false); };
  report(true);
  // queue: at most 6 downloads at a time
  const queue = [];
  let active = 0;
  const limit = (fn) => new Promise((res, rej) => {
    const run = () => { active++; fn().then(res, rej).finally(() => { active--; if (queue.length) queue.shift()(); }); };
    active < 6 ? run() : queue.push(run);
  });
  if (!farLoad) {
    farLoad = limit(async () => { const a = new Int16Array(await fetchGz(base + 'data/dem_far.bin.gz', onBytes)); farG = { a, ...meta.dem_far }; })
      .catch((e) => { farLoad = null; throw e; });
    farLoad.catch(() => {});        // the await below reports the failure; this stops a second "unhandled rejection"
  }
  for (const [r, c] of missing) {
    const key = r * 1000 + c;
    tileLoads.set(key, limit(async () => {
      const buf = new Int16Array(await fetchGz(`${base}data/dem_tiles/t_${r}_${c}.bin.gz`, onBytes));
      const T = tm.tile, n = tm.n;
      for (let i = 0; i < T && r * T + i < n; i++) {
        const row = (r * T + i) * n + c * T, w = Math.min(T, n - c * T);
        nearG.a.set(buf.subarray(i * T, i * T + w), row);
      }
    }).catch((e) => { tileLoads.delete(key); throw e; }));
    tileLoads.get(key).catch(() => {});   // only the first failure is reported (by the await below), not one per tile
  }
  await Promise.all([farLoad, ...want.map(([r, c]) => tileLoads.get(r * 1000 + c))]);
}

function demSample(g, x, y) {
  const c = (x + g.half_m) / g.cell - 0.5, r = (g.half_m - y) / g.cell - 0.5;
  if (c < 0 || r < 0 || c >= g.n - 1 || r >= g.n - 1) return NaN;
  const c0 = c | 0, r0 = r | 0, fc = c - c0, fr = r - r0, n = g.n, a = g.a;
  const v00 = a[r0 * n + c0], v01 = a[r0 * n + c0 + 1], v10 = a[(r0 + 1) * n + c0], v11 = a[(r0 + 1) * n + c0 + 1];
  if (v00 === -32768 || v01 === -32768 || v10 === -32768 || v11 === -32768) return NaN;
  return v00 * (1 - fc) * (1 - fr) + v01 * fc * (1 - fr) + v10 * (1 - fc) * fr + v11 * fc * fr;
}

function heightAt(x, y) {
  const h = demSample(nearG, x, y);
  return Number.isNaN(h) ? demSample(farG, x, y) : h;
}

function llToXY(lat, lon) {
  const rho = 2 * R_M * Math.tan(Math.PI / 4 + lat / 2);
  return [rho * Math.sin(lon), rho * Math.cos(lon)];
}

/** Terrain horizon (0.5° bins) for a site; mast height in meters. */
function computeHorizon(latDeg, lonDeg, mast, send) {
  const phi1 = latDeg * Math.PI / 180, lam1 = lonDeg * Math.PI / 180;
  const [x0, y0] = llToXY(phi1, lam1);
  const h0 = heightAt(x0, y0);
  if (Number.isNaN(h0)) throw new Error('Location is outside LOLA polar terrain coverage.');
  const r1 = R_M + h0 + mast;
  const ND = 700, dmin = 200, dmax = 260e3;
  const ds = new Float64Array(ND), cd = new Float64Array(ND), sd = new Float64Array(ND);
  for (let j = 0; j < ND; j++) {
    ds[j] = dmin * Math.pow(dmax / dmin, j / (ND - 1));
    const dl = ds[j] / R_M;
    cd[j] = Math.cos(dl); sd[j] = Math.sin(dl);
  }
  const NR = 1440, rays = new Float32Array(NR);
  const sp1 = Math.sin(phi1), cp1 = Math.cos(phi1);
  for (let k = 0; k < NR; k++) {
    const th = k * 2 * Math.PI / NR, ct = Math.cos(th), st = Math.sin(th);
    let best = -15;                // floor only where a ray finds no terrain at all (as tools/build_data.py)
    for (let j = 0; j < ND; j++) {
      const sp2 = sp1 * cd[j] + cp1 * sd[j] * ct;
      const phi2 = Math.asin(Math.max(-1, Math.min(1, sp2)));
      const lam2 = lam1 + Math.atan2(st * sd[j] * cp1, cd[j] - sp1 * sp2);
      const rho = 2 * R_M * Math.tan(Math.PI / 4 + phi2 / 2);
      const h = heightAt(rho * Math.sin(lam2), rho * Math.cos(lam2));
      if (Number.isNaN(h)) continue;
      const r2 = R_M + h;
      const el = Math.atan2(r2 * cd[j] - r1, r2 * sd[j]) * 180 / Math.PI;
      if (el > best) best = el;
    }
    rays[k] = best;
    if (k % 180 === 0) send({ type: 'progress', msg: `Tracing terrain horizon… ${Math.round(k / NR * 100)}%` });
  }
  const hz = new Float32Array(720);
  for (let k = 0; k < 720; k++) hz[k] = Math.max(rays[(2 * k - 1 + NR) % NR], rays[2 * k], rays[2 * k + 1]);
  return { hz, h0 };
}

function dailyAgg(s, t0, stepMs) {
  const perDay = Math.round(DAY / stepMs);
  const nd = Math.floor(s.n / perDay);
  const lit = new Float32Array(nd), earth = new Float32Array(nd), comms = new Float32Array(nd), both = new Float32Array(nd), power = new Float32Array(nd);
  for (let d = 0; d < nd; d++) {
    let a = 0, b = 0, c = 0, e = 0, p = 0;
    for (let i = d * perDay; i < (d + 1) * perDay; i++) {
      a += s.lit[i]; b += s.earthVis[i]; c += s.comms[i]; e += s.lit[i] & s.earthVis[i]; p += s.power[i];
    }
    lit[d] = a / perDay * 100; earth[d] = b / perDay * 100; comms[d] = c / perDay * 100; both[d] = e / perDay * 100; power[d] = p / perDay;
  }
  return { nd, lit, earth, comms, both, power };   // comms = direct-to-Earth, or via the relay when one is set
}

/** Run one job message; results and progress go to postFn(message, transferList), tagged with this job's id */
export async function runJob(m, postFn) {
  const post = (msg, transfer) => postFn({ ...msg, id: m.id }, transfer);
  try {
    if (m.type === 'scan') {
      const { t0, step, n, sites, opts, window: win, lanes } = m;
      post({ type: 'progress', msg: 'Computing Sun & Earth ephemeris…' });
      const tab = ephemTable(t0, step, n, opts.relay);
      const results = [];
      for (let i = 0; i < sites.length; i++) {
        post({ type: 'progress', msg: `Analyzing ${sites[i].name} (${i + 1}/${sites.length})…` });
        const s = siteSeries(sites[i], tab, opts);
        const r = { id: sites[i].id, stats: summarize(s, opts), daily: dailyAgg(s, t0, step) };
        if (lanes) {
          r.lit = s.lit; r.earthVis = s.earthVis; r.dte = s.dte; r.sunFrac = s.sunFrac; r.comms = s.comms; r.relayLink = s.relayLink;
        }
        if (win) {
          const durSteps = Math.round(win.durH * HOUR / step);
          const startStep = Math.max(1, Math.round(win.startEveryH * HOUR / step));
          r.scan = windowScan(s, durSteps, startStep, win);
        }
        results.push(r);
      }
      post({ type: 'result', results, dsn: lanes ? tab.dsn : null });
    } else if (m.type === 'years') {
      // Annual statistics for each site across a run of years (one shared ephemeris per year)
      const { sites, opts, year0, years, stepH } = m;
      const out = sites.map(() => ({ sun: new Float32Array(years), earth: new Float32Array(years), both: new Float32Array(years), comms: new Float32Array(years), dark: new Float32Array(years) }));
      for (let k = 0; k < years; k++) {
        post({ type: 'progress', msg: `Year ${year0 + k} (${k + 1}/${years})…` });
        const a = Date.UTC(year0 + k, 0, 1), b = Date.UTC(year0 + k + 1, 0, 1), step = stepH * HOUR;
        const tab = ephemTable(a, step, Math.round((b - a) / step), opts.relay);
        sites.forEach((site, i) => {
          const x = summarize(siteSeries(site, tab, opts), opts);
          out[i].sun[k] = x.sunPct; out[i].earth[k] = x.earthPct; out[i].both[k] = x.bothPct; out[i].comms[k] = x.commsPct; out[i].dark[k] = x.longestDarkH;
        });
      }
      post({ type: 'result', results: sites.map((s, i) => ({ id: s.id, ...out[i] })) });
    } else if (m.type === 'horizon') {
      await ensureTerrain(m.base, m.meta, m.lat, m.lon, post, m.nearKm);
      const { hz, h0 } = computeHorizon(m.lat, m.lon, m.mast || 2, post);
      post({ type: 'result', hz, h0 }, [hz.buffer]);
    } else {
      throw new Error('Unknown job type: ' + m.type);
    }
  } catch (e) {
    post({ type: 'error', msg: e.message || String(e) });
  }
}
