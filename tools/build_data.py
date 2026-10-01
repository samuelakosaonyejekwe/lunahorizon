"""
Builds every static data product the web app ships, from NASA LOLA polar DEMs.

Inputs (raw/):  ldem_80s_80m.img  (PDS LOLA GDR, 80 m/px, 80°S cap)
                ldem_75s_240m.img (PDS LOLA GDR, 240 m/px, 75°S cap)
Screening maps come from tools/overlay.mjs (run it first).

Outputs (app/data/):
  sites.json        curated sites with 0.5° terrain horizon profiles (2 m observer height)
  basemap.jpg       hillshade of the 80°S cap for the site map
  basemap_zoom.jpg  hillshade of the inner ±80 km
  overlay.png       R = % time Sun visible, G = % time Earth visible, B = % time both (one year, 1 km grid; computed by tools/overlay.mjs)
  raw/dem_near.bin.gz  int16 heights (m), 80°S cap resampled to 400 m; tools/build_dem_tiles.py splits it into app/data/dem_tiles/
  dem_far.bin.gz    int16 heights (m), 75°S cap resampled to 1600 m
  meta.json         grid geometry for all of the above
"""
import json, sys, os, gzip, base64, math, datetime as dt
import numpy as np
from PIL import Image

R_M = 1737400.0
ROOT = __file__.rsplit('/tools/', 1)[0]
RAW = ROOT + '/raw/'
OUT = ROOT + '/app/data/'
SKIP_MAP = '--skip-map' in sys.argv

# ---------------------------------------------------------------- DEMs
d80 = np.fromfile(RAW + 'ldem_80s_80m.img', dtype='<i2').reshape(7600, 7600).astype(np.float32) * 0.5
d240 = np.fromfile(RAW + 'ldem_75s_240m.img', dtype='<i2').reshape(3812, 3812).astype(np.float32) * 0.5
G80 = dict(arr=d80, scale=80.0, off=3799.5, n=7600)
G240 = dict(arr=d240, scale=240.0, off=1905.5, n=3812)


def ll_to_xy(lat, lon):
    """South polar stereographic (PDS convention), meters. lat/lon radians."""
    rho = 2 * R_M * np.tan(np.pi / 4 + lat / 2)
    return rho * np.sin(lon), rho * np.cos(lon)


def xy_to_ll(x, y):
    rho = np.hypot(x, y)
    lat = 2 * np.arctan(rho / (2 * R_M)) - np.pi / 2
    lon = np.arctan2(x, y)
    return lat, lon


def sample(g, x, y):
    """Bilinear sample; returns nan outside."""
    s = g['off'] + x / g['scale']
    l = g['off'] - y / g['scale']
    n = g['n']
    ok = (s >= 0) & (s < n - 1) & (l >= 0) & (l < n - 1)
    s = np.where(ok, s, 0); l = np.where(ok, l, 0)
    s0 = np.floor(s).astype(np.int64); l0 = np.floor(l).astype(np.int64)
    fs = (s - s0).astype(np.float32); fl = (l - l0).astype(np.float32)
    a = g['arr']
    v = (a[l0, s0] * (1 - fs) * (1 - fl) + a[l0, s0 + 1] * fs * (1 - fl)
         + a[l0 + 1, s0] * (1 - fs) * fl + a[l0 + 1, s0 + 1] * fs * fl)
    return np.where(ok, v, np.nan)


def height(x, y, fine=True):
    if fine:
        h = sample(G80, x, y)
        return np.where(np.isnan(h), sample(G240, x, y), h)
    return sample(G240, x, y)


def height_ll(lat_deg, lon_deg):
    x, y = ll_to_xy(np.radians(lat_deg), np.radians(lon_deg))
    return float(height(np.array([x]), np.array([y]))[0])


