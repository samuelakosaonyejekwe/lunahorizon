// Canvas renderers: horizon panorama, sky plot, multi-lane timeline, swimlanes, calendar heatmap.
import { h, cssVar, fmtTime, fmtShortDate, compass, fmtDeg, fmtPct, settings, MONTHS } from './ui.js';
import { horizonAt } from './engine.js';

/** Create a DPR-aware canvas inside a container. draw(ctx, w, h) is called on resize. */
export function makeCanvas(container, draw) {
  const cv = h('canvas');
  container.append(cv);
  const ctx = cv.getContext('2d');
  let w = 0, hh = 0, raf = 0;
  const api = {
    cv, ctx,
    get w() { return w; }, get h() { return hh; },
    redraw() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = container.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        w = Math.max(10, r.width); hh = Math.max(10, r.height);
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) {
          cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, hh);
        draw(ctx, w, hh);
      });
    },
    destroy() { ro.disconnect(); cancelAnimationFrame(raf); window.removeEventListener('themechange', api.redraw); },
  };
  const ro = new ResizeObserver(() => api.redraw());
  ro.observe(container);
  window.addEventListener('themechange', api.redraw);
  return api;
}

export function colors() {
  return {
    sun: cssVar('--sun'), earth: cssVar('--earth'), both: cssVar('--both'), dsn: cssVar('--dsn'),
    text: cssVar('--text'), text2: cssVar('--text-2'), text3: cssVar('--text-3'), grid: cssVar('--grid'),
    surface: cssVar('--surface'), surface2: cssVar('--surface-2'), surface3: cssVar('--surface-3'), border: cssVar('--border'), accent: cssVar('--accent'),
    bad: cssVar('--bad'), good: cssVar('--good'),
  };
}
const FONT = (px, w = 500) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const SUN_GLOW = '#ffd46b';

function niceStep(range, target) {
  const raw = range / Math.max(1, target);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}

// Deterministic star field
const STARS = Array.from({ length: 260 }, (_, i) => {
  const x = Math.sin(i * 12.9898) * 43758.5453, y = Math.sin(i * 78.233) * 12543.123, z = Math.sin(i * 3.14) * 9321.7;
  return [x - Math.floor(x), y - Math.floor(y), 0.25 + (z - Math.floor(z)) * 0.75];
});

/** Draw an Earth disk with phase shading. k = illuminated fraction, ang = direction to Sun on screen (rad) */
function drawEarth(ctx, x, y, r, k, ang, col) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#10213d'; ctx.fill();
  // lit part: half disk toward +x plus/minus terminator ellipse
  ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
  const ex = r * Math.abs(1 - 2 * k);
  ctx.ellipse(0, 0, ex, r, 0, Math.PI / 2, -Math.PI / 2, k < 0.5);
  const g = ctx.createRadialGradient(r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#9fd0ff'); g.addColorStop(0.6, col); g.addColorStop(1, '#1b4f9a');
  ctx.fillStyle = g; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(160,200,255,.55)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}

function drawSun(ctx, x, y, r) {
  const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 4);
  g.addColorStop(0, 'rgba(255,220,130,.55)'); g.addColorStop(1, 'rgba(255,200,80,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff4d6'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = SUN_GLOW; ctx.lineWidth = 1.5; ctx.stroke();
}

/**
 * Horizon panorama. state = { hz, snap, sunTrack, earthTrack, center, zoom, trackLabel }
 * Tracks: {az: Float32Array, el: Float32Array, n}
 */
