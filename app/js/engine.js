// Visibility, power and communications engine. Pure functions over typed arrays, shared by the UI thread and the worker.
import { ephem, siteFrame, topo, stationMoonElevation, DSN, earthPhase, diskFraction, AU_KM, SUN_R_KM, EARTH_R_KM, R2D } from './astro.js';

export const HOUR = 3600000;
export const DAY = 86400000;
export const SOLAR_CONSTANT = 1361; // W/m² at 1 AU

export const DEFAULTS = {
  sunMinFrac: 0.5,      // fraction of solar disk that must be visible to count as "lit"
  earthMarginDeg: 0,    // Earth center must clear terrain by this margin for DTE
  dsnMinEl: 10,         // DSN antenna elevation mask (deg)
  requireDSN: true,     // DTE needs a DSN station to see the Moon
  panel: 'vtrack',      // vtrack | horizontal | vfixed
  panelAz: 0,           // for vfixed
  panelArea: 2,         // m²
  panelEff: 0.29,       // conversion efficiency
  loadW: 100,           // constant platform load (W)
  batteryWh: 3000,      // usable capacity (Wh)
};

/** Decode base64 int16 centi-degree horizon to Float32Array(720) */
export function decodeHorizon(b64) {
  if (!b64) return null;
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const buf = new ArrayBuffer(bin.length);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(buf);
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 100;
  return out;
}

export function encodeHorizon(hz) {
  const i16 = new Int16Array(hz.length);
  for (let i = 0; i < hz.length; i++) i16[i] = Math.round(hz[i] * 100);
  const u8 = new Uint8Array(i16.buffer);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

/** Horizon elevation at azimuth (deg), linear interpolation on a uniform azimuth grid */
export function horizonAt(hz, az) {
  if (!hz) return 0;
  const n = hz.length;
  const x = ((az % 360) + 360) % 360 * n / 360;
  const i0 = Math.floor(x) % n, i1 = (i0 + 1) % n, f = x - Math.floor(x);
  return hz[i0] * (1 - f) + hz[i1] * f;
}

/**
 * Shared ephemeris table: body-fixed Sun/Earth vectors, DSN elevations, Earth phase.
 * Computed once per time grid and reused for every site.
 */
export function ephemTable(t0, stepMs, n) {
  const sun = new Float64Array(n * 3), earth = new Float64Array(n * 3);
  const dsn = new Float32Array(n * 3), phase = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const e = ephem(t0 + i * stepMs);
    sun[i * 3] = e.sun[0]; sun[i * 3 + 1] = e.sun[1]; sun[i * 3 + 2] = e.sun[2];
    earth[i * 3] = e.earth[0]; earth[i * 3 + 1] = e.earth[1]; earth[i * 3 + 2] = e.earth[2];
    for (let k = 0; k < 3; k++) dsn[i * 3 + k] = stationMoonElevation(e, DSN[k]);
    phase[i] = earthPhase(e);
  }
  return { t0, step: stepMs, n, sun, earth, dsn, phase };
}

/** Per-site time series from a shared ephemeris table */
export function siteSeries(site, tab, opts = DEFAULTS) {
  const { n } = tab;
  const f = siteFrame(site.lat, site.lon, (site.elev_m || 0) + 2);
  const hz = site.hz;
  const o = { ...DEFAULTS, ...opts };
  const s = {
    n, t0: tab.t0, step: tab.step,
    sunAz: new Float32Array(n), sunEl: new Float32Array(n), sunHz: new Float32Array(n), sunFrac: new Float32Array(n),
    earthAz: new Float32Array(n), earthEl: new Float32Array(n), earthHz: new Float32Array(n), earthFrac: new Float32Array(n),
    lit: new Uint8Array(n), earthVis: new Uint8Array(n), dsnAny: new Uint8Array(n), dte: new Uint8Array(n),
    power: new Float32Array(n), soc: new Float32Array(n),
  };
  const v = [0, 0, 0];
  const panelAz = o.panelAz * Math.PI / 180;
  let soc = o.batteryWh;
  const dtH = tab.step / HOUR;
  for (let i = 0; i < n; i++) {
    v[0] = tab.sun[i * 3]; v[1] = tab.sun[i * 3 + 1]; v[2] = tab.sun[i * 3 + 2];
    const ts = topo(f, v);
    const sunR = Math.asin(SUN_R_KM / ts.dist) * R2D;
    const shz = horizonAt(hz, ts.az);
    const sf = diskFraction(ts.el - shz, sunR);
    s.sunAz[i] = ts.az; s.sunEl[i] = ts.el; s.sunHz[i] = shz; s.sunFrac[i] = sf;
    s.lit[i] = sf >= o.sunMinFrac && sf > 0 ? 1 : 0;

    v[0] = tab.earth[i * 3]; v[1] = tab.earth[i * 3 + 1]; v[2] = tab.earth[i * 3 + 2];
    const te = topo(f, v);
    const earthR = Math.asin(EARTH_R_KM / te.dist) * R2D;
    const ehz = horizonAt(hz, te.az);
    s.earthAz[i] = te.az; s.earthEl[i] = te.el; s.earthHz[i] = ehz;
    s.earthFrac[i] = diskFraction(te.el - ehz, earthR);
    s.earthVis[i] = te.el - ehz >= o.earthMarginDeg ? 1 : 0;
    const dsnAny = tab.dsn[i * 3] >= o.dsnMinEl || tab.dsn[i * 3 + 1] >= o.dsnMinEl || tab.dsn[i * 3 + 2] >= o.dsnMinEl;
    s.dsnAny[i] = dsnAny ? 1 : 0;
    s.dte[i] = s.earthVis[i] && (dsnAny || !o.requireDSN) ? 1 : 0;

    // Solar power
    const flux = SOLAR_CONSTANT * (AU_KM / ts.dist) ** 2;
    const elR = ts.el * Math.PI / 180;
    let inc = 0;
    if (o.panel === 'horizontal') inc = Math.max(0, Math.sin(elR));
    else if (o.panel === 'vfixed') inc = Math.max(0, Math.cos(elR) * Math.cos(ts.az * Math.PI / 180 - panelAz));
    else inc = Math.max(0, Math.cos(elR));
    const p = flux * o.panelArea * o.panelEff * inc * sf;
    s.power[i] = p;
    soc = Math.min(o.batteryWh, Math.max(0, soc + (p - o.loadW) * dtH));
    s.soc[i] = soc;
  }
  return s;
}