# ---------------------------------------------------------------- high-resolution windows (tools/fetch_windows.py)
def load_windows(site_id):
    wins = []
    for res in ('5m', '20m'):
        p = f'{ROOT}/raw/win/{site_id}_{res}.npz'
        if os.path.exists(p):
            z = np.load(p)
            wins.append(dict(res=res, arr=z['dem'].astype(np.float32) * 0.5, l0=int(z['l0']), s0=int(z['s0']), off=float(z['off']), scale=float(z['scale'])))
    return wins


def sample_win(w, x, y):
    s = w['off'] + x / w['scale'] - w['s0']
    l = w['off'] - y / w['scale'] - w['l0']
    H, W = w['arr'].shape
    ok = (s >= 0) & (s < W - 1) & (l >= 0) & (l < H - 1)
    s = np.where(ok, s, 0); l = np.where(ok, l, 0)
    s0 = np.floor(s).astype(np.int64); l0 = np.floor(l).astype(np.int64)
    fs = (s - s0).astype(np.float32); fl = (l - l0).astype(np.float32)
    a = w['arr']
    v = a[l0, s0] * (1 - fs) * (1 - fl) + a[l0, s0 + 1] * fs * (1 - fl) + a[l0 + 1, s0] * (1 - fs) * fl + a[l0 + 1, s0 + 1] * fs * fl
    return np.where(ok, v, np.nan)


def height_layered(x, y, wins):
    h = np.full(np.shape(x), np.nan, dtype=np.float64)
    for w in wins:                                  # finest first
        miss = np.isnan(h)
        if miss.any():
            h = np.where(miss, sample_win(w, x, y), h)
    miss = np.isnan(h)
    if miss.any():
        h = np.where(miss, height(x, y, True), h)
    return h


def horizon(lat_deg, lon_deg, mast=2.0, n_rays=1440, dmax=260e3, n_d=1400, fine=True, dmin=100.0, wins=None):
    """Terrain horizon elevation (deg) for n_rays azimuths (clockwise from north)."""
    phi1 = np.radians(lat_deg); lam1 = np.radians(lon_deg)
    wins = wins or []
    if wins:
        dmin = 25.0 if wins[0]['res'] == '5m' else 60.0
        n_d = 2200
    x0, y0 = ll_to_xy(np.radians(np.array([lat_deg])), np.radians(np.array([lon_deg])))
    h0 = float(height_layered(x0, y0, wins)[0]) if wins else height_ll(lat_deg, lon_deg)
    r1 = R_M + h0 + mast
    d = np.geomspace(dmin, dmax, n_d)
    delta = d / R_M
    th = np.radians(np.arange(n_rays) * 360.0 / n_rays)[:, None]
    sp2 = np.sin(phi1) * np.cos(delta) + np.cos(phi1) * np.sin(delta) * np.cos(th)
    phi2 = np.arcsin(np.clip(sp2, -1, 1))
    lam2 = lam1 + np.arctan2(np.sin(th) * np.sin(delta) * np.cos(phi1), np.cos(delta) - np.sin(phi1) * sp2)
    x, y = ll_to_xy(phi2, lam2)
    h = height_layered(x, y, wins) if wins else height(x, y, fine)
    r2 = R_M + h
    el = np.degrees(np.arctan2(r2 * np.cos(delta) - r1, r2 * np.sin(delta)))
    el = np.where(np.isnan(el), -90, el)
    hz = el.max(axis=1)
    return np.maximum(hz, -5.0), h0