export function panorama(container, getState, onHover) {
  const tip = h('div.tooltip');
  container.append(tip);
  let geom = null;
  const api = makeCanvas(container, (ctx, W, H) => {
    const st = getState();
    if (!st || !st.snap) return;
    const { hz, snap } = st;
    const zoom = st.zoom || 1;
    const center = st.center ?? 180;
    const span = 360 / zoom;
    const left = 44, right = 8, top = 22, bottom = 26;
    const pw = W - left - right, ph = H - top - bottom;
    // y range
    let lo = Infinity, hi = -Infinity;
    const consider = (v) => { if (v < lo) lo = v; if (v > hi) hi = v; };
    const inView = (az) => { const d = ((az - center + 540) % 360) - 180; return Math.abs(d) <= span / 2 + 1; };
    if (hz) for (let i = 0; i < hz.length; i++) if (inView(i * 360 / hz.length)) consider(hz[i]);
    for (const tr of [st.sunTrack, st.earthTrack]) if (tr) for (let i = 0; i < tr.n; i += 2) if (inView(tr.az[i]) && tr.el[i] > -6) consider(tr.el[i]);
    consider(snap.sun.el); consider(snap.earth.el); consider(0);
    lo = Math.max(-12, Math.floor(lo - 0.6)); hi = Math.min(90, Math.ceil(hi + 1.2));
    if (hi - lo < 4) { const m = (hi + lo) / 2; lo = m - 2; hi = m + 2; }
    const X = (az) => left + ((((az - center + 540) % 360) - 180) / span + 0.5) * pw;
    const Y = (el) => top + (1 - (el - lo) / (hi - lo)) * ph;
    const pxPerDegX = pw / span, pxPerDegY = ph / (hi - lo);
    geom = { X, Y, lo, hi, left, top, pw, ph, center, span };

    // sky
    const sky = ctx.createLinearGradient(0, top, 0, top + ph);
    sky.addColorStop(0, '#02030a'); sky.addColorStop(1, snap.lit ? '#0d1426' : '#05070f');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    for (const [sx, sy, b] of STARS) {
      ctx.fillStyle = `rgba(220,230,255,${b * 0.6})`;
      ctx.fillRect(left + sx * pw, top + sy * ph, b > 0.8 ? 1.6 : 1, b > 0.8 ? 1.6 : 1);
    }
    // grid
    ctx.font = FONT(11); ctx.textBaseline = 'middle';
    const ys = niceStep(hi - lo, Math.max(3, ph / 45));
    for (let v = Math.ceil(lo / ys) * ys; v <= hi; v += ys) {
      const y = Y(v);
      ctx.strokeStyle = Math.abs(v) < 1e-9 ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.07)';
      ctx.lineWidth = 1; ctx.setLineDash(Math.abs(v) < 1e-9 ? [4, 4] : []);
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + pw, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(210,220,240,.6)'; ctx.textAlign = 'right';
      ctx.fillText(`${+v.toFixed(2)}°`, left - 6, y);
    }
    const azStep = span > 240 ? 45 : span > 120 ? 30 : span > 60 ? 15 : span > 20 ? 5 : 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let a = 0; a < 360; a += azStep) {
      if (!inView(a)) continue;
      const x = X(a);
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + ph); ctx.stroke();
      const lab = a % 90 === 0 ? ['N', 'E', 'S', 'W'][a / 90] : `${a}°`;
      ctx.fillStyle = a % 90 === 0 ? '#fff' : 'rgba(210,220,240,.6)';
      ctx.font = FONT(a % 90 === 0 ? 12 : 11, a % 90 === 0 ? 700 : 500);
      ctx.fillText(lab, x, top + ph + 6);
    }

    // tracks (behind terrain)
    const drawTrack = (tr, col, dash) => {
      if (!tr) return;
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.setLineDash(dash); ctx.globalAlpha = 0.85;
      ctx.beginPath();
      let prevX = null;
      for (let i = 0; i < tr.n; i++) {
        const x = X(tr.az[i]), y = Y(tr.el[i]);
        if (prevX === null || Math.abs(x - prevX) > pw / 2) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        prevX = x;
      }
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    };
    drawTrack(st.sunTrack, SUN_GLOW, [2, 3]);
    drawTrack(st.earthTrack, '#7fb6ff', [5, 3]);

    // bodies (drawn at true angular size, with a minimum)
    const sunR = Math.max(5, snap.sun.r * Math.min(pxPerDegX, pxPerDegY) * 1);
    const earthR = Math.max(7, snap.earth.r * Math.min(pxPerDegX, pxPerDegY));
    const sx = X(snap.sun.az), sy = Y(snap.sun.el), ex = X(snap.earth.az), ey = Y(snap.earth.el);
    if (inView(snap.sun.az)) drawSun(ctx, sx, sy, sunR);
    if (inView(snap.earth.az)) {
      let dx = sx - ex; if (Math.abs(dx) > pw / 2) dx -= Math.sign(dx) * pw * (360 / span);
      drawEarth(ctx, ex, ey, earthR, snap.earth.phase, Math.atan2(sy - ey, dx), cssVar('--earth') || '#3987e5');
    }

    // terrain
    ctx.beginPath();
    const N = Math.min(1440, Math.ceil(pw));
    for (let i = 0; i <= N; i++) {
      const az = center - span / 2 + (i / N) * span;
      const e = hz ? horizonAt(hz, az) : 0;
      const x = left + (i / N) * pw, y = Y(e);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.lineTo(left + pw, top + ph + 1); ctx.lineTo(left, top + ph + 1); ctx.closePath();
    const lit = snap.lit;
    const tg = ctx.createLinearGradient(0, top, 0, top + ph);
    tg.addColorStop(0, lit ? '#8d8a82' : '#3a3d47'); tg.addColorStop(1, lit ? '#3b3a37' : '#15171d');
    ctx.fillStyle = tg; ctx.fill();
    ctx.strokeStyle = lit ? '#d9d2c0' : '#6a7080'; ctx.lineWidth = 1.2; ctx.stroke();

    // hidden-body markers
    ctx.font = FONT(11, 700); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const marker = (b, col, name) => {
      if (!inView(b.az)) return;
      const x = X(b.az), yH = Y(b.hz);
      if (b.frac >= 1) return;
      ctx.fillStyle = col; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
      const txt = b.frac > 0 ? `${name} ${Math.round(b.frac * 100)}% visible` : `${name} ${fmtDeg(b.hz - b.el)} below terrain`;
      ctx.strokeText(txt, x, Math.max(top + 14, yH - 16)); ctx.fillText(txt, x, Math.max(top + 14, yH - 16));
    };
    marker(snap.sun, SUN_GLOW, 'Sun');
    marker(snap.earth, '#9fc9ff', 'Earth');

    // frame labels
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = FONT(11, 600); ctx.fillStyle = 'rgba(210,220,240,.75)';
    const exag = pxPerDegY / pxPerDegX;
    ctx.fillText(`Vertical exaggeration ×${exag >= 10 ? Math.round(exag) : exag.toFixed(1)}${hz ? '' : ' · smooth horizon (no polar DEM)'}`, left + 4, 4);
    if (st.trackLabel) { ctx.textAlign = 'right'; ctx.fillText(st.trackLabel, left + pw - 4, 4); }
  });

  // interaction: drag to pan, wheel/pinch to zoom, hover readout
  let drag = null;
  const pts = new Map();
  const cv = api.cv;
  cv.style.touchAction = 'pan-y';
  cv.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, e.clientX);
    cv.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, c: getState().center ?? 180, z: getState().zoom || 1, d0: pts.size === 2 ? Math.abs([...pts.values()][0] - [...pts.values()][1]) : 0 };
  });
  cv.addEventListener('pointermove', (e) => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, e.clientX);
    const st = getState();
    if (drag && geom) {
      if (pts.size === 2 && drag.d0 > 0) {
        const d = Math.abs([...pts.values()][0] - [...pts.values()][1]);
        onHover?.({ zoom: Math.max(1, Math.min(24, drag.z * d / drag.d0)) });
      } else if (pts.size === 1) {
        const dAz = -(e.clientX - drag.x) / geom.pw * geom.span;
        onHover?.({ center: (drag.c + dAz + 360) % 360 });
      }
      tip.style.display = 'none';
      return;
    }
    if (!geom || !st) return;
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < geom.left || x > geom.left + geom.pw || y < geom.top || y > geom.top + geom.ph) { tip.style.display = 'none'; return; }
    const az = (geom.center - geom.span / 2 + (x - geom.left) / geom.pw * geom.span + 360) % 360;
    const el = geom.hi - (y - geom.top) / geom.ph * (geom.hi - geom.lo);
    const hzv = st.hz ? horizonAt(st.hz, az) : 0;
    tip.innerHTML = `<b>Az ${az.toFixed(1)}° ${compass(az)}</b><br>Elevation ${el.toFixed(2)}°<br>Terrain horizon ${hzv.toFixed(2)}°`;
    tip.style.display = 'block';
    tip.style.left = Math.min(x + 12, r.width - 170) + 'px'; tip.style.top = Math.max(0, y - 60) + 'px';
  });
  const end = (e) => { pts.delete(e.pointerId); if (pts.size === 0) drag = null; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
  cv.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    e.preventDefault();
    const z = getState().zoom || 1;
    onHover?.({ zoom: Math.max(1, Math.min(24, z * (e.deltaY < 0 ? 1.2 : 1 / 1.2))) });
  }, { passive: false });
  cv.addEventListener('dblclick', () => onHover?.({ zoom: 1, center: 180, reset: true }));
  return api;
}