/** Longest run of `val` in a Uint8Array; returns {len, start, open} (open = touches an edge of the window) */
export function longestRun(arr, val, from = 0, to = arr.length) {
  let best = 0, bestStart = -1, cur = 0, curStart = from, bestOpen = false;
  for (let i = from; i < to; i++) {
    if (arr[i] === val) {
      if (cur === 0) curStart = i;
      cur++;
      if (cur > best) { best = cur; bestStart = curStart; bestOpen = curStart === from || i === to - 1; }
    } else cur = 0;
  }
  return { len: best, start: bestStart, open: bestOpen };
}

function mean(a, from = 0, to = a.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i];
  return to > from ? s / (to - from) : 0;
}

function countRuns(arr, val) {
  let c = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] === val && (i === 0 || arr[i - 1] !== val)) c++;
  return c;
}

/** Summary statistics for a site series */
export function summarize(s, opts = DEFAULTS) {
  const o = { ...DEFAULTS, ...opts };
  const h = s.step / HOUR;
  const both = new Uint8Array(s.n);
  for (let i = 0; i < s.n; i++) both[i] = s.lit[i] & s.earthVis[i];
  const dark = longestRun(s.lit, 0), noEarth = longestRun(s.earthVis, 0), noDte = longestRun(s.dte, 0);
  let minSoc = Infinity, depleted = 0, maxSunEl = -90, minSunEl = 90, maxEarthEl = -90, minEarthEl = 90, pk = 0;
  for (let i = 0; i < s.n; i++) {
    if (s.soc[i] < minSoc) minSoc = s.soc[i];
    if (s.soc[i] <= 0) depleted++;
    if (s.sunEl[i] > maxSunEl) maxSunEl = s.sunEl[i];
    if (s.sunEl[i] < minSunEl) minSunEl = s.sunEl[i];
    if (s.earthEl[i] > maxEarthEl) maxEarthEl = s.earthEl[i];
    if (s.earthEl[i] < minEarthEl) minEarthEl = s.earthEl[i];
    if (s.power[i] > pk) pk = s.power[i];
  }
  const meanP = mean(s.power);
  return {
    sunPct: mean(s.lit) * 100,
    sunEnergyPct: mean(s.sunFrac) * 100,
    earthPct: mean(s.earthVis) * 100,
    dtePct: mean(s.dte) * 100,
    bothPct: mean(both) * 100,
    dsnPct: mean(s.dsnAny) * 100,
    longestDarkH: dark.len * h, longestDarkOpen: dark.open,
    longestNoEarthH: noEarth.len * h, longestNoEarthOpen: noEarth.open,
    longestNoDteH: noDte.len * h,
    darkPeriods: countRuns(s.lit, 0),
    meanPowerW: meanP, peakPowerW: pk,
    energyPerDayWh: meanP * 24,
    minSocPct: o.batteryWh > 0 ? (minSoc / o.batteryWh) * 100 : 0,
    depletedH: depleted * h,
    maxSunEl, minSunEl, maxEarthEl, minEarthEl,
    hours: s.n * h,
  };
}

/** Transition events (rise/set) for a flag array */
export function events(flag, t0, step) {
  const ev = [];
  for (let i = 1; i < flag.length; i++) {
    if (flag[i] !== flag[i - 1]) ev.push({ t: t0 + i * step, on: !!flag[i] });
  }
  return ev;
}

/**
 * Landing-window search. For each candidate start (every `startStep` samples) evaluate a mission of `durSteps`.
 * Returns Float32 arrays: score (0..100, -1 infeasible) and components, for the calendar and ranking.
 */
