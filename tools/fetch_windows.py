"""
Fetches high-resolution LOLA elevation windows around each polar site with HTTP range requests,
so the multi-gigabyte source grids never have to be downloaded whole.

  20 m/px window, ±15 km, from LDEM_80S_20M (all sites south of 80°S)
   5 m/px window,  ±4 km, from LDEM_875S_5M (sites south of 87.5°S)

Output: raw/win/<site>_<res>.npz with the int16 window and its pixel origin in the source grid.
Usage: python3 tools/fetch_windows.py   (resumable: windows already on disk are skipped)
"""
import os, math, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np

ROOT = __file__.rsplit('/tools/', 1)[0]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sites import SITES, MOON_R_M as R_M  # noqa: E402  (tools/sites.py)
BASE = 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/'
GRIDS = {
    '20m': dict(file='ldem_80s_20m.img', n=30400, off=15199.5, scale=20.0, half_km=15.0, maxlat=-80.0),
    '5m': dict(file='ldem_875s_5m.img', n=30336, off=15167.5, scale=5.0, half_km=4.0, maxlat=-87.5),
}
OUT = ROOT + '/raw/win/'
os.makedirs(OUT, exist_ok=True)


def ll_to_px(lat, lon, g):
    la, lo = math.radians(lat), math.radians(lon)
    rho = 2 * R_M * math.tan(math.pi / 4 + la / 2)
    x, y = rho * math.sin(lo), rho * math.cos(lo)
    return g['off'] - y / g['scale'], g['off'] + x / g['scale']  # line, sample


def fetch_row(url, line, s0, ns, n):
    start = (line * n + s0) * 2
    req = urllib.request.Request(url, headers={'Range': f'bytes={start}-{start + ns * 2 - 1}', 'User-Agent': 'lunahorizon-data'})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            if len(data) == ns * 2:
                return np.frombuffer(data, '<i2')
        except Exception:
            pass
    raise RuntimeError(f'row {line} failed')


def main():
    for s in SITES:
        for res, g in GRIDS.items():
            if s['lat'] > g['maxlat']:
                continue
            path = f"{OUT}{s['id']}_{res}.npz"
            if os.path.exists(path):
                continue
            l, smp = ll_to_px(s['lat'], s['lon'], g)
            half = int(g['half_km'] * 1000 / g['scale'])
            l0, s0 = max(0, int(l) - half), max(0, int(smp) - half)
            l1, s1 = min(g['n'], int(l) + half + 1), min(g['n'], int(smp) + half + 1)
            url = BASE + g['file']
            with ThreadPoolExecutor(32) as ex:
                rows = list(ex.map(lambda li: fetch_row(url, li, s0, s1 - s0, g['n']), range(l0, l1)))
            arr = np.stack(rows)
            tmp = path + '.part.npz'                 # write then rename, so an interrupted run never leaves a half file
            np.savez_compressed(tmp, dem=arr, l0=l0, s0=s0, n=g['n'], off=g['off'], scale=g['scale'])
            os.replace(tmp, path)
            print(s['id'], res, arr.shape, 'height range', arr.min() * 0.5, arr.max() * 0.5, flush=True)


if __name__ == '__main__':
    main()