/** Polar sky plot: zenith at center, horizon at the rim. Radial scale compresses high elevations so polar detail stays visible. */
export function skyplot(container, getState) {
  return makeCanvas(container, (ctx, W, H) => {
    const st = getState();
    if (!st || !st.snap) return;
    const c = colors();
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 22;
    if (R < 20) return;
    const maxEl = st.maxEl ?? 90;
    const minEl = -3;
    const rOf = (el) => R * (1 - (Math.max(minEl, Math.min(maxEl, el)) - minEl) / (maxEl - minEl));
    const P = (az, el) => { const r = rOf(el), a = az * Math.PI / 180; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; };
    ctx.fillStyle = '#03050b'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    // elevation rings
    ctx.font = FONT(10); ctx.fillStyle = 'rgba(210,220,240,.6)'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const step = niceStep(maxEl - minEl, 4);
    for (let e = 0; e <= maxEl; e += step) {
      ctx.strokeStyle = e === 0 ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.1)';
      ctx.beginPath(); ctx.arc(cx, cy, rOf(e), 0, Math.PI * 2); ctx.stroke();
      if (e > 0) ctx.fillText(`${e}°`, cx + 3, cy - rOf(e));
    }
    for (let a = 0; a < 360; a += 30) {
      const [x, y] = P(a, minEl);
      ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
    }
    ctx.fillStyle = c.text2; ctx.font = FONT(12, 700); ctx.textAlign = 'center';
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([l, a]) => { const r = R + 12, t = a * Math.PI / 180; ctx.fillText(l, cx + r * Math.sin(t), cy - r * Math.cos(t)); });
    // terrain mask
    ctx.beginPath();
    for (let i = 0; i <= 360; i++) { const [x, y] = P(i, st.hz ? horizonAt(st.hz, i) : 0); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.arc(cx, cy, R, Math.PI * 2 - Math.PI / 2, -Math.PI / 2, true);
    ctx.fillStyle = st.snap.lit ? 'rgba(141,138,130,.75)' : 'rgba(58,61,71,.85)'; ctx.fill('evenodd');
    // tracks
    const tr = (t, col) => {
      if (!t) return;
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.beginPath();
      for (let i = 0; i < t.n; i++) { const [x, y] = P(t.az[i], t.el[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke(); ctx.setLineDash([]);
    };
    tr(st.sunTrack, SUN_GLOW); tr(st.earthTrack, '#7fb6ff');
    const s = st.snap;
    const [sx, sy] = P(s.sun.az, s.sun.el); drawSun(ctx, sx, sy, 6);
    const [ex, ey] = P(s.earth.az, s.earth.el); drawEarth(ctx, ex, ey, 8, s.earth.phase, Math.atan2(sy - ey, sx - ex), c.earth);
  });
}

/**
 * Multi-lane timeline. cfg.lanes: [{type:'line'|'flag', label, data (Float32Array|Uint8Array), color, min, max, unit, fill, baseline}]
 * series: {t0, step, n}. Cursor at cfg.cursor; onSeek(ms) on click/drag.
 */
export function timeline(container, getCfg, onSeek) {
  const tip = h('div.tooltip');
  container.append(tip);
  let geom = null, hoverX = null;
  const api = makeCanvas(container, (ctx, W, H) => {
    const cfg = getCfg();
    if (!cfg || !cfg.series) return;
    const c = colors();
    const { t0, step, n } = cfg.series;
    const left = W < 520 ? 74 : 108, right = 10, top = 6, bottom = 24;
    const lanes = cfg.lanes;
    const flagH = 14, gap = 6;
    const lineLanes = lanes.filter((l) => l.type === 'line').length;
    const flagTotal = lanes.filter((l) => l.type === 'flag').length * (flagH + 4);
    const avail = H - top - bottom - flagTotal - gap * lanes.length;
    const lineH = Math.max(36, avail / Math.max(1, lineLanes));
    const pw = W - left - right;
    const X = (i) => left + (i / (n - 1)) * pw;
    geom = { left, pw, t0, step, n, top, H, bottom };
    let y = top;
    ctx.font = FONT(11, 600); ctx.textBaseline = 'middle';
    const rows = [];
    for (const L of lanes) {
      if (L.type === 'flag') {
        ctx.fillStyle = c.surface2; ctx.fillRect(left, y, pw, flagH);
        ctx.fillStyle = L.color;
        let runStart = -1;
        for (let i = 0; i <= n; i++) {
          const on = i < n && L.data[i];
          if (on && runStart < 0) runStart = i;
          if (!on && runStart >= 0) { const x0 = X(runStart), x1 = X(Math.min(n - 1, i)); ctx.fillRect(x0, y, Math.max(1, x1 - x0), flagH); runStart = -1; }
        }
        ctx.fillStyle = c.text2; ctx.textAlign = 'right';
        ctx.fillText(L.label, left - 8, y + flagH / 2);
        rows.push({ L, y0: y, y1: y + flagH });
        y += flagH + 4 + gap;
      } else {
        const lh = lineH;
        let mn = L.min, mx = L.max;
        if (mn == null || mx == null) {
          let a = Infinity, b = -Infinity;
          for (let i = 0; i < n; i++) { const v = L.data[i]; if (v < a) a = v; if (v > b) b = v; }
          if (L.baseline != null) { a = Math.min(a, L.baseline); b = Math.max(b, L.baseline); }
          const pad = (b - a) * 0.08 || 1;
          mn = mn ?? a - pad; mx = mx ?? b + pad;
        }
        const Yv = (v) => y + (1 - (v - mn) / (mx - mn)) * lh;
        ctx.fillStyle = c.surface2; ctx.globalAlpha = 0.5; ctx.fillRect(left, y, pw, lh); ctx.globalAlpha = 1;
        // grid
        const gs = niceStep(mx - mn, Math.max(2, lh / 28));
        ctx.font = FONT(10); ctx.textAlign = 'right';
        for (let v = Math.ceil(mn / gs) * gs; v <= mx; v += gs) {
          const yy = Yv(v);
          ctx.strokeStyle = c.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(left + pw, yy); ctx.stroke();
          ctx.fillStyle = c.text3; ctx.fillText(`${+v.toFixed(2)}${L.unit || ''}`, left - 6, yy);
        }
        if (L.baseline != null && L.baseline > mn && L.baseline < mx) {
          ctx.strokeStyle = c.text3; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(left, Yv(L.baseline)); ctx.lineTo(left + pw, Yv(L.baseline)); ctx.stroke(); ctx.setLineDash([]);
        }
        // fill above baseline
        if (L.fill) {
          ctx.save(); ctx.beginPath(); ctx.rect(left, y, pw, Yv(L.baseline ?? mn) - y); ctx.clip();
          ctx.beginPath(); ctx.moveTo(X(0), Yv(L.baseline ?? mn));
          const stepPx = Math.max(1, Math.floor(n / (pw * 2)));
          for (let i = 0; i < n; i += stepPx) ctx.lineTo(X(i), Yv(L.data[i]));
          ctx.lineTo(X(n - 1), Yv(L.baseline ?? mn)); ctx.closePath();
          ctx.fillStyle = L.fill; ctx.fill(); ctx.restore();
        }
        ctx.strokeStyle = L.color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
        // min/max decimation per pixel column keeps spikes visible
        const perPx = n / pw;
        if (perPx > 2) {
          for (let px = 0; px < pw; px++) {
            const a = Math.floor(px * perPx), b = Math.min(n, Math.floor((px + 1) * perPx));
            let lo = Infinity, hi = -Infinity;
            for (let i = a; i < b; i++) { const v = L.data[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
            ctx.moveTo(left + px, Yv(hi)); ctx.lineTo(left + px + 0.01, Yv(lo));
          }
          ctx.lineWidth = 1.5;
        } else {
          for (let i = 0; i < n; i++) i ? ctx.lineTo(X(i), Yv(L.data[i])) : ctx.moveTo(X(i), Yv(L.data[i]));
        }
        ctx.stroke();
        ctx.font = FONT(11, 700); ctx.textAlign = 'left'; ctx.fillStyle = c.text2; ctx.textBaseline = 'top';
        ctx.fillText(L.label, left + 6, y + 3); ctx.textBaseline = 'middle';
        rows.push({ L, y0: y, y1: y + lh, Yv });
        y += lh + gap;
      }
    }
    // time axis
    const days = (n * step) / 86400000;
    const tickMs = days <= 3 ? 6 * 3600000 : days <= 12 ? 86400000 : days <= 45 ? 5 * 86400000 : days <= 120 ? 14 * 86400000 : 30 * 86400000;
    ctx.font = FONT(10.5); ctx.fillStyle = c.text3; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const firstTick = Math.ceil(t0 / tickMs) * tickMs;
    let lastLabelX = -1e9;
    for (let t = firstTick; t <= t0 + (n - 1) * step; t += tickMs) {
      if (tickMs >= 30 * 86400000) { /* snap to month starts */ }
      const x = left + ((t - t0) / ((n - 1) * step)) * pw;
      ctx.strokeStyle = c.grid; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, y - gap); ctx.stroke();
      const lab = tickMs < 86400000 ? fmtTime(t, { noZone: true }).slice(5) : fmtShortDate(t);
      if (x - lastLabelX > 56) { ctx.fillText(lab, x, y - gap + 6); lastLabelX = x; }
    }
    geom.rows = rows; geom.bottomY = y;
    // cursor
    if (cfg.cursor != null) {
      const i = (cfg.cursor - t0) / step;
      if (i >= 0 && i <= n - 1) {
        const x = X(i);
        ctx.strokeStyle = c.text; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, y - gap); ctx.stroke();
        ctx.fillStyle = c.text; ctx.beginPath(); ctx.moveTo(x - 5, top); ctx.lineTo(x + 5, top); ctx.lineTo(x, top + 6); ctx.fill();
      }
    }
    // extra shaded spans (e.g. mission window)
    for (const sp of cfg.spans || []) {
      const x0 = left + Math.max(0, (sp.a - t0) / ((n - 1) * step)) * pw, x1 = left + Math.min(1, (sp.b - t0) / ((n - 1) * step)) * pw;
      if (x1 > x0) { ctx.fillStyle = sp.color; ctx.fillRect(x0, top, x1 - x0, y - gap - top); }
    }
    if (hoverX != null) {
      ctx.strokeStyle = c.text3; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(hoverX, top); ctx.lineTo(hoverX, y - gap); ctx.stroke(); ctx.setLineDash([]);
    }
  });
  const cv = api.cv;
  const idxAt = (clientX) => {
    if (!geom) return null;
    const r = cv.getBoundingClientRect();
    const f = (clientX - r.left - geom.left) / geom.pw;
    if (f < -0.02 || f > 1.02) return null;
    return Math.max(0, Math.min(geom.n - 1, Math.round(f * (geom.n - 1))));
  };
  let seeking = false;
  cv.addEventListener('pointerdown', (e) => {
    const i = idxAt(e.clientX); if (i == null) return;
    seeking = true; cv.setPointerCapture(e.pointerId);
    onSeek?.(geom.t0 + i * geom.step);
  });
  cv.addEventListener('pointermove', (e) => {
    const i = idxAt(e.clientX);
    if (seeking && i != null) { onSeek?.(geom.t0 + i * geom.step); }
    const r = cv.getBoundingClientRect();
    if (i == null || e.pointerType === 'touch' && !seeking) { tip.style.display = 'none'; hoverX = null; api.redraw(); return; }
    hoverX = geom.left + (i / (geom.n - 1)) * geom.pw;
    const cfg = getCfg();
    let html = `<b>${fmtTime(geom.t0 + i * geom.step)}</b>`;
    for (const row of geom.rows) {
      const L = row.L;
      const v = L.data[i];
      const txt = L.type === 'flag' ? (v ? 'yes' : 'no') : L.fmt ? L.fmt(v) : `${v.toFixed(2)}${L.unit || ''}`;
      html += `<br><span class="sw" style="background:${L.color}"></span>${L.label}: <b>${txt}</b>`;
    }
    tip.innerHTML = html; tip.style.display = 'block';
    const x = e.clientX - r.left;
    tip.style.left = (x > r.width / 2 ? x - tip.offsetWidth - 12 : x + 12) + 'px';
    tip.style.top = '6px';
    api.redraw();
  });
  const end = () => { seeking = false; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { tip.style.display = 'none'; hoverX = null; api.redraw(); });
  return api;
}

/**
 * Swimlanes for multi-site comparison. rows: [{label, lanes: [{data: Uint8Array, color}]}]
 */
export function swimlanes(container, getCfg, onPick) {
  const tip = h('div.tooltip');
  container.append(tip);
  let geom = null;
  const api = makeCanvas(container, (ctx, W, H) => {
    const cfg = getCfg();
    if (!cfg) return;
    const c = colors();
    const { t0, step, n, rows } = cfg;
    const left = Math.min(190, Math.max(96, W * 0.28)), right = 8, top = 4;
    const laneH = 9, rowGap = 10;
    const pw = W - left - right;
    let y = top;
    ctx.font = FONT(12, 600); ctx.textBaseline = 'middle';
    const rowPos = [];
    for (const r of rows) {
      const rh = r.lanes.length * (laneH + 2);
      ctx.fillStyle = c.text; ctx.textAlign = 'right';
      let lab = r.label;
      while (ctx.measureText(lab).width > left - 12 && lab.length > 4) lab = lab.slice(0, -2);
      ctx.fillText(lab === r.label ? lab : lab + '…', left - 8, y + rh / 2);
      r.lanes.forEach((L, k) => {
        const yy = y + k * (laneH + 2);
        ctx.fillStyle = c.surface2; ctx.fillRect(left, yy, pw, laneH);
        ctx.fillStyle = L.color;
        let s = -1;
        for (let i = 0; i <= n; i++) {
          const on = i < n && L.data[i];
          if (on && s < 0) s = i;
          if (!on && s >= 0) { const x0 = left + (s / n) * pw, x1 = left + (i / n) * pw; ctx.fillRect(x0, yy, Math.max(1, x1 - x0), laneH); s = -1; }
        }
      });
      rowPos.push({ y0: y, y1: y + rh, r });
      y += rh + rowGap;
    }
    // axis
    const days = n * step / 86400000;
    const tickMs = days <= 12 ? 86400000 : days <= 45 ? 7 * 86400000 : days <= 120 ? 14 * 86400000 : 30 * 86400000;
    ctx.font = FONT(10.5); ctx.fillStyle = c.text3; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    let lastX = -1e9;
    for (let t = Math.ceil(t0 / tickMs) * tickMs; t < t0 + n * step; t += tickMs) {
      const x = left + (t - t0) / (n * step) * pw;
      ctx.strokeStyle = c.grid; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, y - rowGap); ctx.stroke();
      if (x - lastX > 50) { ctx.fillText(fmtShortDate(t), x, y - rowGap + 4); lastX = x; }
    }
    geom = { left, pw, rowPos, t0, step, n };
    if (cfg.cursor != null) {
      const x = left + (cfg.cursor - t0) / (n * step) * pw;
      ctx.strokeStyle = c.text; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, y - rowGap); ctx.stroke();
    }
  });
  api.cv.addEventListener('pointermove', (e) => {
    if (!geom) return;
    const cfg = getCfg();
    const r = api.cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const f = (x - geom.left) / geom.pw;
    const row = geom.rowPos.find((p) => y >= p.y0 - 4 && y <= p.y1 + 4);
    if (f < 0 || f > 1 || !row) { tip.style.display = 'none'; return; }
    const i = Math.min(geom.n - 1, Math.floor(f * geom.n));
    let html = `<b>${row.r.label}</b><br>${fmtTime(geom.t0 + i * geom.step)}`;
    row.r.lanes.forEach((L) => { html += `<br><span class="sw" style="background:${L.color}"></span>${L.name}: <b>${L.data[i] ? 'yes' : 'no'}</b>`; });
    tip.innerHTML = html; tip.style.display = 'block';
    tip.style.left = (x > r.width / 2 ? x - tip.offsetWidth - 12 : x + 12) + 'px'; tip.style.top = Math.max(0, row.y0 - 10) + 'px';
  });
  api.cv.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
  api.cv.addEventListener('click', (e) => {
    if (!geom) return;
    const r = api.cv.getBoundingClientRect();
    const f = (e.clientX - r.left - geom.left) / geom.pw;
    const y = e.clientY - r.top;
    const row = geom.rowPos.find((p) => y >= p.y0 - 4 && y <= p.y1 + 4);
    if (row && f >= 0 && f <= 1) onPick?.(row.r, geom.t0 + Math.floor(f * geom.n) * geom.step);
  });
  return api;
}

