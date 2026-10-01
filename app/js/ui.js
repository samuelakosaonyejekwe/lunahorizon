// Shared UI helpers, app state and services.
import { DEFAULTS, decodeHorizon, encodeHorizon } from './engine.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Tiny hyperscript: h('div.card#id', {attrs}, ...children) */
export function h(tag, attrs, ...kids) {
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m[1] || 'div');
  (m[2].match(/[.#][\w-]+/g) || []).forEach((t) => (t[0] === '.' ? el.classList.add(t.slice(1)) : (el.id = t.slice(1))));
  if (attrs != null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') { if (v) String(v).split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c)); }
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c instanceof Node ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ------------------------------------------------------------------ settings
const SKEY = 'lh.settings';
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

export const settings = { tz: 'utc', theme: 'auto', mastM: 2, ...DEFAULTS, ...load(SKEY, {}) };
const listeners = new Set();
export function onSettings(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** Point every curated site at the horizon for the chosen sensor height (custom sites have one horizon) */
function applyMast() {
  for (const s of store.sites) if (s.hz2) s.hz = settings.mastM === 10 ? s.hz10 : s.hz2;
}
export function updateSettings(patch) {
  Object.assign(settings, patch);
  save(SKEY, settings);
  if ('mastM' in patch) applyMast();
  listeners.forEach((fn) => fn(settings));
}
export const engineOpts = () => {
  const o = {};
  for (const k in DEFAULTS) o[k] = settings[k];
  return o;
};

// ------------------------------------------------------------------ time formatting
const pad = (n) => String(n).padStart(2, '0');
let zoneAbbr = null;
function localZone() {
  if (zoneAbbr == null) {
    try { zoneAbbr = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || 'local'; } catch { zoneAbbr = 'local'; }
  }
  return zoneAbbr;
}
export function fmtTime(ms, opt = {}) {
  const d = new Date(ms);
  const utc = settings.tz === 'utc';
  const Y = utc ? d.getUTCFullYear() : d.getFullYear(), M = utc ? d.getUTCMonth() : d.getMonth(), D = utc ? d.getUTCDate() : d.getDate();
  const hh = utc ? d.getUTCHours() : d.getHours(), mm = utc ? d.getUTCMinutes() : d.getMinutes();
  const date = `${Y}-${pad(M + 1)}-${pad(D)}`;
  if (opt.dateOnly) return date;
  return `${date} ${pad(hh)}:${pad(mm)}${opt.noZone ? '' : utc ? ' UTC' : ' ' + localZone()}`;
}
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtShortDate(ms) {
  const d = new Date(ms);
  const utc = settings.tz === 'utc';
  return `${MONTHS[utc ? d.getUTCMonth() : d.getMonth()]} ${utc ? d.getUTCDate() : d.getDate()}`;
}
/** value for <input type=datetime-local> in the current display zone */
export function toInput(ms) {
  const d = new Date(ms);
  if (settings.tz === 'utc') return d.toISOString().slice(0, 16);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromInput(v) {
  if (!v) return NaN;
  return settings.tz === 'utc' ? Date.parse(v + (v.length === 16 ? ':00Z' : 'Z')) : new Date(v).getTime();
}
export const toDateInput = (ms) => toInput(ms).slice(0, 10);
export const fromDateInput = (v) => fromInput(v + 'T00:00');
export function fmtDur(hours) {
  if (!isFinite(hours)) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}
export const fmtPct = (v, d = 0) => (isFinite(v) ? `${v.toFixed(d)}%` : '—');
export const fmtDeg = (v, d = 2) => (isFinite(v) ? `${v.toFixed(d)}°` : '—');
export function fmtLat(lat) { return `${Math.abs(lat).toFixed(3)}°${lat < 0 ? 'S' : 'N'}`; }
export function fmtLon(lon) { const l = ((lon + 540) % 360) - 180; return `${Math.abs(l).toFixed(3)}°${l < 0 ? 'W' : 'E'}`; }
export const fmtLL = (lat, lon) => `${fmtLat(lat)} ${fmtLon(lon)}`;
export function compass(az) { return ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(az / 22.5) % 16]; }
export const startOfDayUTC = (ms) => Math.floor(ms / 86400000) * 86400000;

// ------------------------------------------------------------------ toast
let toastTimer;
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ------------------------------------------------------------------ sites
export const store = { sites: [], byId: new Map(), meta: null };
const CKEY = 'lh.custom';

export async function loadSites() {
  const [sj, meta] = await Promise.all([
    fetch('data/sites.json').then((r) => r.json()),
    fetch('data/meta.json').then((r) => r.json()).catch(() => null),
  ]);
  store.meta = meta;
  const list = sj.sites.map((s) => { const hz2 = decodeHorizon(s.horizon); return { ...s, hz2, hz10: decodeHorizon(s.horizon10) || hz2, hz: hz2, horizon: undefined, horizon10: undefined }; });
  for (const c of load(CKEY, [])) list.push({ ...c, hz: decodeHorizon(c.horizon), horizon: undefined, custom: true, group: 'Custom' });
  store.sites = list;
  store.byId = new Map(list.map((s) => [s.id, s]));
  applyMast();
  return list;
}
export function addCustomSite(site) {
  const cur = load(CKEY, []).filter((c) => c.id !== site.id);
  const rec = { id: site.id, name: site.name, lat: site.lat, lon: site.lon, elev_m: site.elev_m, precision: 'custom', group: 'Custom',
    terrain: site.terrain, note: site.note || '', src: 'User-defined', horizon: site.hz ? encodeHorizon(site.hz) : null, mast: site.mast };
  cur.push(rec); save(CKEY, cur);
  const full = { ...rec, hz: site.hz, horizon: undefined, custom: true };
  const i = store.sites.findIndex((s) => s.id === site.id);
  if (i >= 0) store.sites[i] = full; else store.sites.push(full);
  store.byId.set(full.id, full);
  return full;
}
export function removeCustomSite(id) {
  save(CKEY, load(CKEY, []).filter((c) => c.id !== id));
  store.sites = store.sites.filter((s) => s.id !== id);
  store.byId.delete(id);
}
export const getSite = (id) => store.byId.get(id);
export const polarSites = () => store.sites.filter((s) => s.lat <= -79);
export function groupTag(s) {
  const g = s.group || 'Reference';
  const cls = g === 'Artemis' ? 'artemis' : g === 'CLPS' ? 'clps' : g === 'Custom' ? 'custom' : '';
  return h('span.tag' + (cls ? '.' + cls : ''), g === 'Artemis' ? 'Artemis III' : g);
}

// ------------------------------------------------------------------ worker RPC
// Heavy jobs run in a module Web Worker. Browsers that cannot start one (older Firefox for Android, iOS < 15)
// fall back to running the same code (jobs.js) on the page, one job at a time: slower, but it works.
let worker = null, workerOk = null, seq = 0, inlineQueue = Promise.resolve();
const pending = new Map();
function runInline(id) {
  const p = pending.get(id);
  inlineQueue = inlineQueue.then(async () => {
    const { runJob } = await import('./jobs.js');
    await runJob(p.msg, (m) => {
      if (m.type === 'progress') p.onProgress && p.onProgress(m.msg);
      else { pending.delete(id); m.type === 'error' ? p.reject(new Error(m.msg)) : p.resolve(m); }
    });
  }).catch((e) => { pending.delete(id); p.reject(e); });
}
function startWorker() {
  try { worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); } catch { workerOk = false; return; }
  worker.onmessage = (e) => {
    workerOk = true;
    const m = e.data, p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress') p.onProgress && p.onProgress(m.msg);
    else { pending.delete(m.id); m.type === 'error' ? p.reject(new Error(m.msg)) : p.resolve(m); }
  };
  worker.onerror = (e) => {
    if (workerOk) { pending.forEach((p) => p.reject(new Error(e.message || 'Worker failed'))); pending.clear(); return; }
    // the worker never started (module workers unsupported): rerun everything on the page
    workerOk = false; worker.terminate(); worker = null;
    for (const id of pending.keys()) runInline(id);
  };
}
export function compute(msg, onProgress) {
  if (worker === null && workerOk !== false) startWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress, msg: { ...msg, id } });
    if (workerOk === false) runInline(id);
    else worker.postMessage({ ...msg, id });
  });
}
/** Serializable site record for the worker */
export const siteMsg = (s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, elev_m: s.elev_m, hz: s.hz });

