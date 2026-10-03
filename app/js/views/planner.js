// Landing Window Finder: sweeps every candidate landing time over a search range and evaluates the full surface stay.
import { RELAYS } from '../astro.js';
import { h, store, getSite, settings, onSettings, engineOpts, compute, siteMsg, fmtPct, fmtDur, fmtTime, toDateInput, fromDateInput,
  query, setQuery, isoMin, parseIso, download, icon, ICONS, groupTag, startOfDayUTC, toast } from '../ui.js';
import { heatmap } from '../charts.js';
import { HOUR, DAY } from '../engine.js';

const PROFILES = {
  artemis: { label: 'Artemis III crewed (6.5 d)', durH: 156, minLitPct: 100, maxDarkH: 0, minCommPct: 50, maxNoCommH: 48, useDSN: false, requireLanding: true, landSunMin: -2, landSunMax: 10,
    why: 'Crew surface stays need continuous sunlight for the whole stay; comms can partly go through relay, so DTE is a softer constraint.' },
  clps: { label: 'CLPS lander (10 d)', durH: 240, minLitPct: 70, maxDarkH: 48, minCommPct: 60, maxNoCommH: 72, useDSN: true, requireLanding: true, landSunMin: -2, landSunMax: 20,
    why: 'Solar-powered landers must land in sunlight with a comms path (Earth, or a relay), then survive short shadows on battery.' },
  rover: { label: 'Long-duration rover (100 d)', durH: 2400, minLitPct: 55, maxDarkH: 110, minCommPct: 50, maxNoCommH: 200, useDSN: true, requireLanding: true, landSunMin: -2, landSunMax: 20,
    why: 'A VIPER-class rover must ride through several lunar days, so seasonal lighting dominates.' },
  custom: { label: 'Custom', durH: 168, minLitPct: 80, maxDarkH: 24, minCommPct: 50, maxNoCommH: 48, useDSN: true, requireLanding: true, landSunMin: -2, landSunMax: 20, why: 'Set your own constraints.' },
};
const FAILS = [[1, 'not enough sunlight'], [2, 'shadow too long'], [4, 'not enough comms'], [8, 'comms blackout too long'], [16, 'landing conditions not met']];

// Constraints shared in a link are untrusted: keep only known keys, clamped to the slider ranges
const C_RANGES = { durH: [24, 2400], minLitPct: [0, 100], maxDarkH: [0, 300], minCommPct: [0, 100], maxNoCommH: [0, 400], landSunMin: [-2, 30], landSunMax: [0, 90] };
function parseC(v) {
  let raw;
  try { raw = v ? JSON.parse(atob(v)) : {}; } catch { return {}; }
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(C_RANGES)) if (Number.isFinite(+raw[k])) out[k] = Math.min(hi, Math.max(lo, +raw[k]));
  for (const k of ['useDSN', 'requireLanding']) if (typeof raw[k] === 'boolean') out[k] = raw[k];
  return out;
}

