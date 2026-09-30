// Multi-year screening maps across one full 18.6-year lunar nodal cycle (2026–2044).
// Each 1 km cell's terrain horizon is traced ONCE, then Sun/Earth visibility is evaluated for every year.
// Usage: node tools/overlay_years.mjs  → raw/overlay_years.bin (uint8 [year][row][col][R,G,B]) + raw/overlay_years.json
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ephem, siteFrame, topo } from '../app/js/astro.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const R_M = 1737400;
const HALF = 200e3, CELL = 1000, N = Math.round(2 * HALF / CELL);
const NR = 180, ND = 260, DMIN = 150, DMAX = 200e3;
const Y0 = 2026, NY = 19, STEP_H = 6;

const G = { n: 3812, off: 1905.5, scale: 240 };
function height(a, x, y) {
  const s = G.off + x / G.scale, l = G.off - y / G.scale;
  if (s < 0 || l < 0 || s >= G.n - 1 || l >= G.n - 1) return NaN;
  const s0 = s | 0, l0 = l | 0, fs_ = s - s0, fl = l - l0, n = G.n;
  return 0.5 * (a[l0 * n + s0] * (1 - fs_) * (1 - fl) + a[l0 * n + s0 + 1] * fs_ * (1 - fl) + a[(l0 + 1) * n + s0] * (1 - fs_) * fl + a[(l0 + 1) * n + s0 + 1] * fs_ * fl);
}
const xyToLL = (x, y) => [(2 * Math.atan(Math.hypot(x, y) / (2 * R_M)) - Math.PI / 2) * 180 / Math.PI, Math.atan2(x, y) * 180 / Math.PI];

if (isMainThread) {
  const t = Date.now();
  // Per-year ephemeris grids (each year starts on Jan 1 UTC; steps per year differ in leap years)
  const years = [];
  for (let k = 0; k < NY; k++) {
    const a = Date.UTC(Y0 + k, 0, 1), b = Date.UTC(Y0 + k + 1, 0, 1);
    const nT = Math.round((b - a) / (STEP_H * 3600e3));
    const sun = new Float64Array(nT * 3), earth = new Float64Array(nT * 3);
    for (let i = 0; i < nT; i++) { const e = ephem(a + i * STEP_H * 3600e3); sun.set(e.sun, i * 3); earth.set(e.earth, i * 3); }
    years.push({ year: Y0 + k, nT, sun, earth });
  }
  console.log('ephemeris ready', ((Date.now() - t) / 1000).toFixed(1), 's');
  const nW = Math.max(1, os.cpus().length);
  const out = new Uint8Array(NY * N * N * 3);
  let done = 0;
  await Promise.all(Array.from({ length: nW }, (_, w) => new Promise((res, rej) => {
    const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { w, nW, years } });
    wk.on('message', (m) => {
      for (let k = 0; k < NY; k++) out.set(m.data.subarray(k * N * 3, (k + 1) * N * 3), (k * N * N + m.row * N) * 3);
      if (++done % 10 === 0) console.log(`rows ${done}/${N}  ${((Date.now() - t) / 1000).toFixed(0)} s`);
    });
    wk.on('error', rej); wk.on('exit', res);
  })));
  fs.writeFileSync(ROOT + 'raw/overlay_years.bin', out);
  fs.writeFileSync(ROOT + 'raw/overlay_years.json', JSON.stringify({ half_m: HALF, cell: CELL, n: N, year0: Y0, years: NY, step_h: STEP_H, rays: NR }));
  console.log('done in', ((Date.now() - t) / 1000).toFixed(0), 's');
} else {
  const { w, nW, years } = workerData;
  const buf = fs.readFileSync(ROOT + 'raw/ldem_75s_240m.img');
  const dem = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  const d = new Float64Array(ND), cd = new Float64Array(ND), sd = new Float64Array(ND);
  for (let j = 0; j < ND; j++) { d[j] = DMIN * Math.pow(DMAX / DMIN, j / (ND - 1)); cd[j] = Math.cos(d[j] / R_M); sd[j] = Math.sin(d[j] / R_M); }
  const hz = new Float32Array(NR);
  const v = [0, 0, 0];
  const hzAt = (a) => { const x = a / (360 / NR), i0 = Math.floor(x) % NR, i1 = (i0 + 1) % NR, fr = x - Math.floor(x); return hz[i0] * (1 - fr) + hz[i1] * fr; };
  for (let r = w; r < N; r += nW) {
    const row = new Uint8Array(NY * N * 3);
    const y0 = HALF - (r + 0.5) * CELL;
    for (let c = 0; c < N; c++) {
      const x0 = -HALF + (c + 0.5) * CELL;
      const h0 = height(dem, x0, y0);
      if (Number.isNaN(h0)) continue;
      const r1 = R_M + h0 + 2;
      const rho = Math.hypot(x0, y0);
      const nx = x0 / rho, ny = y0 / rho, ex = ny, ey = -nx;
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
      for (let k = 0; k < years.length; k++) {
        const Y = years[k];
        let ns = 0, ne = 0, nb = 0;
        for (let i = 0; i < Y.nT; i++) {
          v[0] = Y.sun[i * 3]; v[1] = Y.sun[i * 3 + 1]; v[2] = Y.sun[i * 3 + 2];
          const s = topo(f, v);
          const sOn = s.el - hzAt(s.az) > 0;
          v[0] = Y.earth[i * 3]; v[1] = Y.earth[i * 3 + 1]; v[2] = Y.earth[i * 3 + 2];
          const e = topo(f, v);
          const eOn = e.el - hzAt(e.az) > 0;
          ns += sOn; ne += eOn; nb += sOn && eOn;
        }
        const o = (k * N + c) * 3;
        row[o] = Math.round(ns / Y.nT * 255); row[o + 1] = Math.round(ne / Y.nT * 255); row[o + 2] = Math.round(nb / Y.nT * 255);
      }
    }
    parentPort.postMessage({ row: r, data: row }, [row.buffer]);
  }
}
