// Polar Site Map: LOLA hillshade, yearly sunlight / Earth-visibility overlays, site markers, click-to-analyze any spot.
import { h, store, settings, compute, addCustomSite, fmtLL, fmtPct, toast, icon, ICONS, groupTag, query, setQuery, DEM_LIMIT_LAT } from '../ui.js';
import { makeCanvas } from '../charts.js';
import { MOON_R_KM } from '../astro.js';

const R_M = MOON_R_KM * 1000;
const llToXY = (lat, lon) => { const la = lat * Math.PI / 180, lo = lon * Math.PI / 180; const rho = 2 * R_M * Math.tan(Math.PI / 4 + la / 2); return [rho * Math.sin(lo), rho * Math.cos(lo)]; };
const xyToLL = (x, y) => { const rho = Math.hypot(x, y); return [(2 * Math.atan(rho / (2 * R_M)) - Math.PI / 2) * 180 / Math.PI, Math.atan2(x, y) * 180 / Math.PI]; };

const LAYERS = [['none', 'Terrain'], ['sun', 'Sunlight'], ['earth', 'Earth view'], ['both', 'Sun + Earth'], ['range', 'Year-to-year']];
const RANGE_MAX = 8; // year-to-year swing shown up to this many percentage points (typical swing is ~3)
// Colour ramps (sequential, one hue family each) as [t, r, g, b]
const RAMPS = {
  sun: [[0, 20, 16, 48], [0.25, 120, 50, 90], [0.5, 230, 110, 50], [0.75, 255, 190, 60], [1, 255, 250, 200]],
  earth: [[0, 16, 20, 50], [0.35, 40, 90, 190], [0.7, 90, 170, 255], [1, 215, 240, 255]],
  both: [[0, 16, 26, 32], [0.35, 20, 110, 95], [0.7, 50, 205, 150], [1, 200, 255, 230]],
  range: [[0, 20, 18, 40], [0.3, 90, 40, 120], [0.65, 215, 80, 150], [1, 255, 215, 235]],
};
function rampRGB(name, t) {
  const r = RAMPS[name];
  for (let i = 1; i < r.length; i++) if (t <= r[i][0]) {
    const a = r[i - 1], b = r[i], f = (t - a[0]) / (b[0] - a[0]);
    return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
  }
  return r[r.length - 1].slice(1);
}
const rampCss = (name) => `linear-gradient(90deg, ${RAMPS[name].map(([t, r, g, b]) => `rgb(${r},${g},${b}) ${t * 100}%`).join(',')})`;

const imgCache = {};
function loadImg(src) {
  // a failed load is not cached, so the map recovers once the connection is back
  imgCache[src] ||= new Promise((res, rej) => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = () => { delete imgCache[src]; rej(new Error('image failed: ' + src)); }; im.src = src; });
  return imgCache[src];
}

