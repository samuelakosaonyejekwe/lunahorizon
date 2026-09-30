// Background computations: multi-site scans (compare + planner) and terrain horizons for custom sites.
import { ephemTable, siteSeries, summarize, windowScan, HOUR, DAY } from './engine.js';

const R_M = 1737400;
let dems = null;
let curId = 0;

async function loadDem(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('DEM download failed: ' + res.status);
  let buf;
  if ('DecompressionStream' in self) {
    buf = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  } else throw new Error('This browser cannot decompress terrain data (DecompressionStream missing).');
  return new Int16Array(buf);
}

async function ensureDems(base, meta) {
  if (dems) return dems;
  post({ type: 'progress', id: curId, msg: 'Downloading LOLA terrain…' });
  const [near, far] = await Promise.all([loadDem(base + 'data/dem_near.bin.gz'), loadDem(base + 'data/dem_far.bin.gz')]);
  dems = [{ a: near, ...meta.dem_near }, { a: far, ...meta.dem_far }];
  return dems;
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
  const h = demSample(dems[0], x, y);
  return Number.isNaN(h) ? demSample(dems[1], x, y) : h;
}

function llToXY(lat, lon) {
  const rho = 2 * R_M * Math.tan(Math.PI / 4 + lat / 2);
  return [rho * Math.sin(lon), rho * Math.cos(lon)];
}

/** Terrain horizon (0.5° bins) for a site; mast height in meters. */
function computeHorizon(latDeg, lonDeg, mast) {
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
    let best = -5;
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
    if (k % 180 === 0) post({ type: 'progress', id: curId, msg: `Tracing terrain horizon… ${Math.round(k / NR * 100)}%` });
  }
  const hz = new Float32Array(720);
  for (let k = 0; k < 720; k++) hz[k] = Math.max(rays[(2 * k - 1 + NR) % NR], rays[2 * k], rays[2 * k + 1]);
  return { hz, h0 };
}

function dailyAgg(s, t0, stepMs) {
  const perDay = Math.round(DAY / stepMs);
  const nd = Math.floor(s.n / perDay);
  const lit = new Float32Array(nd), earth = new Float32Array(nd), dte = new Float32Array(nd), both = new Float32Array(nd), power = new Float32Array(nd);
  for (let d = 0; d < nd; d++) {
    let a = 0, b = 0, c = 0, e = 0, p = 0;
    for (let i = d * perDay; i < (d + 1) * perDay; i++) {
      a += s.lit[i]; b += s.earthVis[i]; c += s.comms[i]; e += s.lit[i] & s.earthVis[i]; p += s.power[i];
    }
    lit[d] = a / perDay * 100; earth[d] = b / perDay * 100; dte[d] = c / perDay * 100; both[d] = e / perDay * 100; power[d] = p / perDay;
  }
  return { nd, lit, earth, dte, both, power };
}

const post = (m, t) => self.postMessage(m, t || []);

self.onmessage = async (ev) => {
  const m = ev.data;
  curId = m.id;
  try {
    if (m.type === 'scan') {
      const { t0, step, n, sites, opts, window: win, lanes } = m;
      post({ type: 'progress', id: m.id, msg: 'Computing Sun & Earth ephemeris…' });
      const tab = ephemTable(t0, step, n, opts.relay);
      const results = [];
      for (let i = 0; i < sites.length; i++) {
        post({ type: 'progress', id: m.id, msg: `Analyzing ${sites[i].name} (${i + 1}/${sites.length})…` });
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
      post({ type: 'result', id: m.id, results, dsn: lanes ? tab.dsn : null });
    } else if (m.type === 'years') {
      // Annual statistics for each site across a run of years (one shared ephemeris per year)
      const { sites, opts, year0, years, stepH } = m;
      const out = sites.map(() => ({ sun: new Float32Array(years), earth: new Float32Array(years), both: new Float32Array(years), comms: new Float32Array(years), dark: new Float32Array(years) }));
      for (let k = 0; k < years; k++) {
        post({ type: 'progress', id: m.id, msg: `Year ${year0 + k} (${k + 1}/${years})…` });
        const a = Date.UTC(year0 + k, 0, 1), b = Date.UTC(year0 + k + 1, 0, 1), step = stepH * HOUR;
        const tab = ephemTable(a, step, Math.round((b - a) / step), opts.relay);
        sites.forEach((site, i) => {
          const x = summarize(siteSeries(site, tab, opts), opts);
          out[i].sun[k] = x.sunPct; out[i].earth[k] = x.earthPct; out[i].both[k] = x.bothPct; out[i].comms[k] = x.commsPct; out[i].dark[k] = x.longestDarkH;
        });
      }
      post({ type: 'result', id: m.id, results: sites.map((s, i) => ({ id: s.id, ...out[i] })) });
    } else if (m.type === 'horizon') {
      await ensureDems(m.base, m.meta);
      const { hz, h0 } = computeHorizon(m.lat, m.lon, m.mast || 2);
      post({ type: 'result', id: m.id, hz, h0 }, [hz.buffer]);
    } else if (m.type === 'height') {
      await ensureDems(m.base, m.meta);
      const [x, y] = llToXY(m.lat * Math.PI / 180, m.lon * Math.PI / 180);
      post({ type: 'result', id: m.id, h: heightAt(x, y) });
    }
  } catch (e) {
    post({ type: 'error', id: m.id, msg: e.message || String(e) });
  }
};