# ---------------------------------------------------------------- sites
# precision: 'published' = coordinates from a published source; 'region' = representative point inside an
# Artemis III candidate region, auto-selected as the most-illuminated grid cell within `search_km`
# of an approximate region center (see overlay computation); 'feature' = named-feature coordinates.
SITES = [
    dict(id='connecting-ridge', name='Connecting Ridge', group='Artemis', lat=-89.53432, lon=209.94767, precision='published',
         src='Gracy & Lee, LPSC 2024 #1695', note='Ridge linking Shackleton and de Gerlache; among the best-lit terrain on the Moon.'),
    dict(id='peak-near-shackleton', name='Peak near Shackleton', group='Artemis', lat=-89.01701, lon=126.27302, precision='published',
         src='Gracy & Lee, LPSC 2024 #1695', note='Massif near Shackleton overlooking ice-bearing permanently shadowed regions.'),
    dict(id='nobile-rim-2', name='Nobile Rim 2', group='Artemis', lat=-84.20156, lon=60.69989, precision='published',
         src='Evaluating potential landing sites for Artemis III (Acta Astronautica 2024), best point in DM2',
         note='One of the 9 Artemis III candidate regions (Oct 2024).'),
    dict(id='mons-mouton', name='Mons Mouton', group='Artemis', lat=-84.6, lon=31.0, precision='region', search_km=6,
         src='IAU feature center 84.6°S 31.0°E', note='Broad flat-topped mountain; one of the 9 Artemis III candidate regions.'),
    dict(id='malapert-massif', name='Malapert Massif', group='Artemis', lat=-86.0, lon=0.0, precision='region', search_km=8,
         src='Approximate region center', note='Tall massif with good Earth visibility; Artemis III candidate region.'),
    dict(id='nobile-rim-1', name='Nobile Rim 1', group='Artemis', lat=-85.45, lon=38.0, precision='region', search_km=8,
         src='Approximate region center (west rim of Nobile)', note='Artemis III candidate region on the rim of Nobile crater.'),
    dict(id='de-gerlache-rim-2', name='de Gerlache Rim 2', group='Artemis', lat=-88.75, lon=-68.0, precision='region', search_km=8,
         src='Approximate region center', note='Artemis III candidate region on the rim of de Gerlache crater.'),
    dict(id='haworth', name='Haworth', group='Artemis', lat=-86.9, lon=-20.0, precision='region', search_km=10,
         src='Approximate region center', note='Artemis III candidate region near Haworth crater.'),
    dict(id='slater-plain', name='Slater Plain', group='Artemis', lat=-87.9, lon=-125.0, precision='region', search_km=10,
         src='Approximate region center', note='Artemis III candidate region; plains near Slater crater.'),
    dict(id='peak-near-cabeus-b', name='Peak near Cabeus B', group='Artemis', lat=-84.3, lon=-60.0, precision='region', search_km=12,
         src='Approximate region center', note='Artemis III candidate region; high peak near Cabeus B.'),
    dict(id='im2-athena', name='IM-2 Athena (Mons Mouton)', group='CLPS', lat=-84.7906, lon=29.1957, precision='published',
         src='Intuitive Machines / LROC, landed 2025-03-06', note='CLPS lander; touched down on the Mons Mouton plateau.'),
    dict(id='im1-odysseus', name='IM-1 Odysseus (Malapert A)', group='CLPS', lat=-80.13, lon=1.44, precision='published',
         src='Intuitive Machines / LROC, landed 2024-02-22', note='First CLPS landing; near Malapert A crater.'),
    dict(id='shackleton-floor', name='Shackleton crater floor', group='Reference', lat=-89.67, lon=129.78, precision='feature',
         src='IAU feature center', note='Permanently shadowed region: the Sun never clears the rim. Earth is never visible either.'),
    dict(id='lcross', name='LCROSS impact (Cabeus)', group='Reference', lat=-84.675, lon=-48.725, precision='published',
         src='LCROSS impact point, 2009', note='Permanently shadowed crater floor where water ice was detected.'),
    # Mid-latitude sites: outside DEM coverage -> smooth horizon
    dict(id='blue-ghost-m1', name='Blue Ghost M1 (Mare Crisium)', group='CLPS', lat=18.56, lon=61.81, precision='published',
         src='Firefly Aerospace, landed 2025-03-02', note='Near side, low latitude: classic 14-day lunar day/night cycle, Earth always up.'),
    dict(id='apollo-11', name='Apollo 11 (Tranquility Base)', group='Reference', lat=0.67408, lon=23.47297, precision='published',
         src='NASA', note='Equatorial near side reference: Sun rises high, Earth hangs near zenith.'),
    dict(id='schrodinger', name='Schrödinger basin (far side)', group='CLPS', lat=-75.0, lon=132.4, precision='feature',
         src='IAU feature center; Blue Ghost M2 target region', note='Far side: Earth is never visible, so a relay satellite is required.'),
]


