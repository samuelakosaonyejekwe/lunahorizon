"""Splits the browser's 400 m terrain grid (dem_near) into 128 x 128 tiles so a custom-site tap downloads only the
tiles near the tapped spot. Output: app/data/dem_tiles/t_<row>_<col>.bin.gz (int16 metres, -32768 = no data)."""
import gzip, json, os
import numpy as np
ROOT = __file__.rsplit('/tools/', 1)[0]
OUT = ROOT + '/app/data/'
meta = json.load(open(OUT + 'meta.json'))
m = meta['dem_near']; n = m['n']; T = 128
a = np.frombuffer(gzip.open(ROOT + '/raw/dem_near.bin.gz').read(), dtype='<i2').reshape(n, n)
os.makedirs(OUT + 'dem_tiles', exist_ok=True)
rows = (n + T - 1) // T; total = 0; sizes = []
for r in range(rows):
    for c in range(rows):
        t = np.full((T, T), -32768, dtype='<i2')
        blk = a[r * T:(r + 1) * T, c * T:(c + 1) * T]
        t[:blk.shape[0], :blk.shape[1]] = blk
        with open(OUT + f'dem_tiles/t_{r}_{c}.bin.gz', 'wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', compresslevel=9, mtime=0) as f: f.write(t.tobytes())
        sizes.append(os.path.getsize(OUT + f'dem_tiles/t_{r}_{c}.bin.gz')); total += sizes[-1]
meta['dem_near_tiles'] = dict(tile=T, rows=rows, n=n, half_m=m['half_m'], cell=m['cell'], bytes=sizes)  # compressed sizes, for download progress
json.dump(meta, open(OUT + 'meta.json', 'w'), indent=1, sort_keys=True)   # sorted: the same bytes whatever order the steps ran in
print(rows * rows, 'tiles,', round(total / 1e6, 2), 'MB total')