export function windowScan(s, durSteps, startStep, c) {
  const h = s.step / HOUR;
  const nStarts = Math.max(0, Math.floor((s.n - durSteps) / startStep) + 1);
  // prefix sums
  const pl = new Float64Array(s.n + 1), pe = new Float64Array(s.n + 1), pd = new Float64Array(s.n + 1), pp = new Float64Array(s.n + 1);
  for (let i = 0; i < s.n; i++) {
    pl[i + 1] = pl[i] + s.lit[i]; pe[i + 1] = pe[i] + s.earthVis[i]; pd[i + 1] = pd[i] + s.dte[i]; pp[i + 1] = pp[i] + s.power[i];
  }
  // run lengths ending at i (dark) to compute max gap inside a window in O(window) worst case but typically fast
  const out = {
    n: nStarts, startStep, durSteps,
    score: new Float32Array(nStarts), lit: new Float32Array(nStarts), earth: new Float32Array(nStarts), dte: new Float32Array(nStarts),
    maxDarkH: new Float32Array(nStarts), maxNoCommH: new Float32Array(nStarts), meanPowerW: new Float32Array(nStarts),
    landOk: new Uint8Array(nStarts), fail: new Uint8Array(nStarts), minClear: new Float32Array(nStarts),
  };
  const commFlag = c.useDSN ? s.dte : s.earthVis;
  for (let k = 0; k < nStarts; k++) {
    const a = k * startStep, b = a + durSteps;
    const lit = (pl[b] - pl[a]) / durSteps, ear = (pe[b] - pe[a]) / durSteps, dte = (pd[b] - pd[a]) / durSteps;
    const dk = longestRun(s.lit, 0, a, b).len * h;
    const nc = longestRun(commFlag, 0, a, b).len * h;
    const landOk = s.lit[a] && s.earthVis[a] && s.sunEl[a] >= c.landSunMin && s.sunEl[a] <= c.landSunMax ? 1 : 0;
    const comm = c.useDSN ? dte : ear;
    let fail = 0;
    if (lit * 100 < c.minLitPct) fail |= 1;
    if (dk > c.maxDarkH) fail |= 2;
    if (comm * 100 < c.minCommPct) fail |= 4;
    if (nc > c.maxNoCommH) fail |= 8;
    if (c.requireLanding && !landOk) fail |= 16;
    // Minimum Sun clearance above terrain during the stay: margin against timing slips and terrain-model error
    let mc = Infinity;
    for (let i = a; i < b; i++) { const v = s.sunEl[i] - s.sunHz[i]; if (v < mc) mc = v; }
    const clearTerm = Math.max(0, Math.min(1, (mc + 0.5) / 2));
    const q = 0.35 * lit + 0.3 * comm + 0.15 * Math.max(0, 1 - dk / Math.max(1, s.n * h / 10)) + 0.2 * clearTerm;
    out.minClear[k] = mc;
    out.score[k] = fail ? -1 : q * 100;
    out.lit[k] = lit * 100; out.earth[k] = ear * 100; out.dte[k] = dte * 100;
    out.maxDarkH[k] = dk; out.maxNoCommH[k] = nc; out.meanPowerW[k] = (pp[b] - pp[a]) / durSteps;
    out.landOk[k] = landOk; out.fail[k] = fail;
  }
  return out;
}

/** Instantaneous geometry for the explorer (single timestamp, full precision) */
export function snapshot(site, ms, opts = DEFAULTS) {
  const e = ephem(ms);
  const f = siteFrame(site.lat, site.lon, (site.elev_m || 0) + 2);
  const o = { ...DEFAULTS, ...opts };
  const ts = topo(f, e.sun), te = topo(f, e.earth);
  const sunR = Math.asin(SUN_R_KM / ts.dist) * R2D, earthR = Math.asin(EARTH_R_KM / te.dist) * R2D;
  const shz = horizonAt(site.hz, ts.az), ehz = horizonAt(site.hz, te.az);
  const dsn = DSN.map((st) => ({ ...st, el: stationMoonElevation(e, st) }));
  const sunFrac = diskFraction(ts.el - shz, sunR);
  const earthFrac = diskFraction(te.el - ehz, earthR);
  const flux = SOLAR_CONSTANT * (AU_KM / ts.dist) ** 2;
  const elR = ts.el * Math.PI / 180;
  let inc = o.panel === 'horizontal' ? Math.max(0, Math.sin(elR))
    : o.panel === 'vfixed' ? Math.max(0, Math.cos(elR) * Math.cos((ts.az - o.panelAz) * Math.PI / 180))
      : Math.max(0, Math.cos(elR));
  return {
    t: ms,
    sun: { az: ts.az, el: ts.el, hz: shz, r: sunR, frac: sunFrac, dist: ts.dist, flux },
    earth: { az: te.az, el: te.el, hz: ehz, r: earthR, frac: earthFrac, dist: te.dist, phase: earthPhase(e) },
    dsn,
    power: flux * o.panelArea * o.panelEff * inc * sunFrac,
    lit: sunFrac >= o.sunMinFrac && sunFrac > 0,
    earthVis: te.el - ehz >= o.earthMarginDeg,
  };
}
