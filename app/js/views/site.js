// Site Explorer: horizon panorama + sky plot, time machine, timeline, live status, power & comms.
import { h, $, store, getSite, settings, onSettings, engineOpts, fmtTime, fmtDeg, fmtPct, fmtDur, fmtLL, compass, toInput, fromInput,
  query, setQuery, isoMin, parseIso, download, icon, ICONS, groupTag, toast, removeCustomSite } from '../ui.js';
import { ephemTable, siteSeries, summarize, snapshot, HOUR, DAY } from '../engine.js';
import { RELAYS } from '../astro.js';
import { panorama, skyplot, timeline } from '../charts.js';

const SPANS = [[7, '7 d'], [30, '30 d'], [90, '90 d'], [365, '1 yr']];
const SPEEDS = [[1, '1 h/s'], [6, '6 h/s'], [24, '1 d/s'], [72, '3 d/s']];
const stepFor = (span) => (span <= 7 ? 10 : span <= 30 ? 20 : span <= 90 ? 60 : 120) * 60000;
let tabCache = null;

function getTable(t0, step, n) {
  const relay = settings.relay || 'none';
  if (tabCache && tabCache.t0 === t0 && tabCache.step === step && tabCache.n === n && tabCache.relay === relay) return tabCache;
  tabCache = ephemTable(t0, step, n, relay);
  return tabCache;
}