def main():
    meta = json.load(open(OUT + 'meta.json')) if os.path.exists(OUT + 'meta.json') else {}
    prev = {s['id']: s for s in json.load(open(OUT + 'sites.json'))['sites']} if os.path.exists(OUT + 'sites.json') else {}
    # ------------------------------------------------ basemaps
    def hillshade(half_m, px, fine):
        xs = np.linspace(-half_m, half_m, px)
        X, Y = np.meshgrid(xs, -xs)  # row 0 = +y (top)
        H = height(X, Y, fine)
        H = np.nan_to_num(H, nan=np.nanmean(H))
        cell = 2 * half_m / px
        gy, gx = np.gradient(H, cell)
        # light from upper left, sun elev 30°
        az, alt = np.radians(315), np.radians(30)
        slope = np.arctan(np.hypot(gx, gy))
        aspect = np.arctan2(-gx, gy)
        hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
        hs = np.clip(hs, 0, 1)
        # blend with elevation tint for readability
        hn = (H - np.percentile(H, 1)) / (np.percentile(H, 99) - np.percentile(H, 1))
        g = np.clip(0.78 * hs + 0.22 * np.clip(hn, 0, 1), 0, 1)
        return (g * 255).astype(np.uint8), H

    if not os.path.exists(OUT + 'basemap.jpg'):
      img, _ = hillshade(310e3, 1400, False)
      Image.fromarray(img).save(OUT + 'basemap.jpg', quality=78, optimize=True, progressive=True)
      imgz, _ = hillshade(80e3, 1400, True)
      Image.fromarray(imgz).save(OUT + 'basemap_zoom.jpg', quality=78, optimize=True, progressive=True)
    meta['basemap'] = dict(half_m=310e3, px=1400)
    meta['basemap_zoom'] = dict(half_m=80e3, px=1400)
    print('basemaps done')

    # ------------------------------------------------ browser DEMs
    def resample(half_m, cell):
        n = int(round(2 * half_m / cell))
        xs = (np.arange(n) + 0.5) * cell - half_m
        X, Y = np.meshgrid(xs, -xs)
        H = height(X, Y, True)
        H = np.nan_to_num(H, nan=-32768)
        return np.round(H).astype('<i2'), n

    nn, nf = int(round(2 * 303e3 / 400.0)), int(round(2 * 455e3 / 1600.0))
    if not os.path.exists(OUT + 'dem_far.bin.gz') or not os.path.exists(ROOT + '/raw/dem_near.bin.gz'):
        near, nn = resample(303e3, 400.0)
        far, nf = resample(455e3, 1600.0)
        with gzip.open(ROOT + '/raw/dem_near.bin.gz', 'wb', 9) as f: f.write(near.tobytes())  # tiled by build_dem_tiles.py
        with gzip.open(OUT + 'dem_far.bin.gz', 'wb', 9) as f: f.write(far.tobytes())
    meta['dem_near'] = dict(half_m=303e3, cell=400.0, n=nn)
    meta['dem_far'] = dict(half_m=455e3, cell=1600.0, n=nf)
    print('dems done', nn, nf)

    # ------------------------------------------------ overlay maps
    grid = None
    if not SKIP_MAP and not os.path.exists(ROOT + '/raw/overlay_years.bin'):
        grid = overlay(meta)   # single-year maps; the multi-year build (tools/build_years.py) supersedes them

    # ------------------------------------------------ sites
    out = []
    for s in SITES:
        s = dict(s)
        if s['precision'] == 'region' and s['id'] in prev:
            # keep the representative point chosen on the first build so results stay comparable
            p0 = prev[s['id']]
            s['lat'], s['lon'], s['approx_lat'], s['approx_lon'] = p0['lat'], p0['lon'], p0.get('approx_lat', s['lat']), p0.get('approx_lon', s['lon'])
        elif s['precision'] == 'region' and grid is not None:
            s['lat'], s['lon'], s['approx_lat'], s['approx_lon'] = (*pick_best(grid, s), s['lat'], s['lon'])
        on_dem = s['lat'] <= -79.0
        if on_dem:
            wins = load_windows(s['id'])
            k = np.arange(720)
            for mast, key in ((2.0, 'horizon'), (10.0, 'horizon10')):
                hz, h0 = horizon(s['lat'], s['lon'], mast=mast, wins=wins)
                hz720 = np.maximum.reduce([hz[(2 * k - 1) % 1440], hz[2 * k], hz[(2 * k + 1) % 1440]])
                s[key] = base64.b64encode(np.round(hz720 * 100).astype('<i2').tobytes()).decode()
            s['elev_m'] = round(h0, 1)
            s['terrain'] = 'LOLA ' + ' + '.join([w['res'].replace('m', ' m') for w in wins] + ['80 m', '240 m'])
        else:
            s['elev_m'] = None
            s['horizon'] = None
            s['horizon10'] = None
            s['terrain'] = 'smooth sphere (outside polar DEM)'
        s.pop('search_km', None)
        s['lat'] = round(float(s['lat']), 5); s['lon'] = round(float(((s['lon'] + 180) % 360) - 180), 5)
        out.append(s)
        print(s['id'], s['lat'], s['lon'], s.get('elev_m'))
    json.dump(dict(generated=dt.date.today().isoformat(), horizon_step_deg=0.5, mast_m=[2.0, 10.0], sites=out),
              open(OUT + 'sites.json', 'w'), separators=(',', ':'))
    json.dump(meta, open(OUT + 'meta.json', 'w'), indent=1)


