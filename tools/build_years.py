"""Turns raw/overlay_years.bin (from tools/overlay_years.mjs) into web map layers:
  app/data/years/overlay_<year>.png  one per year (R sun %, G Earth %, B both %)
  app/data/overlay.png               the cycle mean (replaces the single-year map)
  app/data/overlay_range.png         year-to-year variability: R = max-min sunlit %, G = max-min Earth %, B = best-year sunlit %
"""
import json, os
import numpy as np
from PIL import Image
ROOT = __file__.rsplit('/tools/', 1)[0]
OUT = ROOT + '/app/data/'
m = json.load(open(ROOT + '/raw/overlay_years.json'))
n, Y = m['n'], m['years']
a = np.fromfile(ROOT + '/raw/overlay_years.bin', dtype=np.uint8).reshape(Y, n, n, 3).astype(np.float32)
os.makedirs(OUT + 'years', exist_ok=True)
for k in range(Y):
    Image.fromarray(a[k].astype(np.uint8)).save(OUT + f"years/overlay_{m['year0'] + k}.png", optimize=True)
mean = np.round(a.mean(0)).astype(np.uint8)
Image.fromarray(mean).save(OUT + 'overlay.png', optimize=True)
rng = np.stack([a[..., 0].max(0) - a[..., 0].min(0), a[..., 1].max(0) - a[..., 1].min(0), a[..., 0].max(0)], -1)
Image.fromarray(np.round(rng).astype(np.uint8)).save(OUT + 'overlay_range.png', optimize=True)
meta = json.load(open(OUT + 'meta.json'))
meta['overlay'] = dict(half_m=m['half_m'], cell=m['cell'], n=n, year=f"{m['year0']}-{m['year0'] + Y - 1} mean", step_h=m['step_h'],
                       desc=f'R = % Sun center visible, G = % Earth center visible, B = % both; 2 m height; mean of {Y} years')
meta['overlay_years'] = dict(year0=m['year0'], years=Y, step_h=m['step_h'])
json.dump(meta, open(OUT + 'meta.json', 'w'), indent=1, sort_keys=True)   # sorted: the same bytes whatever order the steps ran in
land = a[0, ..., 0] > 0
per_year_sun = a[..., 0][:, land].mean(1) / 2.55
print('mean sunlit % over the map, by year:', ' '.join(f'{m["year0"] + k}:{v:.1f}' for k, v in enumerate(per_year_sun)))
print('median year-to-year range of sunlit % (points):', np.median(rng[..., 0][land]) / 2.55, ' 95th pct:', np.percentile(rng[..., 0][land], 95) / 2.55)
