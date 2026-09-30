"""3D view terrain tiles (int16 metres, gzip): a fine render tile and a wide coarse tile for long shadows.
  dem3d_fine.bin.gz   512 x 512, ±80 km around the pole  (312.5 m/px)   from LOLA 80 m
  dem3d_coarse.bin.gz 500 x 500, ±200 km                 (800 m/px)     from LOLA 240 m
"""
import gzip, json, sys
import numpy as np
sys.argv = [sys.argv[0], '--skip-map']
import importlib.util
spec = importlib.util.spec_from_file_location('bd', __file__.rsplit('/', 1)[0] + '/build_data.py')
bd = importlib.util.module_from_spec(spec); spec.loader.exec_module(bd)

def tile(half, n, fine):
    cell = 2 * half / n
    xs = (np.arange(n) + 0.5) * cell - half
    X, Y = np.meshgrid(xs, -xs)
    # area-average a 3x3 subsample so the tile is not aliased
    acc = np.zeros_like(X); k = 0
    for dx in (-cell / 3, 0, cell / 3):
        for dy in (-cell / 3, 0, cell / 3):
            acc += np.nan_to_num(bd.height(X + dx, Y + dy, fine), nan=0.0); k += 1
    return np.round(acc / k).astype('<i2'), cell

meta = json.load(open(bd.OUT + 'meta.json'))
for name, half, n, fine in (('dem3d_fine', 80e3, 512, True), ('dem3d_coarse', 200e3, 500, False)):
    arr, cell = tile(half, n, fine)
    with gzip.open(bd.OUT + name + '.bin.gz', 'wb', 9) as f: f.write(arr.tobytes())
    meta[name] = dict(half_m=half, n=n, cell=cell)
    print(name, arr.shape, arr.min(), arr.max())
json.dump(meta, open(bd.OUT + 'meta.json', 'w'), indent=1)
