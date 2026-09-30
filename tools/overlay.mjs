// Computes the yearly sunlight / Earth-visibility screening maps on a 1 km grid, in parallel.
// Usage: node tools/overlay.mjs   → raw/overlay_rgb.bin (uint8 RGB, row-major, row 0 = +y) + raw/overlay.json
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ephem, siteFrame, topo, SUN_R_KM, EARTH_R_KM } from '../app/js/astro.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const R_M = 1737400;
const HALF = 200e3, CELL = 1000, N = Math.round(2 * HALF / CELL);
const NR = 180, ND = 260, DMIN = 150, DMAX = 200e3;
const YEAR = 2027, STEP_H = 4;

function loadDem() {
  const buf = fs.readFileSync(ROOT + 'raw/ldem_75s_240m.img');
  return new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
}
const G = { n: 3812, off: 1905.5, scale: 240 };
function height(a, x, y) {
  const s = G.off + x / G.scale, l = G.off - y / G.scale;
  if (s < 0 || l < 0 || s >= G.n - 1 || l >= G.n - 1) return NaN;
  const s0 = s | 0, l0 = l | 0, fs_ = s - s0, fl = l - l0, n = G.n;
  return 0.5 * (a[l0 * n + s0] * (1 - fs_) * (1 - fl) + a[l0 * n + s0 + 1] * fs_ * (1 - fl) + a[(l0 + 1) * n + s0] * (1 - fs_) * fl + a[(l0 + 1) * n + s0 + 1] * fs_ * fl);
}
const xyToLL = (x, y) => [(2 * Math.atan(Math.hypot(x, y) / (2 * R_M)) - Math.PI / 2) * 180 / Math.PI, Math.atan2(x, y) * 180 / Math.PI];

function ephemGrid() {
  const t0 = Date.UTC(YEAR, 0, 1), nT = Math.round(365 * 24 / STEP_H);
  const sun = new Float64Array(nT * 3), earth = new Float64Array(nT * 3);
  for (let i = 0; i < nT; i++) {
    const e = ephem(t0 + i * STEP_H * 3600e3);
    sun.set(e.sun, i * 3); earth.set(e.earth, i * 3);
  }
  return { nT, sun, earth };
}

if (isMainThread) {
  const t = Date.now();
  const eg = ephemGrid();
  const nW = Math.max(1, os.cpus().length);
  const out = new Uint8Array(N * N * 3);
  let done = 0;
  await Promise.all(Array.from({ length: nW }, (_, w) => new Promise((res, rej) => {
    const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { w, nW, eg } });
    wk.on('message', (m) => {
      if (m.row != null) { out.set(m.data, m.row * N * 3); if (++done % 20 === 0) console.log(`rows ${done}/${N}  ${((Date.now() - t) / 1000).toFixed(0)} s`); }
    });
    wk.on('error', rej); wk.on('exit', res);
  })));
  fs.writeFileSync(ROOT + 'raw/overlay_rgb.bin', out);
  fs.writeFileSync(ROOT + 'raw/overlay.json', JSON.stringify({ half_m: HALF, cell: CELL, n: N, year: YEAR, step_h: STEP_H, rays: NR }));
  console.log('done in', ((Date.now() - t) / 1000).toFixed(0), 's');
} else {
  const { w, nW, eg } = workerData;
  const dem = loadDem();
  const d = new Float64Array(ND), cd = new Float64Array(ND), sd = new Float64Array(ND);
  for (let j = 0; j < ND; j++) { d[j] = DMIN * Math.pow(DMAX / DMIN, j / (ND - 1)); cd[j] = Math.cos(d[j] / R_M); sd[j] = Math.sin(d[j] / R_M); }
  const hz = new Float32Array(NR);
  const v = [0, 0, 0];
  for (let r = w; r < N; r += nW) {
    const row = new Uint8Array(N * 3);
    const y0 = HALF - (r + 0.5) * CELL;
    for (let c = 0; c < N; c++) {
      const x0 = -HALF + (c + 0.5) * CELL;
      const h0 = height(dem, x0, y0);
      if (Number.isNaN(h0)) continue;
      const r1 = R_M + h0 + 2;
      const rho = Math.hypot(x0, y0);
      const nx = x0 / rho, ny = y0 / rho;      // map direction of local north (away from the pole)
      const ex = ny, ey = -nx;                 // local east
      for (let k = 0; k < NR; k++) {
        const az = k * 2 * Math.PI / NR, ca = Math.cos(az), sa = Math.sin(az);
        const ux = nx * ca + ex * sa, uy = ny * ca + ey * sa;
        let best = -1e9;
        for (let j = 0; j < ND; j++) {
          const hh = height(dem, x0 + d[j] * ux, y0 + d[j] * uy);
          if (hh !== hh) break;
          const r2 = R_M + hh;
          const tn = (r2 * cd[j] - r1) / (r2 * sd[j]);
          if (tn > best) best = tn;
        }
        hz[k] = best > -1e8 ? Math.atan(best) * 180 / Math.PI : -5;
      }
      const [lat, lon] = xyToLL(x0, y0);
      const f = siteFrame(lat, lon, h0 + 2);
      let ns = 0, ne = 0, nb = 0;
      const hzAt = (a) => { const x = a / (360 / NR), i0 = Math.floor(x) % NR, i1 = (i0 + 1) % NR, fr = x - Math.floor(x); return hz[i0] * (1 - fr) + hz[i1] * fr; };
      for (let i = 0; i < eg.nT; i++) {
        v[0] = eg.sun[i * 3]; v[1] = eg.sun[i * 3 + 1]; v[2] = eg.sun[i * 3 + 2];
        const s = topo(f, v);
        const sOn = s.el - hzAt(s.az) > 0;
        v[0] = eg.earth[i * 3]; v[1] = eg.earth[i * 3 + 1]; v[2] = eg.earth[i * 3 + 2];
        const e = topo(f, v);
        const eOn = e.el - hzAt(e.az) > 0;
        ns += sOn; ne += eOn; nb += sOn && eOn;
      }
      row[c * 3] = Math.round(ns / eg.nT * 255); row[c * 3 + 1] = Math.round(ne / eg.nT * 255); row[c * 3 + 2] = Math.round(nb / eg.nT * 255);
    }
    parentPort.postMessage({ row: r, data: row });
  }
}