export function mount(root) {
  const q = query();
  const prof = PROFILES[q.profile] ? q.profile : 'artemis';
  const linked = parseC(q.c);
  // a shared link whose constraints differ from its preset is a custom search
  const edited = prof !== 'custom' && Object.keys(linked).some((k) => linked[k] !== PROFILES[prof][k]);
  const st = {
    profile: edited ? 'custom' : prof,
    c: { ...PROFILES[prof], ...linked, ...(edited ? { label: 'Custom', why: `Custom constraints, starting from the ${PROFILES[prof].label} profile.` } : {}) },
    sites: (q.sites ? q.sites.split(',') : ['connecting-ridge', 'peak-near-shackleton', 'nobile-rim-2', 'mons-mouton', 'malapert-massif', 'de-gerlache-rim-2']).filter(getSite),
    start: isFinite(parseIso(q.start)) ? parseIso(q.start) : startOfDayUTC(Date.now()),
    months: Math.min(24, Math.max(1, Math.round(+q.months) || 12)),   // links are user input: keep the search bounded
    res: null,
  };

  const chipBox = h('div.chips');
  const profSeg = h('div.seg', Object.entries(PROFILES).map(([k, p]) => h('button', { class: k === st.profile ? 'on' : '', onclick: (e) => {
    st.profile = k; st.c = { ...PROFILES[k] }; [...profSeg.children].forEach((b) => b.classList.toggle('on', b === e.target)); renderConstraints(); run(); } }, p.label)));
  const why = h('p.muted', { style: { fontSize: '13px', margin: '8px 0 0' } });
  const consBox = h('div.formgrid');
  const startLbl = h('span');
  const startIn = h('input', { type: 'date', value: toDateInput(st.start), onchange: () => { const v = fromDateInput(startIn.value); if (isFinite(v)) st.start = v; } });
  const monthsIn = h('select', { onchange: () => { st.months = +monthsIn.value; } }, [1, 3, 6, 12, 18, 24].map((m) => h('option', { value: m, selected: m === st.months }, `${m} month${m > 1 ? 's' : ''}`)));
  const status = h('div');
  const summaryBox = h('div');
  const heatBox = h('div.chart.heat', { style: { height: '240px' } });
  const listBox = h('div');
  const opSortSeg = h('div.seg', { 'aria-label': 'Sort opportunities' }, [['date', 'By date'], ['score', 'Best first'], ['days', 'Longest window']].map(([k, l]) =>
    h('button', { 'data-k': k, class: k === 'date' ? 'on' : '', onclick: () => { st.opSort = k; if (st.ops) renderOps(); } }, l)));

  root.append(
    h('div.pagehead', h('div', h('h1', 'Landing window finder'), h('p', 'Every possible landing time is tested against the full surface stay: sunlight, battery-bridging shadows, Earth line of sight and DSN coverage. The result shows when each site works.'))),
    h('div.grid', { style: { gridTemplateColumns: 'minmax(0,1fr)' } },
      h('div.card',
        h('div.field', h('span', 'Mission profile'), profSeg), why,
        h('div.hr'),
        h('b', 'Constraints'), h('div', { style: { height: '8px' } }), consBox,
        h('div.hr'),
        h('div.row', { style: { marginBottom: '8px' } }, h('b', 'Sites'), h('div', { style: { flex: 1 } }),
          h('button.btn.small', { onclick: () => { st.sites = store.sites.filter((s) => s.group === 'Artemis').map((s) => s.id); renderChips(); } }, 'All Artemis regions'),
          h('button.btn.small.ghost', { onclick: () => { st.sites = []; renderChips(); } }, 'Clear')),
        chipBox,
        h('div.hr'),
        h('div.row', h('label.field', { style: { width: '170px' } }, startLbl, startIn), h('label.field', { style: { width: '150px' } }, h('span', 'Search span'), monthsIn),
          h('div', { style: { flex: 1 } }), h('button.btn.primary', { onclick: run }, icon(ICONS.search), 'Find windows'))),
      status, summaryBox,
      h('div.card', h('header', h('h2', 'Feasibility calendar'), h('span.muted', { style: { fontSize: '13px' } }, 'best landing time each day · gray = no feasible landing'), h('div.spacer'),
        h('div.legend', h('span', h('i', { style: { background: 'var(--surface-2)' } }), 'Infeasible'), h('span', h('i', { style: { background: 'hsl(158 70% 45%)' } }), 'Feasible (darker = better)'))), heatBox),
      h('div.card', h('header', h('h2', 'Landing opportunities'), h('div.spacer'), opSortSeg,
        h('button.btn.small', { onclick: exportIcs, title: 'Add the opportunities to your calendar app' }, icon(ICONS.cal), 'Calendar (.ics)'),
        h('button.btn.small', { onclick: exportCsv }, icon(ICONS.dl), 'CSV')), listBox),
    ));

  function slider(label, key, min, max, step, unit) {
    const out = h('output', `${st.c[key]}${unit}`);
    const inp = h('input', { type: 'range', min, max, step, value: st.c[key], 'aria-label': label,
      oninput: () => { st.c[key] = +inp.value; out.textContent = `${inp.value}${unit}`; markCustom(); } });
    return h('label.field', h('span', label, out), inp);
  }
  function check(label, key) {
    return h('label.check', h('input', { type: 'checkbox', checked: st.c[key], onchange: (e) => { st.c[key] = e.target.checked; markCustom(); } }), label);
  }
  function markCustom() {
    if (st.profile === 'custom') return;
    const from = PROFILES[st.profile].label;
    st.profile = 'custom'; st.c.label = 'Custom'; st.c.why = `Custom constraints, starting from the ${from} profile.`;
    [...profSeg.children].forEach((b, i) => b.classList.toggle('on', Object.keys(PROFILES)[i] === 'custom'));
    renderWhy();
  }
  function renderWhy() {
    why.textContent = (st.c.why || '') + (settings.relay && settings.relay !== 'none' ? ` Comms include the relay: ${RELAYS[settings.relay].name}.` : ' Comms are direct-to-Earth only; add a relay orbiter in Settings.');
    startLbl.textContent = `Search from (${settings.tz === 'utc' ? 'UTC' : 'local'})`;
  }
  function renderConstraints() {
    renderWhy();
    consBox.replaceChildren(
      slider('Surface stay', 'durH', 24, 2400, 6, ' h'),
      slider('Min sunlit time', 'minLitPct', 0, 100, 1, '%'),
      slider('Max continuous shadow', 'maxDarkH', 0, 300, 1, ' h'),
      slider('Min comms time', 'minCommPct', 0, 100, 1, '%'),
      slider('Max comms blackout', 'maxNoCommH', 0, 400, 1, ' h'),
      slider('Landing Sun elevation ≥', 'landSunMin', -2, 30, 0.5, '°'),
      slider('Landing Sun elevation ≤', 'landSunMax', 0, 90, 0.5, '°'),
      h('div.field', { style: { gridColumn: 'span 2' } }, h('span', 'Options'), check('Comms needs a DSN station', 'useDSN'), check('Land in sunlight with a comms path (Earth or relay)', 'requireLanding')),
    );
  }
  function renderChips() {
    chipBox.replaceChildren(...store.sites.map((s) => h('button.chip', { class: st.sites.includes(s.id) ? 'on' : '', 'aria-pressed': st.sites.includes(s.id),
      onclick: () => { st.sites = st.sites.includes(s.id) ? st.sites.filter((x) => x !== s.id) : [...st.sites, s.id]; renderChips(); } }, s.name)));
  }

  const heat = heatmap(heatBox, () => {
    if (!st.res) return null;
    return { t0: st.start, nd: st.res.nd, hue: 158,
      rows: st.res.rows.map((r) => ({ id: r.id, label: r.name, values: r.dayScore, r })),
      cellTip: (row, d) => {
        const r = row.r, k = r.dayBest[d];
        const date = fmtTime(st.start + d * DAY, { dateOnly: true });
        if (k < 0 || r.dayScore[d] < 0) {
          return `<b>${r.name}</b><br>${date}<br>No feasible landing: ${r.dayFail[d] || 'constraints not met'}`;
        }
        const s = r.scan;
        return `<b>${r.name}</b><br>Land ${fmtTime(st.start + k * s.startStep * st.res.step)}<br>Sunlit ${fmtPct(s.lit[k])} · longest shadow ${fmtDur(s.maxDarkH[k])}<br>Comms ${fmtPct(st.c.useDSN ? s.dte[k] : s.earth[k])} · longest blackout ${fmtDur(s.maxNoCommH[k])}<br>Min Sun clearance ${s.minClear[k].toFixed(2)}° · score ${s.score[k].toFixed(0)}/100`;
      } };
  }, (row, d) => {
    const k = row.r.dayBest[d];
    const t = k >= 0 ? st.start + k * row.r.scan.startStep * st.res.step : st.start + d * DAY;
    location.hash = `#/site/${row.id}?t=${isoMin(t)}&span=${st.c.durH > 700 ? 365 : 30}`;
  });

  async function run() {
    if (!st.sites.length) return toast('Select at least one site');
    const cEnc = btoa(JSON.stringify({ durH: st.c.durH, minLitPct: st.c.minLitPct, maxDarkH: st.c.maxDarkH, minCommPct: st.c.minCommPct, maxNoCommH: st.c.maxNoCommH, useDSN: st.c.useDSN, requireLanding: st.c.requireLanding, landSunMin: st.c.landSunMin, landSunMax: st.c.landSunMax }));
    setQuery({ profile: st.profile, sites: st.sites.join(','), start: isoMin(st.start).slice(0, 10), months: st.months, c: cEnc });
    const step = st.c.durH > 1000 || st.months > 12 ? 2 * HOUR : HOUR;
    const searchDays = Math.round(st.months * 30.44);
    const n = Math.round((searchDays * DAY + st.c.durH * HOUR) / step);
    status.replaceChildren(h('div.card', h('div.busy', h('div.spinner'), h('span', 'Searching…'))));
    const my = (st.runId = (st.runId || 0) + 1);
    try {
      const sites = st.sites.map(getSite).filter(Boolean);
      const res = await compute({ type: 'scan', t0: st.start, step, n, sites: sites.map(siteMsg), opts: engineOpts(),
        window: { ...st.c, startEveryH: 3 } }, (m) => { const s = status.querySelector('.busy span'); if (s) s.textContent = m; });
      if (my !== st.runId) return;
      status.replaceChildren();
      digest(res, step, searchDays);
    } catch (e) { status.replaceChildren(h('div.card.warnbox', 'Search failed: ' + e.message)); }
  }

  function digest(res, step, nd) {
    const rows = res.results.map((r) => {
      const s = r.scan, site = getSite(r.id);
      const perDay = Math.round(DAY / (s.startStep * step));
      const dayScore = new Float32Array(nd).fill(-1), dayBest = new Int32Array(nd).fill(-1), dayFail = new Array(nd).fill('');
      for (let d = 0; d < nd; d++) {
        let best = -1, bk = -1; const fc = {};
        for (let k = d * perDay; k < Math.min(s.n, (d + 1) * perDay); k++) {
          if (s.score[k] > best) { best = s.score[k]; bk = k; }
          if (s.fail[k]) for (const [bit, txt] of FAILS) if (s.fail[k] & bit) fc[txt] = (fc[txt] || 0) + 1;
        }
        dayScore[d] = best; dayBest[d] = bk;
        if (best < 0) dayFail[d] = Object.entries(fc).sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]).join(', ');
      }
      // opportunities: runs of consecutive feasible days
      const ops = [];
      let d = 0;
      while (d < nd) {
        if (dayScore[d] < 0) { d++; continue; }
        let e = d, bd = d;
        while (e + 1 < nd && dayScore[e + 1] >= 0) { e++; if (dayScore[e] > dayScore[bd]) bd = e; }
        const k = dayBest[bd];
        ops.push({ site, from: st.start + d * DAY, to: st.start + (e + 1) * DAY, days: e - d + 1, bestT: st.start + k * s.startStep * step, k,
          score: s.score[k], minClear: s.minClear[k], lit: s.lit[k], comm: st.c.useDSN ? s.dte[k] : s.earth[k], maxDark: s.maxDarkH[k], maxNoComm: s.maxNoCommH[k], power: s.meanPowerW[k] });
        d = e + 1;
      }
      const feasibleDays = dayScore.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0);
      return { id: r.id, name: site.name, site, scan: s, dayScore, dayBest, dayFail, ops, feasibleDays };
    });
    st.res = { rows, nd, step };
    heatBox.style.height = `${Math.max(90, rows.length * 25 + 26)}px`;
    heat.redraw();
    const total = rows.reduce((a, r) => a + r.ops.length, 0);
    summaryBox.replaceChildren(h('div.card', h('header', h('h2', 'Summary')),
      h('div.kpis.k3',
        rows.slice().sort((a, b) => b.feasibleDays - a.feasibleDays).map((r) => h('div.kpi',
          h('div.k', r.name), h('div.v', { html: `${r.feasibleDays} <small>of ${nd} days</small>` }),
          h('div.s', r.ops.length ? `${r.ops.length} opportunit${r.ops.length === 1 ? 'y' : 'ies'} · next ${fmtTime(r.ops[0].bestT, { dateOnly: true })}` : 'no feasible landing in range')))),
      total === 0 ? h('p.warnbox', { style: { marginTop: '12px' } }, 'No site meets every constraint in this range. Relax the strictest constraint (usually max shadow or min sunlit time), or extend the search span.') : null));
    st.ops = rows.flatMap((r) => r.ops);
    renderOps();
  }

  function renderOps() {
    const key = st.opSort || 'date';
    const ops = st.ops.slice().sort(key === 'score' ? (a, b) => b.score - a.score : key === 'days' ? (a, b) => b.days - a.days : (a, b) => a.from - b.from);
    opSortSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === key));
    listBox.replaceChildren(ops.length ? h('div.tablewrap', h('table.data',
      h('thead', h('tr', ['Site', 'Window opens', 'Closes', 'Days', 'Best landing', 'Sunlit', 'Comms', 'Longest shadow', 'Longest blackout', 'Min Sun clearance', 'Score'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', ops.map((o) => h('tr', { tabindex: 0, onclick: () => { location.hash = `#/site/${o.site.id}?t=${isoMin(o.bestT)}&span=${st.c.durH > 700 ? 365 : 30}`; }, onkeydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); } },
        h('td', h('b', o.site.name), ' ', groupTag(o.site)), h('td', fmtTime(o.from, { dateOnly: true })), h('td', fmtTime(o.to - 1, { dateOnly: true })), h('td', o.days),
        h('td', fmtTime(o.bestT)), h('td', fmtPct(o.lit)), h('td', fmtPct(o.comm)), h('td', fmtDur(o.maxDark)), h('td', fmtDur(o.maxNoComm)), h('td', `${o.minClear.toFixed(2)}°`), h('td', o.score.toFixed(0)))))))
      : h('div.empty', 'No opportunities found with the current constraints.'));
  }

  function exportCsv() {
    if (!st.ops) return;
    const lines = ['site,window_open_utc,window_close_utc,days,best_landing_utc,sunlit_pct,comms_pct,longest_shadow_h,longest_blackout_h,min_sun_clearance_deg,mean_power_w,score'];
    for (const o of st.ops) lines.push([`"${o.site.name}"`, new Date(o.from).toISOString(), new Date(o.to).toISOString(), o.days, new Date(o.bestT).toISOString(),
      o.lit.toFixed(1), o.comm.toFixed(1), o.maxDark.toFixed(1), o.maxNoComm.toFixed(1), o.minClear.toFixed(3), o.power.toFixed(0), o.score.toFixed(1)].join(','));
    download('landing_windows.csv', lines.join('\n'), 'text/csv');
  }
  function exportIcs() {
    if (!st.ops?.length) return toast('Run a search first');
    const f = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const esc = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');   // RFC 5545 TEXT
    const ev = st.ops.map((o, i) => [
      'BEGIN:VEVENT', `UID:lunahorizon-${o.site.id}-${o.from}-${i}@lunahorizon`, `DTSTAMP:${f(Date.now())}`, `DTSTART:${f(o.from)}`, `DTEND:${f(o.to)}`,
      `SUMMARY:${esc(`Landing window: ${o.site.name}`)}`,
      `DESCRIPTION:${esc(`Best landing ${new Date(o.bestT).toISOString()} · sunlit ${o.lit.toFixed(0)}% · comms ${o.comm.toFixed(0)}% · longest shadow ${o.maxDark.toFixed(0)} h (${st.c.label || 'custom'} profile, ${st.c.durH} h stay)`)}`,
      'END:VEVENT'].join('\r\n'));
    download('landing_windows.ics', ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LunaHorizon//Landing Windows//EN', ...ev, 'END:VCALENDAR'].join('\r\n'), 'text/calendar');
  }

  const off = onSettings(() => { renderConstraints(); startIn.value = toDateInput(st.start); run(); });
  renderConstraints(); renderChips(); run();
  return { unmount() { off(); heat.destroy(); } };
}
