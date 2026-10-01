// Home: what the tool does, live conditions at every site, fast entry points.
import { h, store, getSite, engineOpts, fmtTime, fmtDeg, fmtLL, isoMin, groupTag } from '../ui.js';
import { snapshot, ephemTable, siteSeries, DAY, HOUR } from '../engine.js';
import { panorama } from '../charts.js';
import { installBanner } from '../install.js';

const FEATURES = [
  ['#/map', 'Site map', 'South-pole terrain with yearly sunlight and Earth-visibility maps. Tap any spot to trace its horizon.', '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v18M3 12h18"/>'],
  ['#/site', 'Horizon explorer', 'See the Sun and Earth move over the real skyline, scrub through time, and check power and DSN links.', '<path d="M2 18l6-6 4 3 5-6 5 5v4H2z"/><circle cx="17" cy="5" r="2"/>'],
  ['#/3d', '3D South Pole', 'Fly over real terrain as the Sun moves, with shadows traced live on your graphics card.', '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 12l9-5M12 12v10M12 12L3 7"/>'],
  ['#/compare', 'Compare sites', 'Rank candidate sites by sunlight, Earth visibility, longest shadow and energy over any period.', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],
  ['#/planner', 'Find landing windows', 'Test every landing time against a full mission profile and get a feasibility calendar you can export.', '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 15l2 2 4-4"/>'],
  ['#/learn', 'Learn the physics', 'Why the lunar poles have long shadows and wobbling Earthrises, explained with live demos.', '<path d="M2 7l10-4 10 4-10 4z"/><path d="M6 9v6c3 3 9 3 12 0V9"/>'],
];

export function mount(root) {
  const now = Date.now();
  const featured = getSite('connecting-ridge') || store.sites[0];
  const snap = snapshot(featured, now, engineOpts());
  // short tracks for the hero panorama
  const step = 30 * 60000, n = Math.round(16 * DAY / step);
  const t0 = Math.floor((now - 8 * DAY) / step) * step;
  const s = siteSeries(featured, ephemTable(t0, step, n), engineOpts());

  const heroPano = h('div.chart', { style: { height: '220px', borderRadius: '14px', overflow: 'hidden', background: '#03050b', marginTop: '18px' }, role: 'img', 'aria-label': `Live horizon view at ${featured.name}` });
  const hero = h('section.hero',
    h('div', { style: { fontSize: '13px', fontWeight: 700, letterSpacing: '.08em', color: '#8fb1ff', textTransform: 'uppercase', marginBottom: '8px' } }, 'CLPS Lunar Mission Browser'),
    h('h1', 'Where and when will the Sun and Earth be up?'),
    h('p', 'At the lunar south pole the Sun skims the horizon and Earth bobs in and out of view behind mountains. LunaHorizon traces real NASA LOLA terrain horizons and computes Sun and Earth positions, so you can compare landing sites and dates in seconds.'),
    h('div.row', { style: { marginTop: '16px' } },
      h('a.btn.primary', { href: `#/site/${featured.id}` }, 'Open the explorer'),
      h('a.btn', { href: '#/compare' }, 'Compare sites'),
      h('a.btn', { href: '#/planner' }, 'Find landing windows')),
    heroPano,
    h('div', { style: { fontSize: '12px', color: '#9aa6c0', marginTop: '6px' } },
      `Live now at ${featured.name} (${fmtLL(featured.lat, featured.lon)}) · ${fmtTime(now)} · Sun ${fmtDeg(snap.sun.el)} · Earth ${fmtDeg(snap.earth.el)}`));
  const r0 = Math.max(0, Math.round((now - t0) / step) - Math.round(8 * DAY / step)), r1 = s.n;
  const pano = panorama(heroPano, () => ({ hz: featured.hz, snap, zoom: 1, center: (snap.sun.az + (((snap.earth.az - snap.sun.az + 540) % 360) - 180) / 2 + 360) % 360,
    sunTrack: { az: s.sunAz.subarray(r0, r1), el: s.sunEl.subarray(r0, r1), n: r1 - r0 }, earthTrack: { az: s.earthAz.subarray(r0, r1), el: s.earthEl.subarray(r0, r1), n: r1 - r0 }, trackLabel: 'Tracks: ±8 days' }));

  const live = h('div.livegrid');
  for (const site of store.sites) {
    const sn = snapshot(site, now, engineOpts());
    live.append(h('a.siteitem', { href: `#/site/${site.id}?t=${isoMin(now)}`, style: { flexWrap: 'wrap' } },
      h('span.nm', site.name), groupTag(site),
      h('div.row', { style: { width: '100%', gap: '6px' } },
        h('span.pill.' + (sn.lit ? 'sun' : 'off'), sn.lit ? `Sun ${fmtDeg(sn.sun.el, 1)}` : 'Shadow'),
        h('span.pill.' + (sn.earthVis ? 'earth' : 'off'), sn.earthVis ? `Earth ${fmtDeg(sn.earth.el, 1)}` : 'No Earth'))));
  }

  const tip = installBanner();
  root.append(
    tip.el,
    hero,
    h('div', { style: { height: '22px' } }),
    h('div.features', FEATURES.map(([href, t, p, ic]) => h('a.card.feature', { href }, h('div.ic', { html: `<svg viewBox="0 0 24 24">${ic}</svg>` }), h('h3', t), h('p', p)))),
    h('div', { style: { height: '22px' } }),
    h('div.card', h('header', h('h2', 'Right now at every site'), h('div.spacer'), h('span.muted', { style: { fontSize: '12px' } }, fmtTime(now))), live),
    h('div', { style: { height: '22px' } }),
    h('div.card', h('h2', 'Built on real data'),
      h('p.muted', 'Terrain: NASA LRO LOLA polar DEMs (80 m and 240 m per pixel). Sun and Earth positions come from an analytic lunar ephemeris with the IAU lunar orientation model, checked against JPL DE421: mean error 0.002°, worst case 0.01°. The Sun\'s disk is 0.27° in radius, so that is far below the size of the Sun itself. Everything runs on your device and works offline after the first visit.'),
      h('a', { href: '#/learn/methods' }, 'Methods, accuracy and sources →')),
  );
  return { unmount() { pano.destroy(); tip.destroy(); } };
}
