"""
Builds the static data products the web app ships, from NASA LOLA polar DEMs.

Inputs (raw/, downloaded as described in README "Rebuild the data"):
  ldem_80s_80m.img     PDS LOLA GDR, 80 m/px, 80°S cap
  ldem_75s_240m.img    PDS LOLA GDR, 240 m/px, 75°S cap
  win/<site>_<res>.npz 5 m and 20 m windows around each polar site (tools/fetch_windows.py)
Site list: tools/sites.py.

Outputs (app/data/ unless noted):
  sites.json           curated sites with 0.5° terrain horizons for a sensor 2 m above the ground
  horizons10.json      the same horizons for a 10 m mast (loaded by the app only when that height is selected)
  basemap.jpg          hillshade of the ±310 km polar region for the site map
  basemap_zoom.jpg     hillshade of the inner ±80 km
  dem_far.bin.gz       int16 heights (m), 75°S cap resampled to 1600 m (browser horizon engine, far field)
  raw/dem_near.bin.gz  int16 heights (m), 80°S cap resampled to 400 m; tools/build_dem_tiles.py tiles it for the browser
  meta.json            grid geometry for all of the above
The yearly sunlight / Earth-visibility maps come from tools/overlay_years.mjs + tools/build_years.py,
and the 3D tiles from tools/build_3d.py.
"""
import json, sys, os, gzip, base64
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sites import SITES, DEM_LIMIT_LAT, MOON_R_M as R_M  # noqa: E402  (tools/sites.py)
import numpy as np
from PIL import Image

ROOT = __file__.rsplit('/tools/', 1)[0]
RAW = ROOT + '/raw/'
OUT = ROOT + '/app/data/'

# ---------------------------------------------------------------- DEMs
d80 = np.fromfile(RAW + 'ldem_80s_80m.img', dtype='<i2').reshape(7600, 7600).astype(np.float32) * 0.5
d240 = np.fromfile(RAW + 'ldem_75s_240m.img', dtype='<i2').reshape(3812, 3812).astype(np.float32) * 0.5
G80 = dict(arr=d80, scale=80.0, off=3799.5, n=7600)
G240 = dict(arr=d240, scale=240.0, off=1905.5, n=3812)


def ll_to_xy(lat, lon):
    """South polar stereographic (PDS convention), meters. lat/lon radians."""
    rho = 2 * R_M * np.tan(np.pi / 4 + lat / 2)
    return rho * np.sin(lon), rho * np.cos(lon)


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
    return np.maximum(hz, -15.0), h0   # floor only where a ray finds no terrain at all




def main():
    meta = json.load(open(OUT + 'meta.json')) if os.path.exists(OUT + 'meta.json') else {}
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
        for path, arr in ((ROOT + '/raw/dem_near.bin.gz', near), (OUT + 'dem_far.bin.gz', far)):   # near grid is tiled by build_dem_tiles.py
            with open(path, 'wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', compresslevel=9, mtime=0) as f: f.write(arr.tobytes())  # mtime=0: reproducible bytes
    meta['dem_near'] = dict(half_m=303e3, cell=400.0, n=nn)
    meta['dem_far'] = dict(half_m=455e3, cell=1600.0, n=nf, bytes=os.path.getsize(OUT + 'dem_far.bin.gz'))   # compressed size, for download progress
    print('dems done', nn, nf)

    # ------------------------------------------------ sites
    out, tall = [], {}
    k = np.arange(720)
    for s in SITES:
        s = {k: v for k, v in s.items() if k not in ('approx_lat', 'approx_lon', 'search_km')}   # selection inputs (tools/pick_region_points.py), not app data
        if s['lat'] <= DEM_LIMIT_LAT:
            wins = load_windows(s['id'])
            for mast in (2.0, 10.0):
                hz, h0 = horizon(s['lat'], s['lon'], mast=mast, wins=wins)
                hz720 = np.maximum.reduce([hz[(2 * k - 1) % 1440], hz[2 * k], hz[(2 * k + 1) % 1440]])
                enc = base64.b64encode(np.round(hz720 * 100).astype('<i2').tobytes()).decode()
                if mast == 2.0: s['horizon'] = enc
                else: tall[s['id']] = enc
            s['elev_m'] = round(h0, 1)
            s['terrain'] = 'LOLA ' + ' + '.join([w['res'].replace('m', ' m') for w in wins] + ['80 m', '240 m'])
        else:
            s['elev_m'] = None
            s['horizon'] = None
            s['terrain'] = 'smooth sphere (outside polar DEM)'
        s['lat'] = round(float(s['lat']), 5); s['lon'] = round(float(((s['lon'] + 180) % 360) - 180), 5)
        out.append(s)
        print(s['id'], s['lat'], s['lon'], s.get('elev_m'))
    json.dump(dict(horizon_step_deg=0.5, mast_m=2.0, sites=out), open(OUT + 'sites.json', 'w'), separators=(',', ':'))
    json.dump(dict(horizon_step_deg=0.5, mast_m=10.0, horizons=tall), open(OUT + 'horizons10.json', 'w'), separators=(',', ':'))
    json.dump(meta, open(OUT + 'meta.json', 'w'), indent=1)


if __name__ == '__main__':
    main()