def pick_best(grid, s):
    lat0, lon0 = np.radians(s['lat']), np.radians(s['lon'])
    x0, y0 = ll_to_xy(lat0, lon0)
    X, Y, both, sunp = grid
    dist = np.hypot(X - x0, Y - y0)
    m = dist <= s['search_km'] * 1000
    score = np.where(m, sunp + 0.5 * both, -1)
    i = np.unravel_index(np.argmax(score), score.shape)
    la, lo = xy_to_ll(X[i], Y[i])
    return float(np.degrees(la)), float(np.degrees(lo))


def overlay(meta):
    """Loads the screening maps computed by tools/overlay.mjs (parallel Node job) and writes overlay.png."""
    if not os.path.exists(ROOT + '/raw/overlay_rgb.bin'):
        print('raw/overlay_rgb.bin missing: run `node tools/overlay.mjs` first; skipping overlay')
        return None
    o = json.load(open(ROOT + '/raw/overlay.json'))
    n, half, cell = o['n'], o['half_m'], o['cell']
    rgb = np.fromfile(ROOT + '/raw/overlay_rgb.bin', dtype=np.uint8).reshape(n, n, 3)
    Image.fromarray(rgb).save(OUT + 'overlay.png', optimize=True)
    meta['overlay'] = dict(half_m=half, cell=cell, n=n, year=o['year'], step_h=o['step_h'],
                           desc='R = %% Sun center visible, G = %% Earth center visible, B = %% both; 2 m height; %d-azimuth horizon from 240 m LOLA' % o['rays'])
    xs = (np.arange(n) + 0.5) * cell - half
    X, Y = np.meshgrid(xs, -xs)
    return (X, Y, rgb[..., 2] / 255.0, rgb[..., 0] / 255.0)


if __name__ == '__main__':
    main()
