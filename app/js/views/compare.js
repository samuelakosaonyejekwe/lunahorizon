// Compare Sites: ranked metrics, synchronized swimlanes, daily calendar heatmap.
import { h, store, getSite, settings, onSettings, engineOpts, compute, siteMsg, fmtPct, fmtDur, fmtTime, toDateInput, fromDateInput,
  query, setQuery, isoMin, parseIso, download, icon, ICONS, groupTag, startOfDayUTC, toast, escHtml, csvCell } from '../ui.js';
import { swimlanes, heatmap, colors, rampColor, isDark } from '../charts.js';
import { HOUR, DAY } from '../engine.js';

const DURS = [[30, '1 month'], [90, '3 months'], [182, '6 months'], [365, '1 year']];
const PRESETS = {
  artemis: ['connecting-ridge', 'peak-near-shackleton', 'nobile-rim-1', 'nobile-rim-2', 'mons-mouton', 'mons-mouton-plateau', 'malapert-massif', 'de-gerlache-rim-2', 'haworth', 'slater-plain', 'peak-near-cabeus-b'],
  clps: ['im2-athena', 'im1-odysseus', 'blue-ghost-m1', 'schrodinger'],
  contrast: ['connecting-ridge', 'malapert-massif', 'shackleton-floor', 'blue-ghost-m1', 'schrodinger'],
};
const DEFAULT_SITES = ['connecting-ridge', 'peak-near-shackleton', 'nobile-rim-1', 'nobile-rim-2', 'mons-mouton', 'malapert-massif'];
const COLS = [
  ['sunPct', 'Sunlit', (v) => fmtPct(v, 1), 1, 'sun'],
  ['earthPct', 'Earth in view', (v) => fmtPct(v, 1), 1, 'earth'],
  ['dtePct', 'DTE avail.', (v) => fmtPct(v, 1), 1, 'earth'],
  ['bothPct', 'Sun + Earth', (v) => fmtPct(v, 1), 1, 'both'],
  ['commsPct', 'Comms (DTE + relay)', (v) => fmtPct(v, 1), 1, 'earth'],
  ['longestNoCommsH', 'Longest comms gap', fmtDur, -1, null],
  ['longestDarkH', 'Longest shadow', fmtDur, -1, null],
  ['longestNoEarthH', 'Longest Earth loss', fmtDur, -1, null],
  ['energyPerDayWh', 'Energy/day', (v) => `${(v / 1000).toFixed(2)} kWh`, 1, null],
  ['minSocPct', 'Min battery', (v) => fmtPct(v), 1, null],
];