// ------------------------------------------------------------------ route state helpers
export function query() {
  const q = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(q));
}
/** Replace the query part of the hash without triggering navigation */
export function setQuery(obj) {
  const base = location.hash.split('?')[0] || '#/';
  const q = new URLSearchParams();
  for (const k in obj) if (obj[k] != null && obj[k] !== '') q.set(k, obj[k]);
  const s = q.toString();
  history.replaceState(null, '', base + (s ? '?' + s : ''));
}
export const isoMin = (ms) => new Date(ms).toISOString().slice(0, 16) + 'Z';
export const parseIso = (s) => (s ? Date.parse(s.endsWith('Z') ? s : s + 'Z') : NaN);

// ------------------------------------------------------------------ misc
export function download(name, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export function debounce(fn, ms = 150) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function cssVar(name, el = document.documentElement) { return getComputedStyle(el).getPropertyValue(name).trim(); }
export function icon(path) { return h('span', { html: `<svg viewBox="0 0 24 24" width="18" height="18">${path}</svg>` }).firstChild; }
export const ICONS = {
  play: '<path d="M7 4l13 8-13 8z"/>', pause: '<path d="M7 4v16M17 4v16"/>',
  back: '<path d="M15 18l-6-6 6-6"/>', fwd: '<path d="M9 18l6-6-6-6"/>',
  back2: '<path d="M11 18l-6-6 6-6M19 18l-6-6 6-6"/>', fwd2: '<path d="M5 18l6-6-6-6M13 18l6-6-6-6"/>',
  now: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', dl: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', img: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
  pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', target: '<circle cx="12" cy="12" r="8"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  compare: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>',
};
