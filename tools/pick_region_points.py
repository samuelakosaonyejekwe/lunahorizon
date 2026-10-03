"""Recomputes the representative point of every Artemis III candidate region without a published point (tools/sites.py,
precision 'region'): the 1 km map cell with the highest 2027 sunlight % + Sun-and-Earth % (app/data/years/overlay_2027.png)
within search_km of the approximate region centre. Prints each result and exits with an error if it differs from the
point stored in sites.py, so the stored points stay reproducible.
Usage: python3 tools/pick_region_points.py            check
       python3 tools/pick_region_points.py --update   write any changed point into sites.py (after a data rebuild from
                                                      new NASA files; then rerun tools/build_data.py)"""
import json, os, re, sys
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from sites import SITES, MOON_R_M as R  # noqa: E402
DATA = os.path.join(HERE, '..', 'app', 'data')
ov = json.load(open(os.path.join(DATA, 'meta.json')))['overlay']
half, cell, n = ov['half_m'], ov['cell'], ov['n']
m = np.array(Image.open(os.path.join(DATA, 'years', 'overlay_2027.png'))).astype(float)
score = m[..., 0] + m[..., 2]                       # sunlight + Sun-and-Earth (both 0-255)
xs = (np.arange(n) + 0.5) * cell - half
X, Y = np.meshgrid(xs, -xs)                          # row 0 = +y, as in the map


def to_xy(lat, lon):
    la, lo = np.radians(lat), np.radians(lon)
    rho = 2 * R * np.tan(np.pi / 4 + la / 2)
    return rho * np.sin(lo), rho * np.cos(lo)


def to_ll(x, y):
    return np.degrees(2 * np.arctan(np.hypot(x, y) / (2 * R)) - np.pi / 2), np.degrees(np.arctan2(x, y))


bad, updates = 0, {}
for s in SITES:
    if s.get('precision') != 'region':
        continue
    cx, cy = to_xy(s['approx_lat'], s['approx_lon'])
    r, c = np.unravel_index(np.where(np.hypot(X - cx, Y - cy) <= s['search_km'] * 1000, score, -1).argmax(), score.shape)
    lat, lon = to_ll(X[r, c], Y[r, c])
    px, py = to_xy(s['lat'], s['lon'])
    same = (int((half - py) // cell), int((px + half) // cell)) == (r, c)
    bad += not same
    if not same: updates[s['id']] = (round(float(lat), 5), round(float(lon), 5))
    print(f"{s['id']:22} best cell {lat:.5f}, {lon:.5f}  sun {m[r, c, 0] / 2.55:.0f}%  Sun+Earth {m[r, c, 2] / 2.55:.0f}%  "
          f"{'matches sites.py' if same else 'DIFFERS from sites.py ' + str((s['lat'], s['lon']))}")
if '--update' in sys.argv and updates:
    path = os.path.join(HERE, 'sites.py'); src = open(path).read()
    for sid, (lat, lon) in updates.items():
        src, n = re.subn(rf"(dict\(id='{sid}',[^\n]*?lat=)-?[\d.]+(, lon=)-?[\d.]+", rf"\g<1>{lat}\g<2>{lon}", src)
        assert n == 1, sid
    open(path, 'w').write(src)
    print('updated in sites.py:', ', '.join(updates))
    sys.exit(0)
sys.exit(1 if bad else 0)