export function mount(root) {
  const q = query();
  const st = {
    sites: (q.sites ? q.sites.split(',') : DEFAULT_SITES).filter(getSite),
    start: isFinite(parseIso(q.start)) ? parseIso(q.start) : startOfDayUTC(Date.now()),
    days: Math.min(730, Math.max(1, Math.round(+q.days) || 90)),     // links are user input: keep the run bounded
    metric: { dte: 'comms' }[q.metric] || (['lit', 'earth', 'comms', 'both'].includes(q.metric) ? q.metric : 'lit'),
    sort: COLS.some((c) => c[0] === q.sort) ? q.sort : 'sunPct', dir: -1,
    res: null, busy: false,
  };
  if (!st.sites.length) st.sites = DEFAULT_SITES;

  const chipBox = h('div.chips');
  const startIn = h('input', { type: 'date', value: toDateInput(st.start), 'aria-label': 'Start date', onchange: () => { const v = fromDateInput(startIn.value); if (isFinite(v)) { st.start = v; run(); } } });
  const durSeg = h('div.seg', DURS.map(([d, l]) => h('button', { class: d === st.days ? 'on' : '', onclick: (e) => { st.days = d; [...durSeg.children].forEach((b) => b.classList.toggle('on', b === e.target)); run(); } }, l)));
  const zoneName = () => (settings.tz === 'utc' ? 'UTC' : 'local');
  const startLbl = h('span'), dayLbl = h('span.muted', { style: { fontSize: '13px' } });
  const zoneLabels = () => { startLbl.textContent = `Start (${zoneName()} day)`; dayLbl.textContent = `% of each ${zoneName()} day`; };
  zoneLabels();
  const status = h('div');
  const tableBox = h('div.tablewrap');
  const laneBox = h('div.chart', { style: { height: '300px' } });
  const heatBox = h('div.chart.heat', { style: { height: '280px' } });
  const metricSeg = h('div.seg', [['lit', 'Sunlit'], ['earth', 'Earth'], ['comms', 'Comms'], ['both', 'Sun+Earth']].map(([k, l]) =>
    h('button', { class: k === st.metric ? 'on' : '', onclick: (e) => { st.metric = k; [...metricSeg.children].forEach((b) => b.classList.toggle('on', b === e.target)); save(); heat.redraw(); updRamp(); } }, l)));

  // ---- 18.6-year cycle
  const Y0 = 2026, NY = 19;
  const cyc = { res: null, metric: 'sun', busy: false };
  const cycBox = h('div.chart.heat', { style: { height: '220px' } });
  const cycStatus = h('div');
  const cycNote = h('p.muted', { style: { fontSize: '13px', margin: '8px 0 0' } });
  const cycSeg = h('div.seg', [['sun', 'Sunlit'], ['earth', 'Earth'], ['both', 'Sun+Earth'], ['comms', 'Comms']].map(([k, l]) =>
    h('button', { class: k === cyc.metric ? 'on' : '', onclick: (e) => { cyc.metric = k; [...cycSeg.children].forEach((b) => b.classList.toggle('on', b === e.target)); cycHeat.redraw(); cycSummary(); } }, l)));
  const cycCard = h('div.card', { style: { marginTop: '16px' } },
    h('header', h('h2', `Across the 18.6-year lunar cycle (${Y0}–${Y0 + NY - 1})`), h('div.spacer'), cycSeg),
    h('p.muted', { style: { fontSize: '13px', margin: '0 0 10px' } }, 'The Moon\'s orbit precesses every 18.6 years, so some years are better than others. Each cell is one whole calendar year; colors are scaled to the range shown, so small differences stand out.'),
    cycStatus, cycBox, cycNote);
  const cycHeat = heatmap(cycBox, () => {
    if (!cyc.res) return null;
    const rows = cyc.res.map((r) => ({ id: r.id, label: getSite(r.id)?.name || r.id, values: r[cyc.metric], r }));
    let lo = Infinity, hi = -Infinity;
    for (const r of rows) for (const v of r.values) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
    return { t0: 0, nd: NY, hue: { sun: 38, earth: 214, both: 158, comms: 250 }[cyc.metric], domain: [lo, hi],
      colLabels: Array.from({ length: NY }, (_, k) => String(Y0 + k)), rows,
      cellTip: (row, d) => `<b>${escHtml(row.label)}</b> · ${Y0 + d}<br>Sunlit ${fmtPct(row.r.sun[d], 1)} · Earth ${fmtPct(row.r.earth[d], 1)}<br>Sun+Earth ${fmtPct(row.r.both[d], 1)} · Comms ${fmtPct(row.r.comms[d], 1)}<br>Longest shadow ${fmtDur(row.r.dark[d])}` };
  }, (row, d) => { location.hash = `#/site/${row.id}?t=${Y0 + d}-01-01T00:00Z&span=365`; });
  function cycSummary() {
    if (!cyc.res) return;
    const lines = cyc.res.map((r) => {
      const v = [...r[cyc.metric]]; const mx = Math.max(...v), mn = Math.min(...v);
      return { name: getSite(r.id)?.name || r.id, swing: mx - mn, best: Y0 + v.indexOf(mx), worst: Y0 + v.indexOf(mn) };
    }).sort((a, b) => b.swing - a.swing);
    const top = lines[0];
    cycNote.textContent = top ? `Biggest swing: ${top.name}, ${top.swing.toFixed(1)} points between its best year (${top.best}) and worst (${top.worst}). Smallest: ${lines[lines.length - 1].name}, ${lines[lines.length - 1].swing.toFixed(1)} points.` : '';
  }
  async function runCycle() {
    const sites = st.sites.map(getSite).filter(Boolean);
    if (!sites.length) return;
    const my = (cyc.run = (cyc.run || 0) + 1);
    cycStatus.replaceChildren(h('div.busy', h('div.spinner'), h('span', 'Computing 19 years…')));
    try {
      const res = await compute({ type: 'years', sites: sites.map(siteMsg), opts: engineOpts(), year0: Y0, years: NY, stepH: 6 },
        (m) => { const s = cycStatus.querySelector('.busy span'); if (s) s.textContent = m; });
      if (my !== cyc.run) return;
      cyc.res = res.results; cycStatus.replaceChildren();
      cycBox.style.height = `${Math.max(90, sites.length * 25 + 26)}px`;
      cycHeat.redraw(); cycSummary();
    } catch (e) { cycStatus.replaceChildren(h('div.warnbox', '19-year analysis failed: ' + e.message)); }
  }

  root.append(
    h('div.pagehead', h('div', h('h1', 'Compare landing sites'), h('p', 'Pick sites and a period. Every site shares one ephemeris run, so a year across ten sites takes seconds. Click any row, lane or cell to open that site at that moment.'))),
    h('div.card', { style: { marginBottom: '16px' } },
      h('div.row', { style: { marginBottom: '10px' } }, h('b', 'Sites'), h('div.spacer', { style: { flex: 1 } }),
        h('button.btn.small', { onclick: () => preset('artemis') }, 'Artemis III regions'),
        h('button.btn.small', { onclick: () => preset('clps') }, 'CLPS missions'),
        h('button.btn.small', { onclick: () => preset('contrast') }, 'Best vs worst'),
        h('button.btn.small.ghost', { onclick: () => { st.sites = []; renderChips(); } }, 'Clear')),
      chipBox,
      h('div.hr'),
      h('div.row', h('label.field', { style: { width: '170px' } }, startLbl, startIn), h('div.field', h('span', 'Period'), durSeg),
        h('div', { style: { flex: 1 } }), h('button.btn.primary', { onclick: run }, icon(ICONS.compare), 'Compare'))),
    status,
    h('div.card', { style: { marginBottom: '16px' } }, h('header', h('h2', 'Ranking'), h('span.muted', { style: { fontSize: '13px' } }, 'click a column to sort · ★ best'), h('div.spacer'),
      h('button.btn.small', { onclick: exportCsv }, icon(ICONS.dl), 'CSV')), tableBox),
    h('div.card', { style: { marginBottom: '16px' } }, h('header', h('h2', 'Sunlight and Earth visibility over time'), h('div.spacer'),
      h('div.legend', h('span', h('i', { style: { background: 'var(--sun)' } }), 'Sunlit'), h('span', h('i', { style: { background: 'var(--earth)' } }), 'Earth in view'))), laneBox),
    h('div.card', h('header', h('h2', 'Daily calendar'), dayLbl, h('div.spacer'), metricSeg), heatBox,
      h('div.legend', { style: { marginTop: '8px' } }, h('span', 'Low'), h('span', { style: { display: 'inline-block', width: '160px', height: '10px', borderRadius: '3px', background: 'linear-gradient(90deg, var(--surface-2), var(--accent))' }, id: 'heatramp' }), h('span', 'High'))),
    cycCard,
  );

  function renderChips() {
    chipBox.replaceChildren(...store.sites.map((s) => h('button.chip', { class: st.sites.includes(s.id) ? 'on' : '', 'aria-pressed': st.sites.includes(s.id),
      onclick: () => { st.sites = st.sites.includes(s.id) ? st.sites.filter((x) => x !== s.id) : [...st.sites, s.id]; renderChips(); } }, s.name)));
  }
  function preset(k) { st.sites = PRESETS[k].filter(getSite); renderChips(); run(); }
  function save() { setQuery({ sites: st.sites.join(','), start: isoMin(st.start).slice(0, 10), days: st.days, metric: st.metric }); }

  const laneCfg = () => {
    if (!st.res) return null;
    const c = colors();
    return { t0: st.res.t0, step: st.res.step, n: st.res.n, rows: st.res.results.map((r) => ({ id: r.id, label: getSite(r.id)?.name || r.id,
      lanes: [{ name: 'Sunlit', data: r.lit, color: c.sun }, { name: 'Earth in view', data: r.earthVis, color: c.earth }] })) };
  };
  const lanes = swimlanes(laneBox, laneCfg, (row, t) => { location.hash = `#/site/${row.id}?t=${isoMin(t)}&span=30`; });
  const HUES = { lit: 38, earth: 214, comms: 250, both: 158 };
  const heat = heatmap(heatBox, () => {
    if (!st.res) return null;
    const key = st.metric;
    return {
      t0: st.res.t0, nd: st.res.results[0]?.daily.nd || 0, hue: HUES[key],
      rows: st.res.results.map((r) => ({ id: r.id, label: getSite(r.id)?.name || r.id, values: r.daily[key] })),
      cellTip: (row, d) => {
        const r = st.res.results.find((x) => x.id === row.id);
        return `<b>${escHtml(row.label)}</b><br>${fmtTime(st.res.t0 + d * DAY, { dateOnly: true })}<br>Sunlit ${fmtPct(r.daily.lit[d])} · Earth ${fmtPct(r.daily.earth[d])}<br>Comms ${fmtPct(r.daily.comms[d])} · Sun+Earth ${fmtPct(r.daily.both[d])}<br>Mean power ${r.daily.power[d].toFixed(0)} W`;
      },
    };
  }, (row, d) => { location.hash = `#/site/${row.id}?t=${isoMin(st.res.t0 + d * DAY + 12 * HOUR)}&span=30`; });

  function updRamp() {
    const el = heatBox.parentElement?.querySelector('#heatramp');
    if (el) el.style.background = `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => rampColor(HUES[st.metric], t, isDark())).join(',')})`;
  }
  window.addEventListener('themechange', updRamp);

  function renderTable() {
    const res = st.res; if (!res) return;
    const rows = res.results.map((r) => ({ id: r.id, s: getSite(r.id), x: r.stats }));
    const col = COLS.find((c) => c[0] === st.sort) || COLS[0];
    rows.sort((a, b) => (a.x[st.sort] - b.x[st.sort]) * st.dir);
    const best = {};
    for (const [k, , , better] of COLS) {
      const vals = rows.map((r) => r.x[k]);
      const hi = Math.max(...vals), lo = Math.min(...vals);
      best[k] = hi - lo < 1e-9 ? NaN : better > 0 ? hi : lo; // a tie across every site has no winner
    }
    const c = colors();
    const colorOf = { sun: c.sun, earth: c.earth, both: c.both };
    const th = (k, l) => h('th', { class: st.sort === k ? 'sorted' : '', scope: 'col', 'aria-sort': st.sort === k ? (st.dir > 0 ? 'ascending' : 'descending') : 'none',
      onclick: () => { if (st.sort === k) st.dir *= -1; else { st.sort = k; st.dir = COLS.find((c) => c[0] === k)[3] > 0 ? -1 : 1; } renderTable(); } }, l, st.sort === k ? (st.dir > 0 ? ' ▲' : ' ▼') : '');
    tableBox.replaceChildren(h('table.data',
      h('thead', h('tr', h('th', { scope: 'col' }, 'Site'), COLS.map(([k, l]) => th(k, l)))),
      h('tbody', rows.map((r) => h('tr', { onclick: () => { location.hash = `#/site/${r.id}?t=${isoMin(res.t0)}&span=${Math.min(365, st.days)}`; }, tabindex: 0,
        onkeydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); } },
        h('td', h('div', { style: { fontWeight: 700 } }, r.s?.name || r.id), h('div', { style: { fontSize: '11px' } }, groupTag(r.s || {}))),
        COLS.map(([k, , fmt, better, color]) => {
          const v = r.x[k];
          const isBest = rows.length > 1 && Math.abs(v - best[k]) < 1e-9;
          const pct = color ? Math.max(0, Math.min(100, v)) : null;
          return h('td', { class: isBest ? 'best' : '' }, color ? h('span.bar', fmt(v), h('i', { style: { width: pct + '%', background: colorOf[color] } })) : fmt(v));
        }))))));
  }

  async function run() {
    if (!st.sites.length) { toast('Select at least one site'); return; }
    save();
    const step = st.days > 200 ? 2 * HOUR : HOUR;
    const n = Math.round(st.days * DAY / step);
    status.replaceChildren(h('div.card', { style: { marginBottom: '16px' } }, h('div.busy', h('div.spinner'), h('span', 'Computing…'))));
    const my = (st.runId = (st.runId || 0) + 1);
    try {
      const sites = st.sites.map(getSite).filter(Boolean);
      const res = await compute({ type: 'scan', t0: st.start, step, n, sites: sites.map(siteMsg), opts: engineOpts(), lanes: true },
        (m) => { const s = status.querySelector('.busy span'); if (s) s.textContent = m; });
      if (my !== st.runId) return;
      st.res = { ...res, t0: st.start, step, n };
      status.replaceChildren();
      renderTable(); lanes.redraw(); heat.redraw(); updRamp();
      runCycle();
      laneBox.style.height = `${Math.max(120, sites.length * 30 + 30)}px`;
      heatBox.style.height = `${Math.max(90, sites.length * 25 + 26)}px`;
    } catch (e) {
      status.replaceChildren(h('div.card.warnbox', { style: { marginBottom: '16px' } }, 'Computation failed: ' + e.message));
    }
  }

  function exportCsv() {
    if (!st.res) return;
    const head = ['site', 'lat', 'lon', ...COLS.map((c) => c[0])];
    const lines = [head.join(',')];
    for (const r of st.res.results) { const s = getSite(r.id); lines.push([csvCell(s.name), s.lat, s.lon, ...COLS.map((c) => r.stats[c[0]].toFixed(2))].join(',')); }
    download(`compare_${isoMin(st.start).slice(0, 10)}_${st.days}d.csv`, lines.join('\n'), 'text/csv');
  }

  const off = onSettings(() => { zoneLabels(); startIn.value = toDateInput(st.start); run(); });
  renderChips();
  run();
  return { unmount() { off(); lanes.destroy(); heat.destroy(); cycHeat.destroy(); window.removeEventListener('themechange', updRamp); } };
}