/** Sequential color ramp (one hue, light→dark in light mode; dark→light in dark mode) */
export function rampColor(hue, t, dark) {
  t = Math.max(0, Math.min(1, t));
  const L = dark ? 18 + t * 52 : 94 - t * 58;
  const S = 35 + t * 55;
  return `hsl(${hue} ${S}% ${L}%)`;
}
export const isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';

/**
 * Calendar heat strip: rows × days. cfg: { t0, nd, rows:[{label, values: Float32Array (0..100 or -1 = infeasible), meta}], hue, fmt, cellTip }
 */
export function heatmap(container, getCfg, onPick) {
  const tip = h('div.tooltip');
  container.append(tip);
  let geom = null;
  const api = makeCanvas(container, (ctx, W, H) => {
    const cfg = getCfg();
    if (!cfg) return;
    const c = colors();
    const dark = isDark();
    const left = Math.min(180, Math.max(90, W * 0.24)), right = 6, top = 20;
    const pw = W - left - right;
    const cw = pw / cfg.nd;
    const rh = Math.max(14, Math.min(22, (H - top - 4) / cfg.rows.length - 3));
    ctx.font = FONT(12, 600); ctx.textBaseline = 'middle';
    cfg.rows.forEach((r, k) => {
      const y = top + k * (rh + 3);
      ctx.fillStyle = c.text; ctx.textAlign = 'right';
      let lab = r.label;
      while (ctx.measureText(lab).width > left - 12 && lab.length > 4) lab = lab.slice(0, -2);
      ctx.fillText(lab === r.label ? lab : lab + '…', left - 8, y + rh / 2);
      for (let d = 0; d < cfg.nd; d++) {
        const v = r.values[d];
        if (v < 0 || Number.isNaN(v)) {
          ctx.fillStyle = c.surface2;
        } else ctx.fillStyle = rampColor(cfg.hue, v / 100, dark);
        ctx.fillRect(left + d * cw, y, Math.max(1, cw - (cw > 4 ? 1 : 0)), rh);
      }
    });
    // month labels
    ctx.font = FONT(10.5, 600); ctx.fillStyle = c.text3; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    let lastX = -1e9;
    for (let d = 0; d < cfg.nd; d++) {
      const t = cfg.t0 + d * 86400000, dt = new Date(t);
      const first = settings.tz === 'utc' ? dt.getUTCDate() === 1 : dt.getDate() === 1;
      if (d === 0 || first || (cfg.nd <= 70 && d % 7 === 0)) {
        const x = left + d * cw;
        const m = settings.tz === 'utc' ? dt.getUTCMonth() : dt.getMonth();
        const lab = cfg.nd > 70 ? MONTHS[m] : fmtShortDate(t);
        if ((first || d === 0 || cfg.nd <= 70) && x > lastX) { ctx.fillText(lab, x + 1, 3); lastX = x + ctx.measureText(lab).width + 10; }
      }
    }
    geom = { left, pw, cw, rh, top, cfg };
  });
  const pick = (e) => {
    if (!geom) return null;
    const r = api.cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const d = Math.floor((x - geom.left) / geom.cw), k = Math.floor((y - geom.top) / (geom.rh + 3));
    if (d < 0 || d >= geom.cfg.nd || k < 0 || k >= geom.cfg.rows.length) return null;
    return { d, k, x, y, r };
  };
  api.cv.addEventListener('pointermove', (e) => {
    const p = pick(e);
    if (!p) { tip.style.display = 'none'; return; }
    const cfg = geom.cfg, row = cfg.rows[p.k];
    tip.innerHTML = cfg.cellTip ? cfg.cellTip(row, p.d) : `<b>${row.label}</b><br>${fmtTime(cfg.t0 + p.d * 86400000, { dateOnly: true })}: <b>${fmtPct(row.values[p.d])}</b>`;
    tip.style.display = 'block';
    tip.style.left = (p.x > p.r.width / 2 ? p.x - tip.offsetWidth - 12 : p.x + 12) + 'px';
    tip.style.top = Math.max(0, p.y - 20) + 'px';
  });
  api.cv.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
  api.cv.addEventListener('click', (e) => { const p = pick(e); if (p) onPick?.(geom.cfg.rows[p.k], p.d); });
  return api;
}
