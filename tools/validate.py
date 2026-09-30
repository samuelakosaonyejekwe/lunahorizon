# Reference Sun/Earth az/el from lunar surface sites with JPL DE421 + MOON_ME_DE421 frame (skyfield).
import json, sys, numpy as np
from skyfield.api import load
from skyfield.framelib import ecliptic_frame
K = sys.argv[1]
ts = load.timescale()
eph = load(K + '/de421.bsp')
pc = load.PlanetaryConstants() if False else None
from skyfield.planetarylib import PlanetaryConstants
pc = PlanetaryConstants()
pc.read_text(load(K + '/moon_080317.tf'))
pc.read_binary(load(K + '/moon_pa_de421_1900-2050.bpc'))
frame = pc.build_frame_named('MOON_ME_DE421')
moon, earth, sun = eph['moon'], eph['earth'], eph['sun']
sites = [(-89.53432, 209.94767, 0), (-84.7906, 29.1957, 0), (-85.4, 36.0, 0), (18.56, 61.81, 0)]
rng = np.random.default_rng(1)
out = []
R = 1737.4
for i in range(60):
    ms = int((1.70e12 + rng.random() * 4.2e11))
    t = ts.from_datetime(__import__('datetime').datetime.fromtimestamp(ms / 1000, __import__('datetime').timezone.utc))
    R_ = frame.rotation_at(t)  # ICRF -> ME
    for lat, lon, h in sites:
        la, lo = np.radians(lat), np.radians(lon)
        p = (R + h) * np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])
        E = np.array([-np.sin(lo), np.cos(lo), 0]); N = np.array([-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)]); U = p / np.linalg.norm(p)
        res = {'ms': ms, 'lat': lat, 'lon': lon}
        for name, body in (('sun', sun), ('earth', earth)):
            # apparent position from Moon center (light time + aberration)
            v = moon.at(t).observe(body).apparent().position.km
            vb = R_ @ v - p
            e, n, u = vb @ E, vb @ N, vb @ U
            res[name] = [float(np.degrees(np.arctan2(e, n)) % 360), float(np.degrees(np.arcsin(u / np.linalg.norm(vb))))]
        out.append(res)
json.dump(out, open(K + '/ref.json', 'w'))
print(len(out))