export function mount(root) {
  const meta = store.meta || {};
  const q = query();
  const yrs = meta.overlay_years;
  const yearOk = (y) => yrs && /^\d{4}$/.test(y) && +y >= yrs.year0 && +y < yrs.year0 + yrs.years;   // links are user input
  const st = { layer: LAYERS.some(([k]) => k === q.layer) ? q.layer : 'sun', year: yearOk(q.year) ? q.year : 'mean', cx: 0, cy: 0, scale: null, sel: null, overlayData: null, rangeData: null, base: null, zoomImg: null, showLabels: true };

  const wrap = h('div.mapwrap');
  const layerSeg = h('div.seg', LAYERS.map(([k, l]) => h('button', { class: st.layer === k ? 'on' : '', onclick: (e) => { st.layer = k; [...layerSeg.children].forEach((b) => b.classList.toggle('on', b === e.target)); setQuery({ layer: k, year: st.year === 'mean' ? null : st.year }); if (yearSel) yearSel.disabled = k === 'range'; legendUpdate(); map.redraw(); } }, l)));
  const labelsBtn = h('button.btn.small', { style: { background: 'rgba(8,12,24,.85)', color: '#dfe5f3', borderColor: 'rgba(255,255,255,.15)' }, onclick: () => { st.showLabels = !st.showLabels; map.redraw(); } }, 'Labels');
  const legend = h('div.maplegend');
  const card = h('div.mapcard', { style: { display: 'none' } });
  const yearSel = yrs ? h('select', { 'aria-label': 'Year', style: { width: 'auto', background: 'rgba(8,12,24,.85)', color: '#dfe5f3', borderColor: 'rgba(255,255,255,.15)' },
    onchange: () => { st.year = yearSel.value; setQuery({ layer: st.layer, year: st.year === 'mean' ? null : st.year }); loadOverlay(); } },
    h('option', { value: 'mean', selected: st.year === 'mean' }, `${yrs.year0}–${yrs.year0 + yrs.years - 1} average`),
    Array.from({ length: yrs.years }, (_, k) => String(yrs.year0 + k)).map((y) => h('option', { value: y, selected: st.year === y }, y))) : null;
  wrap.append(h('div.maptools', layerSeg, yearSel, labelsBtn), legend, card,
    h('div.mapzoom',
      h('button.btn', { 'aria-label': 'Zoom in', onclick: () => zoomAt(1.6) }, icon(ICONS.plus)),
      h('button.btn', { 'aria-label': 'Zoom out', onclick: () => zoomAt(1 / 1.6) }, icon(ICONS.minus)),
      h('button.btn', { 'aria-label': 'Reset view', onclick: () => { st.scale = null; st.cx = 0; st.cy = 0; map.redraw(); } }, icon(ICONS.target))));

  // side panel: sites list + coordinate entry
  const search = h('input', { type: 'search', placeholder: 'Filter sites…', 'aria-label': 'Filter sites', oninput: () => renderList() });
  const list = h('div.sitelist');
  const latIn = h('input', { type: 'number', step: 'any', placeholder: 'Latitude (−90…90)', 'aria-label': 'Latitude' });
  const lonIn = h('input', { type: 'number', step: 'any', placeholder: 'Longitude (E+)', 'aria-label': 'Longitude' });
  const side = h('div.stack',
    h('div.card', h('header', h('h2', 'Sites'), h('div.spacer'), h('span.muted', { style: { fontSize: '12px' } }, `${store.sites.length} loaded`)), search, h('div', { style: { height: '10px' } }), list),
    h('div.card', h('header', h('h2', 'Add any location')),
      h('p.muted', { style: { fontSize: '13px' } }, `Tap the map, or enter coordinates. South of ${-DEM_LIMIT_LAT}°S the terrain horizon is traced from LOLA data; elsewhere a smooth horizon is used.`),
      h('div.formgrid', latIn, lonIn),
      h('div', { style: { height: '8px' } }),
      h('button.btn.primary', { onclick: () => { const la = +latIn.value, lo = +lonIn.value; if (!isFinite(la) || la < -90 || la > 90 || latIn.value === '' || !isFinite(lo) || lonIn.value === '') return toast('Enter a valid latitude and longitude'); analyze(la, lo); } }, icon(ICONS.pin), 'Analyze location')),
  );

  root.append(
    h('div.pagehead', h('div', h('h1', 'South Pole Site Map'), h('p', 'LOLA terrain around the south pole. Overlays show the share of time each 1 km cell sees the Sun, the Earth, or both over its real terrain horizon, for any year of the 18.6-year lunar cycle (2026–2044) or their average. Tap anywhere to analyze that spot; pinch or scroll to zoom.'))),
    h('div.grid.cols-2', wrap, side));

  function legendUpdate() {
    if (st.layer === 'none') { legend.innerHTML = '<b>LOLA hillshade</b><br><span style="opacity:.75">Polar stereographic · 0° longitude (Earth-facing) up</span>'; return; }
    const when = !yrs ? '' : st.year === 'mean' ? ` (${yrs.year0}–${yrs.year0 + yrs.years - 1} average)` : ` (${st.year})`;
    if (st.layer === 'range') {
      legend.replaceChildren(h('b', `Year-to-year swing in sunlight, ${yrs ? yrs.year0 + '–' + (yrs.year0 + yrs.years - 1) : ''}`), h('div.ramp', { style: { background: rampCss('range') } }),
        h('div.ends', h('span', '0 pts'), h('span', `${RANGE_MAX / 2}`), h('span', `${RANGE_MAX}+ pts`)));
      return;
    }
    const name = { sun: 'Sunlight: % of time', earth: 'Earth in view: % of time', both: 'Sun and Earth together: % of time' }[st.layer] + when;
    legend.replaceChildren(h('b', name), h('div.ramp', { style: { background: rampCss(st.layer) } }), h('div.ends', h('span', '0%'), h('span', '50%'), h('span', '100%')));
  }
  legendUpdate();

  // ---------------------------------------------------------------- geometry
  const bm = meta.basemap || { half_m: 310e3 };
  const fitScale = (W, H) => Math.min(W, H) / (2 * ((meta.overlay?.half_m || bm.half_m) + 10e3));
  const toScreen = (x, y, W, H) => [W / 2 + (x - st.cx) * st.scale, H / 2 - (y - st.cy) * st.scale];
  const toWorld = (sx, sy, W, H) => [st.cx + (sx - W / 2) / st.scale, st.cy - (sy - H / 2) / st.scale];

  // ---------------------------------------------------------------- overlay colouring
  function overlayCanvas(layer) {
    // cache on the data object itself, so a redraw while another year is loading can never show the wrong year
    const src = layer === 'range' ? st.rangeData : st.overlayData; if (!src) return null;
    src.canvases ||= {};
    if (src.canvases[layer]) return src.canvases[layer];
    const { w, h: hh, data } = src;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
    const cx = cv.getContext('2d');
    const out = cx.createImageData(w, hh);
    const ch = layer === 'sun' || layer === 'range' ? 0 : layer === 'earth' ? 1 : 2;
    const k = layer === 'range' ? 100 / RANGE_MAX : 1;
    for (let i = 0; i < w * hh; i++) {
      const v = Math.min(1, data[i * 4 + ch] / 255 * k);
      const [r, g, b] = rampRGB(layer, v);
      out.data[i * 4] = r; out.data[i * 4 + 1] = g; out.data[i * 4 + 2] = b; out.data[i * 4 + 3] = 255;
    }
    cx.putImageData(out, 0, 0);
    src.canvases[layer] = cv;
    return cv;
  }
  function overlayValue(x, y) {
    const o = meta.overlay, d = st.overlayData;
    if (!o || !d) return null;
    const c = Math.floor((x + o.half_m) / o.cell), r = Math.floor((o.half_m - y) / o.cell);
    if (c < 0 || r < 0 || c >= d.w || r >= d.h) return null;
    const i = (r * d.w + c) * 4;
    const rg = st.rangeData;
    return { sun: d.data[i] / 2.55, earth: d.data[i + 1] / 2.55, both: d.data[i + 2] / 2.55,
      sunSwing: rg ? rg.data[i] / 2.55 : null, bestYear: rg ? rg.data[i + 2] / 2.55 : null };
  }

  // ---------------------------------------------------------------- draw
  const map = makeCanvas(wrap, (ctx, W, H) => {
    if (st.scale == null) st.scale = fitScale(W, H);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    if (st.base) {
      const [x0, y0] = toScreen(-bm.half_m, bm.half_m, W, H);
      ctx.drawImage(st.base, x0, y0, 2 * bm.half_m * st.scale, 2 * bm.half_m * st.scale);
    } else {
      ctx.fillStyle = 'rgba(223,229,243,.75)'; ctx.font = '600 15px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Loading LOLA terrain map…', W / 2, H / 2 + 40);
    }
    const zm = meta.basemap_zoom;
    if (zm && st.scale * 2 * bm.half_m / (meta.basemap?.px || 1400) > 1.5) {
      if (!st.zoomImg) loadImg('data/basemap_zoom.jpg').then((im) => { st.zoomImg = im; map.redraw(); });
      else {
        const [x0, y0] = toScreen(-zm.half_m, zm.half_m, W, H);
        ctx.drawImage(st.zoomImg, x0, y0, 2 * zm.half_m * st.scale, 2 * zm.half_m * st.scale);
      }
    }
    if (st.layer !== 'none' && meta.overlay) {
      const oc = overlayCanvas(st.layer);
      if (oc) {
        const o = meta.overlay;
        const [x0, y0] = toScreen(-o.half_m, o.half_m, W, H);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(oc, x0, y0, 2 * o.half_m * st.scale, 2 * o.half_m * st.scale);
        // re-apply terrain relief on top of the colours
        if (st.base) {
          ctx.save();
          ctx.beginPath(); ctx.rect(x0, y0, 2 * o.half_m * st.scale, 2 * o.half_m * st.scale); ctx.clip();
          ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = 0.9;
          const [bx, by] = toScreen(-bm.half_m, bm.half_m, W, H);
          ctx.drawImage(st.base, bx, by, 2 * bm.half_m * st.scale, 2 * bm.half_m * st.scale);
          ctx.restore();
        }
      }
    }
    // graticule
    ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1; ctx.font = '600 11px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.75)';
    const [px, py] = toScreen(0, 0, W, H);
    for (const lat of [-89, -88, -86, -84, -82, -80]) {
      const r = 2 * R_M * Math.tan(Math.PI / 4 + lat * Math.PI / 360) * st.scale;
      ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.textAlign = 'left'; ctx.fillText(`${-lat}°S`, px + r * Math.SQRT1_2 + 3, py - r * Math.SQRT1_2 - 3);
    }
    const rOut = 2 * R_M * Math.tan(Math.PI / 4 + (-78) * Math.PI / 360) * st.scale;
    for (let lon = 0; lon < 360; lon += 30) {
      const a = lon * Math.PI / 180;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + rOut * Math.sin(a), py - rOut * Math.cos(a)); ctx.stroke();
    }
    const lab = (txt, lon) => {
      const a = lon * Math.PI / 180; let r = Math.min(rOut, Math.max(W, H));
      let x = px + r * Math.sin(a), y = py - r * Math.cos(a);
      x = Math.max(30, Math.min(W - 30, x)); y = Math.max(52, Math.min(H - 16, y));
      ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillText(txt, x, y);
    };
    lab('0° · toward Earth', 0); lab('90°E', 90); lab('180°', 180); lab('90°W', 270);
    // pole
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
    // sites (labels skip when they would overlap an earlier label)
    const boxes = [];
    const order = [...store.sites].sort((a, b) => (st.sel?.id === b.id) - (st.sel?.id === a.id) || (a.group === 'Artemis' ? -1 : 1) - (b.group === 'Artemis' ? -1 : 1));
    for (const s of order) {
      if (s.lat > DEM_LIMIT_LAT) continue;
      const [x, y] = llToXY(s.lat, s.lon);
      const [sx, sy] = toScreen(x, y, W, H);
      if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
      const col = s.group === 'Artemis' ? '#5b8cff' : s.group === 'CLPS' ? '#23c990' : s.group === 'Custom' ? '#f2b33d' : '#c9ced9';
      ctx.beginPath(); ctx.arc(sx, sy, st.sel?.id === s.id ? 8 : 6, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke();
      if (st.showLabels) {
        ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,.85)';
        const bw = ctx.measureText(s.name).width, bx = sx + 9, by = sy - 8;
        if (!boxes.some((b) => bx < b[0] + b[2] && bx + bw > b[0] && by < b[1] + 16 && by + 16 > b[1])) {
          boxes.push([bx, by, bw]);
          ctx.strokeText(s.name, bx, sy + 4); ctx.fillStyle = '#fff'; ctx.fillText(s.name, bx, sy + 4);
        }
      }
    }
    if (st.sel && !st.sel.id) {
      const [sx, sy] = toScreen(st.sel.x, st.sel.y, W, H);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2); ctx.moveTo(sx - 14, sy); ctx.lineTo(sx + 14, sy); ctx.moveTo(sx, sy - 14); ctx.lineTo(sx, sy + 14); ctx.stroke();
    }
    // scale bar
    const km = [1, 2, 5, 10, 20, 50, 100].find((k) => k * 1000 * st.scale > 70) || 100;
    const bw = km * 1000 * st.scale;
    ctx.fillStyle = 'rgba(8,12,24,.85)'; ctx.fillRect(W - bw - 76, H - 40, bw + 20, 30);
    ctx.fillStyle = '#fff'; ctx.fillRect(W - bw - 66, H - 18, bw, 3);
    ctx.font = '600 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText(`${km} km`, W - bw / 2 - 66, H - 24);
  });

  // ---------------------------------------------------------------- interaction
  const pts = new Map();
  let drag = null, moved = false;
  const cv = map.cv;
  function zoomAt(f, sx, sy) {
    const W = map.w, H = map.h;
    sx ??= W / 2; sy ??= H / 2;
    const [wx, wy] = toWorld(sx, sy, W, H);
    const min = fitScale(W, H) * 0.8, max = fitScale(W, H) * 60;
    st.scale = Math.max(min, Math.min(max, st.scale * f));
    st.cx = wx - (sx - W / 2) / st.scale; st.cy = wy + (sy - H / 2) / st.scale;
    map.redraw();
  }
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    moved = false;
    if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, cx: st.cx, cy: st.cy };
    else if (pts.size === 2) { const [a, b] = [...pts.values()]; drag = { pinch: Math.hypot(a[0] - b[0], a[1] - b[1]), scale: st.scale }; }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2 && drag?.pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const r = cv.getBoundingClientRect();
      zoomAt((drag.scale * d / drag.pinch) / st.scale, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top);
      moved = true;
    } else if (drag && !drag.pinch) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      st.cx = drag.cx - dx / st.scale; st.cy = drag.cy + dy / st.scale;
      map.redraw();
    }
  });
  const up = (e) => {
    pts.delete(e.pointerId);
    if (pts.size === 0) {
      if (!moved && drag && !drag.pinch) click(e);
      drag = null;
    } else if (pts.size === 1) { const [p] = pts.values(); drag = { x: p[0], y: p[1], cx: st.cx, cy: st.cy }; }
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); drag = null; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top); }, { passive: false });

  function click(e) {
    const r = cv.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    // nearest site within 14 px
    let best = null, bd = 14;
    for (const s of store.sites) {
      if (s.lat > DEM_LIMIT_LAT) continue;
      const [x, y] = llToXY(s.lat, s.lon);
      const [px, py] = toScreen(x, y, map.w, map.h);
      const d = Math.hypot(px - sx, py - sy);
      if (d < bd) { bd = d; best = s; }
    }
    const [wx, wy] = toWorld(sx, sy, map.w, map.h);
    if (best) { const [x, y] = llToXY(best.lat, best.lon); st.sel = { ...best, x, y }; }
    else { const [lat, lon] = xyToLL(wx, wy); st.sel = { x: wx, y: wy, lat, lon }; }
    showCard(sx, sy);
    map.redraw();
  }

  function showCard(sx, sy) {
    const s = st.sel;
    const v = overlayValue(s.x, s.y);
    const bar = (label, val, color) => h('div', { style: { margin: '6px 0' } },
      h('div.row', { style: { justifyContent: 'space-between', fontSize: '13px' } }, h('span', label), h('b', fmtPct(val))),
      h('div', { style: { height: '6px', background: 'var(--surface-3)', borderRadius: '4px', overflow: 'hidden' } }, h('div', { style: { width: `${val}%`, height: '100%', background: color, borderRadius: '4px' } })));
    card.replaceChildren(h('div.card', { style: { padding: '12px' } },
      h('div.row', { style: { justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap' } },
        h('div', { style: { minWidth: 0 } }, h('b', s.name || 'Selected location'), h('div.muted', { style: { fontSize: '12px' } }, fmtLL(s.lat, s.lon))),
        h('button.iconbtn', { 'aria-label': 'Close', onclick: () => { card.style.display = 'none'; st.sel = null; map.redraw(); }, html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>' })),
      v ? h('div', bar(`Sunlit (${st.year === 'mean' ? 'average year' : st.year})`, v.sun, 'var(--sun)'), bar('Earth in view', v.earth, 'var(--earth)'), bar('Sun + Earth', v.both, 'var(--both)'),
        v.sunSwing != null ? h('div.muted', { style: { fontSize: '12px', margin: '4px 0' } }, `Sunlight varies by ${v.sunSwing.toFixed(0)} pts between years (best year ${v.bestYear.toFixed(0)}%).`) : null,
        h('div.muted', { style: { fontSize: '11px' } }, 'Map estimate at 1 km resolution; open the site for full detail.')) : h('p.muted', { style: { fontSize: '13px' } }, 'No overlay data here.'),
      h('div.row', { style: { marginTop: '8px' } },
        s.id ? h('a.btn.primary.small', { href: `#/site/${s.id}` }, 'Open explorer') : h('button.btn.primary.small', { onclick: () => analyze(s.lat, s.lon) }, icon(ICONS.pin), 'Analyze this spot'),
        s.id ? h('a.btn.small', { href: `#/planner?sites=${s.id}` }, 'Find windows') : null)));
    card.style.display = 'block';
    const W = map.w, H = map.h, cw = Math.min(310, W - 20);
    card.style.left = Math.max(10, Math.min(W - cw - 10, sx - cw / 2)) + 'px';
    // open clear of the finger, and ignore input briefly: phones fire a delayed synthetic click at the
    // tap point, which must not land on the card's buttons (it would start an unrequested analysis)
    const ch = card.offsetHeight || 240;
    card.style.top = (sy > H / 2 ? Math.max(50, sy - ch - 28) : Math.min(H - ch - 10, sy + 28)) + 'px';
    card.style.pointerEvents = 'none';
    clearTimeout(st.cardTimer); st.cardTimer = setTimeout(() => { card.style.pointerEvents = ''; }, 400);
  }

  let gone = false;
  async function analyze(lat, lon) {
    const id = `custom-${lat.toFixed(4)}_${lon.toFixed(4)}`;
    const name = `Custom ${Math.abs(lat).toFixed(2)}°${lat < 0 ? 'S' : 'N'} ${Math.abs(((lon + 540) % 360) - 180).toFixed(2)}°${(((lon + 540) % 360) - 180) < 0 ? 'W' : 'E'}`;
    if (lat > DEM_LIMIT_LAT) {
      addCustomSite({ id, name, lat, lon, elev_m: null, hz: null, terrain: 'smooth sphere (outside polar DEM)', note: 'User-defined site. Horizon modeled as a smooth sphere.' });
      location.hash = `#/site/${id}`; return;
    }
    const busy = h('div.busy', h('div.spinner'), h('span', 'Preparing terrain…'));
    card.replaceChildren(h('div.card', { style: { padding: '8px' } }, busy)); card.style.display = 'block';
    try {
      const mast = settings.mastM === 10 ? 10 : 2;   // trace at the sensor height chosen in Settings
      const res = await compute({ type: 'horizon', lat, lon, mast, base: new URL('.', location.href).href, meta }, (m) => { busy.lastChild.textContent = m; });
      addCustomSite({ id, name, lat, lon, elev_m: Math.round(res.h0), hz: res.hz, mast, terrain: 'LOLA 400 m + 1.6 km (in-browser)', note: `User-defined site; horizon traced in your browser from LOLA terrain for a sensor ${mast} m above the ground.` });
      toast('Terrain horizon computed. Site saved on this device.');
      if (!gone) location.hash = `#/site/${id}`;
    } catch (err) {
      // offline (airplane mode, no signal): only terrain downloaded on an earlier visit is available
      const net = !navigator.onLine || /fetch|load failed|network|: 503/i.test(err.message);
      card.replaceChildren(h('div.card', net
        ? [h('p', h('b', 'No connection.'), ' The terrain around this spot has not been downloaded to this device yet.'),
          h('p.muted', { style: { margin: 0 } }, 'Connect once and analyze it; after that it works offline. Built-in sites and spots you analyzed before work without a connection.')]
        : h('p', 'Could not compute the horizon: ' + err.message)));
    }
  }

  function renderList() {
    const f = search.value.trim().toLowerCase();
    list.replaceChildren(...store.sites.filter((s) => !f || s.name.toLowerCase().includes(f) || (s.group || '').toLowerCase().includes(f)).map((s) =>
      h('a.siteitem', { href: `#/site/${s.id}`, onmouseenter: () => { if (s.lat <= DEM_LIMIT_LAT) { const [x, y] = llToXY(s.lat, s.lon); st.sel = { ...s, x, y }; map.redraw(); } } },
        h('span.nm', s.name), groupTag(s), h('span.co', `${Math.abs(s.lat).toFixed(2)}°${s.lat < 0 ? 'S' : 'N'}`))));
  }
  renderList();

  // ---------------------------------------------------------------- data
  loadImg('data/basemap.jpg').then((im) => { st.base = im; map.redraw(); }).catch(() => toast('Basemap failed to load'));
  const readImg = (src) => loadImg(src).then((im) => {
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0);
    return { w: c.width, h: c.height, data: cx.getImageData(0, 0, c.width, c.height).data };
  });
  let overlayReq = 0;
  function loadOverlay() {
    if (!meta.overlay) return;
    const my = ++overlayReq, year = st.year;
    const src = year === 'mean' || !yrs ? 'data/overlay.png' : `data/years/overlay_${year}.png`;
    readImg(src).then((d) => {
      if (my !== overlayReq) return;      // a newer year was picked while this one loaded
      st.overlayData = d; legendUpdate(); map.redraw();
      if (st.sel && card.style.display !== 'none' && !card.querySelector('.busy')) showCard(...toScreenSel());   // refresh the card's numbers
    }).catch(() => { if (my === overlayReq) toast('Map layer failed to load'); });
  }
  const toScreenSel = () => toScreen(st.sel.x, st.sel.y, map.w, map.h);
  loadOverlay();
  if (yrs) readImg('data/overlay_range.png').then((d) => { st.rangeData = d; map.redraw(); }).catch(() => {});
  if (yearSel) yearSel.disabled = st.layer === 'range';

  return { unmount() { gone = true; map.destroy(); clearTimeout(st.cardTimer); } };
}