export function mount(root, params) {
  const q = query();
  let site = getSite(params[0]) || getSite(localStorage.getItem('lh.lastSite')) || getSite('connecting-ridge') || store.sites[0];
  if (params[0] !== site.id) history.replaceState(null, '', `#/site/${site.id}${location.hash.includes('?') ? '?' + location.hash.split('?')[1] : ''}`);
  try { localStorage.setItem('lh.lastSite', site.id); } catch { /* ignore */ }

  const st = {
    t: isFinite(parseIso(q.t)) ? parseIso(q.t) : Math.floor(Date.now() / 600000) * 600000,
    span: +q.span || 30,
    view: q.view === 'sky' ? 'sky' : 'pano',
    zoom: 1, center: null,
    playing: false, speed: 6,
    series: null, stats: null, snap: null, ws: 0,
  };

  // ---------------------------------------------------------------- layout
  const siteSel = h('select', { 'aria-label': 'Choose site', style: { width: 'auto', maxWidth: '100%', fontWeight: 700, fontSize: '1.05rem' },
    onchange: (e) => { location.hash = `#/site/${e.target.value}?t=${isoMin(st.t)}&span=${st.span}`; } });
  const groups = {};
  for (const s of store.sites) (groups[s.group || 'Other'] ||= []).push(s);
  for (const g of Object.keys(groups)) siteSel.append(h('optgroup', { label: g === 'Artemis' ? 'Artemis III candidate regions' : g === 'CLPS' ? 'CLPS missions' : g },
    groups[g].map((s) => h('option', { value: s.id, selected: s.id === site.id }, s.name))));

  const head = h('div.pagehead',
    h('div', { style: { minWidth: 0, flex: '1 1 320px' } },
      h('div.row', siteSel, groupTag(site)),
      h('p', fmtLL(site.lat, site.lon), site.elev_m != null ? ` · ${site.elev_m.toFixed(0)} m elevation` : '', ` · terrain: ${site.terrain}`)),
    h('div.row',
      site.lat <= -84 ? h('a.btn.small', { href: `#/3d?site=${site.id}&t=${isoMin(st.t)}` }, '3D view') : null,
      h('a.btn.small', { href: `#/compare?sites=${site.id}` }, icon(ICONS.compare), 'Compare'),
      h('a.btn.small', { href: `#/planner?sites=${site.id}` }, icon(ICONS.cal), 'Find windows'),
      h('button.btn.small', { onclick: exportCsv, title: 'Download the time series as CSV' }, icon(ICONS.dl), 'CSV'),
      h('button.btn.small', { onclick: exportPng, title: 'Save the horizon view as an image' }, icon(ICONS.img), 'PNG')));

  const viewSeg = h('div.seg', { role: 'tablist' },
    h('button', { class: st.view === 'pano' ? 'on' : '', onclick: () => setView('pano') }, 'Horizon panorama'),
    h('button', { class: st.view === 'sky' ? 'on' : '', onclick: () => setView('sky') }, 'Sky dome'));
  const panoBox = h('div.chart.pano', { 'aria-label': 'Horizon panorama showing terrain, Sun and Earth', role: 'img' });
  const skyBox = h('div.chart.pano', { style: { display: 'none' }, role: 'img', 'aria-label': 'Sky dome plot' });

  const whenEl = h('div.when');
  const dtIn = h('input', { type: 'datetime-local', step: 600, 'aria-label': 'Date and time', onchange: () => { const v = fromInput(dtIn.value); if (isFinite(v)) seek(v, true); } });
  const playBtn = h('button.btn.primary.small', { onclick: togglePlay, 'aria-label': 'Play/pause time', title: 'Play / pause (Space)' }, icon(ICONS.play));
  const speedSel = h('select', { style: { width: 'auto' }, 'aria-label': 'Playback speed', onchange: (e) => { st.speed = +e.target.value; } },
    SPEEDS.map(([v, l]) => h('option', { value: v, selected: v === st.speed }, l)));
  const stepBtn = (ms, ic, label) => h('button.btn.small', { onclick: () => seek(st.t + ms, true), 'aria-label': label, title: label }, icon(ic));
  const timebar = h('div.timebar',
    h('div.grp', stepBtn(-DAY, ICONS.back2, 'Back 1 day (Shift+←)'), stepBtn(-HOUR, ICONS.back, 'Back 1 hour (←)'), playBtn,
      stepBtn(HOUR, ICONS.fwd, 'Forward 1 hour (→)'), stepBtn(DAY, ICONS.fwd2, 'Forward 1 day (Shift+→)')),
    speedSel, dtIn,
    h('button.btn.small', { onclick: () => seek(Date.now(), true), title: 'Jump to now (N)' }, icon(ICONS.now), 'Now'),
    h('div.spacer'), whenEl);

  const panoCard = h('div.card.flush',
    h('header', viewSeg, h('div.spacer'), h('div.legend',
      h('span', h('i', { style: { background: '#ffd46b' } }), 'Sun & track'), h('span', h('i', { style: { background: '#7fb6ff' } }), 'Earth & track'),
      h('span', h('i', { style: { background: '#8d8a82' } }), 'Terrain (LOLA)'))),
    h('div', { style: { padding: '10px 0 0' } }, panoBox, skyBox), timebar);

  const spanSeg = h('div.seg', SPANS.map(([d, l]) => h('button', { class: d === st.span ? 'on' : '', onclick: (e) => { st.span = d; [...spanSeg.children].forEach((b) => b.classList.toggle('on', b === e.target)); rebuild(true); } }, l)));
  const tlBox = h('div.chart', { style: { height: 'clamp(360px, 52vh, 520px)' } });
  const tlCard = h('div.card',
    h('header', h('h2', 'Timeline'), h('span.muted', { style: { fontSize: '13px' } }, 'click or drag to scrub'), h('div.spacer'), spanSeg), tlBox);

  const nowCard = h('div.card');
  const eventsCard = h('div.card');
  const sumCard = h('div.card');
  const infoCard = h('div.card');

  root.append(head, h('div.grid.cols-2', h('div.stack', panoCard, tlCard), h('div.stack', nowCard, eventsCard, sumCard, infoCard)));

  // ---------------------------------------------------------------- charts
  const trackFor = (az, el, i0, i1) => ({ az: az.subarray(i0, i1), el: el.subarray(i0, i1), n: i1 - i0 });
  const trackRange = () => {
    const s = st.series; if (!s) return null;
    const ci = Math.round((st.t - s.t0) / s.step);
    const half = Math.round(15 * DAY / s.step);
    return [Math.max(0, ci - half), Math.min(s.n, ci + half)];
  };
  const panoState = () => {
    if (!st.snap) return null;
    const r = trackRange();
    const s = st.series;
    return {
      hz: site.hz, snap: st.snap, zoom: st.zoom,
      center: st.center ?? defaultCenter(),
      sunTrack: r && trackFor(s.sunAz, s.sunEl, r[0], r[1]),
      earthTrack: r && trackFor(s.earthAz, s.earthEl, r[0], r[1]),
      relayTrack: r && s.relayOn ? trackFor(s.relayAz, s.relayEl, Math.max(r[0], Math.round((st.t - s.t0) / s.step) - Math.round(12 * HOUR / s.step)), Math.min(r[1], Math.round((st.t - s.t0) / s.step) + Math.round(12 * HOUR / s.step))) : null,
      trackLabel: 'Tracks: ±15 days',
    };
  };
  function defaultCenter() {
    // Centre the view so both bodies are visible if possible
    const s = st.snap.sun.az, e = st.snap.earth.az;
    let d = ((e - s + 540) % 360) - 180;
    return (s + d / 2 + 360) % 360;
  }
  const pano = panorama(panoBox, panoState, (p) => {
    if (p.reset) { st.zoom = 1; st.center = null; }
    if (p.zoom) st.zoom = p.zoom;
    if (p.center != null) st.center = p.center;
    pano.redraw();
  });
  const sky = skyplot(skyBox, () => {
    const ps = panoState();
    if (!ps) return null;
    const maxEl = Math.min(90, Math.max(12, Math.ceil((90 - Math.abs(site.lat) + 9) / 5) * 5));
    return { ...ps, maxEl };
  });

  const c = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const tl = timeline(tlBox, () => {
    const s = st.series;
    if (!s) return null;
    const rel = (a, b) => { const o = new Float32Array(s.n); for (let i = 0; i < s.n; i++) o[i] = a[i] - b[i]; return o; };
    s._sunRel ||= rel(s.sunEl, s.sunHz);
    s._earthRel ||= rel(s.earthEl, s.earthHz);
    s._both ||= (() => { const o = new Uint8Array(s.n); for (let i = 0; i < s.n; i++) o[i] = s.lit[i] & s.earthVis[i]; return o; })();
    s._socPct ||= (() => { const o = new Float32Array(s.n); const cap = settings.batteryWh || 1; for (let i = 0; i < s.n; i++) o[i] = s.soc[i] / cap * 100; return o; })();
    const polar = Math.abs(site.lat) > 70;
    return {
      series: s, cursor: st.t,
      lanes: [
        { type: 'line', label: 'Sun above terrain', data: s._sunRel, color: c('--sun'), fill: c('--sun-soft'), baseline: 0, unit: '°', min: polar ? undefined : -90, max: polar ? undefined : 90 },
        { type: 'line', label: 'Earth above terrain', data: s._earthRel, color: c('--earth'), fill: c('--earth-soft'), baseline: 0, unit: '°' },
        { type: 'flag', label: 'Sunlit', data: s.lit, color: c('--sun') },
        { type: 'flag', label: 'Earth in view', data: s.earthVis, color: c('--earth') },
        { type: 'flag', label: 'DSN station', data: s.dsnAny, color: c('--dsn') },
        { type: 'flag', label: 'Sun + Earth', data: s._both, color: c('--both') },
        ...(s.relayOn ? [{ type: 'flag', label: 'Relay link', data: s.relayLink, color: c('--relay') }, { type: 'flag', label: 'Any comms', data: s.comms, color: c('--earth') }] : []),
        { type: 'line', label: 'Solar power', data: s.power, color: c('--sun'), baseline: 0, unit: ' W', min: 0, fmt: (v) => `${v.toFixed(0)} W` },
        { type: 'line', label: 'Battery', data: s._socPct, color: c('--both'), min: 0, max: 100, unit: '%', fmt: (v) => `${v.toFixed(0)}%` },
      ],
    };
  }, (ms) => seek(ms, false));

  // ---------------------------------------------------------------- compute
  function rebuild(keepCursor) {
    const span = st.span * DAY;
    const step = stepFor(st.span);
    // window: cursor at ~20% from the left edge, aligned to step
    const ws = Math.floor((st.t - span * 0.2) / step) * step;
    const n = Math.round(span / step) + 1;
    const tab = getTable(ws, step, n);
    st.series = siteSeries(site, tab, engineOpts());
    st.stats = summarize(st.series, engineOpts());
    st.ws = ws;
    renderSummary();
    refresh();
    tl.redraw();
  }

  function seek(ms, recenter) {
    st.t = Math.round(ms / 60000) * 60000;
    const s = st.series;
    if (!s || st.t < s.t0 || st.t > s.t0 + (s.n - 1) * s.step) rebuild();
    else if (recenter) refresh();
    else refresh();
    tl.redraw();
  }

  let urlTimer;
  function refresh() {
    st.snap = snapshot(site, st.t, engineOpts());
    whenEl.textContent = fmtTime(st.t);
    if (document.activeElement !== dtIn) dtIn.value = toInput(st.t);
    renderNow();
    renderEvents();
    st.view === 'pano' ? pano.redraw() : sky.redraw();
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => setQuery({ t: isoMin(st.t), span: st.span, view: st.view === 'sky' ? 'sky' : null }), 250);
  }

  function setView(v) {
    st.view = v;
    [...viewSeg.children].forEach((b, i) => b.classList.toggle('on', (i === 0) === (v === 'pano')));
    panoBox.style.display = v === 'pano' ? '' : 'none';
    skyBox.style.display = v === 'sky' ? '' : 'none';
    (v === 'pano' ? pano : sky).redraw();
    refresh();
  }

  // ---------------------------------------------------------------- panels
  function kpi(k, v, s, color, extra = '') {
    return h('div.kpi' + extra, h('div.k', color ? h('span.sw', { style: { background: color } }) : null, k), h('div.v', { html: v }), s ? h('div.s', s) : null);
  }
  function renderNow() {
    const sn = st.snap;
    const sunUp = sn.lit, earthUp = sn.earthVis;
    const dsnUp = sn.dsn.filter((d) => d.el >= settings.dsnMinEl);
    const dte = earthUp && (dsnUp.length > 0 || !settings.requireDSN);
    nowCard.replaceChildren(
      h('header', h('h2', 'At this moment'), h('div.spacer'), h('span.muted', { style: { fontSize: '12px' } }, fmtTime(st.t))),
      h('div.row', { style: { marginBottom: '12px' } },
        h('span.pill.' + (sunUp ? 'sun' : 'off'), sunUp ? 'Sunlit' : 'In shadow'),
        h('span.pill.' + (earthUp ? 'earth' : 'off'), earthUp ? 'Earth in view' : 'Earth hidden'),
        h('span.pill.' + (dte ? 'both' : 'off'), dte ? 'DTE link possible' : 'No DTE link'),
        sn.relay ? h('span.pill.' + (sn.relay.link ? 'relay' : 'off'), sn.relay.link ? 'Relay link up' : sn.relay.vis ? 'Relay up, no Earth/DSN' : 'Relay not in view') : null),
      h('div.kpis',
        kpi('Sun elevation', fmtDeg(sn.sun.el), `az ${sn.sun.az.toFixed(1)}° ${compass(sn.sun.az)} · horizon ${fmtDeg(sn.sun.hz)}`, c('--sun')),
        kpi('Solar disk visible', fmtPct(sn.sun.frac * 100), sn.sun.frac > 0 && sn.sun.frac < 1 ? 'partially behind terrain' : sn.sun.frac >= 1 ? 'fully clear of terrain' : 'blocked', c('--sun')),
        kpi('Earth elevation', fmtDeg(sn.earth.el), `az ${sn.earth.az.toFixed(1)}° ${compass(sn.earth.az)} · horizon ${fmtDeg(sn.earth.hz)}`, c('--earth')),
        kpi('Earth disk visible', fmtPct(sn.earth.frac * 100), `Earth phase ${fmtPct(sn.earth.phase * 100)} lit`, c('--earth')),
        kpi('Solar array output', `${sn.power.toFixed(0)} <small>W</small>`, `${settings.panelArea} m² · ${(settings.panelEff * 100).toFixed(0)}% · ${settings.panel === 'vtrack' ? 'tracking' : settings.panel === 'vfixed' ? 'fixed vertical' : 'horizontal'}`),
        kpi('Net power', `${(sn.power - settings.loadW).toFixed(0)} <small>W</small>`, `load ${settings.loadW} W · flux ${sn.sun.flux.toFixed(0)} W/m²`),
        sn.relay ? h('div.kpi.wide', h('div.k', h('span.sw', { style: { background: c('--relay') } }), `Relay: ${RELAYS[settings.relay].name}`),
          h('div.v', { html: `${fmtDeg(sn.relay.el, 1)} <small>elevation</small>` }),
          h('div.s', `az ${sn.relay.az.toFixed(0)}° ${compass(sn.relay.az)} · ${Math.round(sn.relay.alt).toLocaleString()} km altitude`),
          h('div.s', sn.relay.link ? 'Link available: relay above the skyline and in view of Earth' : !sn.relay.vis ? `Below the skyline (${fmtDeg(sn.relay.hz, 1)} ridge)` : !sn.relay.seesEarth ? 'Relay cannot see Earth right now' : 'No DSN station can see the Moon')) : null,
        h('div.kpi.wide', h('div.k', 'Deep Space Network: Moon elevation at each complex'),
          h('div.row', { style: { marginTop: '4px', gap: '6px' } }, sn.dsn.map((d) => h('span.pill.' + (d.el >= settings.dsnMinEl ? 'both' : 'off'), `${d.name} ${d.el.toFixed(0)}°`)))),
      ));
  }

  function nextChange(flag, fromIdx) {
    const s = st.series;
    for (let i = Math.max(1, fromIdx + 1); i < s.n; i++) if (flag[i] !== flag[i - 1]) return { t: s.t0 + i * s.step, on: !!flag[i] };
    return null;
  }
  function renderEvents() {
    const s = st.series; if (!s) return;
    const ci = Math.max(0, Math.min(s.n - 1, Math.round((st.t - s.t0) / s.step)));
    const row = (label, ev, onTxt, offTxt, color) => h('div.siteitem', { style: { cursor: ev ? 'pointer' : 'default' }, onclick: () => ev && seek(ev.t, true) },
      h('span.sw', { style: { width: '10px', height: '10px', borderRadius: '3px', background: color, display: 'inline-block' } }),
      h('span.nm', ev ? (ev.on ? onTxt : offTxt) : `${label}: no change in view`),
      h('span.co', ev ? `${fmtTime(ev.t)} · in ${fmtDur((ev.t - st.t) / HOUR)}` : ''));
    eventsCard.replaceChildren(
      h('header', h('h2', 'Next events'), h('div.spacer'), h('span.muted', { style: { fontSize: '12px' } }, 'click to jump')),
      h('div.sitelist.evlist',
        row('Sunlight', nextChange(s.lit, ci), 'Sunrise over terrain', 'Sunset behind terrain', c('--sun')),
        row('Earth', nextChange(s.earthVis, ci), 'Earthrise', 'Earthset (DTE loss)', c('--earth')),
        row('DTE', nextChange(s.dte, ci), 'DTE window opens', 'DTE window closes', c('--both')),
        s.relayOn ? row('Relay', nextChange(s.relayLink, ci), 'Relay link opens', 'Relay link closes', c('--relay')) : null));
  }

  function renderSummary() {
    const x = st.stats;
    const flag = (v, good, bad) => (v >= good ? 'ok' : v <= bad ? 'no' : '');
    sumCard.replaceChildren(
      h('header', h('h2', `Next ${SPANS.find((s) => s[0] === st.span)?.[1] || st.span + ' d'} at a glance`)),
      h('div.kpis',
        kpi('Sunlit time', fmtPct(x.sunPct, 1), `${x.darkPeriods} shadow period${x.darkPeriods === 1 ? '' : 's'}`, c('--sun')),
        kpi('Longest shadow', fmtDur(x.longestDarkH), x.longestDarkOpen ? 'runs past window edge' : 'battery must bridge this', c('--sun')),
        kpi('Earth in view', fmtPct(x.earthPct, 1), `longest blackout ${fmtDur(x.longestNoEarthH)}`, c('--earth')),
        kpi('DTE availability', fmtPct(x.dtePct, 1), settings.requireDSN ? `with DSN ≥${settings.dsnMinEl}°` : 'line of sight only', c('--earth')),
        kpi('Sun + Earth', fmtPct(x.bothPct, 1), 'power and comms together', c('--both')),
        ...(st.series.relayOn ? [kpi('Comms with relay', fmtPct(x.commsPct, 1), `relay adds ${Math.max(0, x.commsPct - x.dtePct).toFixed(1)} pts · longest gap ${fmtDur(x.longestNoCommsH)}`, c('--relay'))] : []),
        kpi('Energy per day', `${(x.energyPerDayWh / 1000).toFixed(2)} <small>kWh</small>`, `mean ${x.meanPowerW.toFixed(0)} W · peak ${x.peakPowerW.toFixed(0)} W`),
        h('div.kpi.wide', h('div.k', 'Battery survival'),
          h('div.v', { html: `<span class="${x.depletedH > 0 ? 'no' : 'ok'}">${x.depletedH > 0 ? 'Depleted ' + fmtDur(x.depletedH) : 'Survives'}</span>` }),
          h('div.s', `minimum charge ${fmtPct(x.minSocPct)} of ${settings.batteryWh} Wh at ${settings.loadW} W load. Change the power system in Settings.`)),
      ));
  }

  function renderInfo() {
    infoCard.replaceChildren(
      h('header', h('h2', 'About this site')),
      h('p', site.note || ''),
      h('p.muted', { style: { fontSize: '13px' } },
        `Coordinates: ${fmtLL(site.lat, site.lon)} (${site.precision === 'published' ? 'published' : site.precision === 'region' ? 'representative point: the best-lit 1 km map cell near the approximate region center' : site.precision === 'custom' ? 'user defined' : 'feature center'}). Source: ${site.src || '—'}.`),
      site.hz ? h('p.muted', { style: { fontSize: '13px' } }, `Terrain horizon traced over ${site.custom ? 'the 400 m / 1.6 km' : site.terrain.replace('LOLA ', '')} LOLA grids out to 260 km, 0.5° azimuth bins, ${site.hz2 ? settings.mastM : 2} m sensor height. Highest ridge: ${Math.max(...site.hz).toFixed(2)}°.`)
        : h('p.muted', { style: { fontSize: '13px' } }, 'Outside the polar DEM: the horizon is modeled as a smooth sphere, so local hills are not included.'),
      site.custom ? h('button.btn.small', { onclick: () => { removeCustomSite(site.id); toast('Custom site removed'); location.hash = '#/map'; } }, icon(ICONS.trash), 'Remove custom site') : null,
    );
  }

  // ---------------------------------------------------------------- playback & keys
  let raf = 0, last = 0;
  function togglePlay() {
    st.playing = !st.playing;
    playBtn.replaceChildren(icon(st.playing ? ICONS.pause : ICONS.play));
    if (st.playing) { last = performance.now(); raf = requestAnimationFrame(tick); } else cancelAnimationFrame(raf);
  }
  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    seek(st.t + dt * st.speed * HOUR, false);
    if (st.playing) raf = requestAnimationFrame(tick);
  }
  const onKey = (e) => {
    if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight') { seek(st.t + (e.shiftKey ? DAY : HOUR), true); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { seek(st.t - (e.shiftKey ? DAY : HOUR), true); e.preventDefault(); }
    else if (e.key === ' ') { togglePlay(); e.preventDefault(); }
    else if (e.key === 'n' || e.key === 'N') seek(Date.now(), true);
  };
  document.addEventListener('keydown', onKey);
  const offSettings = onSettings(() => { renderInfo(); rebuild(); });

  // ---------------------------------------------------------------- export
  function exportCsv() {
    const s = st.series;
    const rows = ['time_utc,sun_az_deg,sun_el_deg,sun_horizon_deg,sun_visible_frac,earth_az_deg,earth_el_deg,earth_horizon_deg,earth_visible_frac,sunlit,earth_in_view,dsn_in_view,dte,relay_link,any_comms,power_w,battery_wh'];
    for (let i = 0; i < s.n; i++) {
      rows.push([new Date(s.t0 + i * s.step).toISOString(), s.sunAz[i].toFixed(3), s.sunEl[i].toFixed(4), s.sunHz[i].toFixed(3), s.sunFrac[i].toFixed(3),
        s.earthAz[i].toFixed(3), s.earthEl[i].toFixed(4), s.earthHz[i].toFixed(3), s.earthFrac[i].toFixed(3), s.lit[i], s.earthVis[i], s.dsnAny[i], s.dte[i], s.relayLink[i], s.comms[i],
        s.power[i].toFixed(1), s.soc[i].toFixed(0)].join(','));
    }
    download(`${site.id}_${fmtTime(s.t0, { dateOnly: true })}_${st.span}d.csv`, rows.join('\n'), 'text/csv');
  }
  function exportPng() {
    const cv = (st.view === 'pano' ? pano : sky).cv;
    cv.toBlob((b) => download(`${site.id}_${isoMin(st.t).replace(/[:]/g, '')}.png`, b));
  }

  renderInfo();
  rebuild();
  if (st.view === 'sky') setView('sky');

  return {
    unmount() {
      cancelAnimationFrame(raf); document.removeEventListener('keydown', onKey); offSettings();
      pano.destroy(); sky.destroy(); tl.destroy(); clearTimeout(urlTimer);
    },
  };
}
