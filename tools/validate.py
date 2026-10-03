"""
Builds the independent accuracy references for the app's ephemeris: Sun and Earth azimuth/elevation seen from
lunar surface sites, computed with JPL ephemerides and lunar body frames (Skyfield + NAIF kernels).
tools/test.mjs compares app/js/astro.js against every reference.

Usage: python3 tools/validate.py <kernel-dir> [de421|de440]   (default de421)
  de421: de421.bsp, moon_080317.tf, moon_pa_de421_1900-2050.bpc, frame MOON_ME_DE421 (the LOLA-era reference)
  de440: de440s.bsp, moon_de440_250416.tf, moon_pa_de440_200625.bpc, frame MOON_ME_DE440_ME421 (JPL's current ephemeris)
  Kernels: https://naif.jpl.nasa.gov/pub/naif/generic_kernels/ (spk/planets, fk/satellites, pck)
Output: tools/fixtures/<set>_reference.json (the same 60 random instants in 2024-2036 at 4 sites = 240 cases).
"""
import datetime as dt
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sites import MOON_R_M  # noqa: E402  (tools/sites.py)
from skyfield.api import load
from skyfield.planetarylib import PlanetaryConstants

K = sys.argv[1]
SET = sys.argv[2] if len(sys.argv) > 2 else 'de421'
KERNELS = {
    'de421': ('de421.bsp', 'moon_080317.tf', 'moon_pa_de421_1900-2050.bpc', 'MOON_ME_DE421'),
    'de440': ('de440s.bsp', 'moon_de440_250416.tf', 'moon_pa_de440_200625.bpc', 'MOON_ME_DE440_ME421'),
}
BSP, TF, BPC, FRAME = KERNELS[SET]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', f'{SET}_reference.json')
R_KM = MOON_R_M / 1000
SITES = [(-89.53432, 209.94767), (-84.7906, 29.1957), (-85.4, 36.0), (18.56, 61.81)]

ts = load.timescale()
eph = load(os.path.join(K, BSP))
pc = PlanetaryConstants()
pc.read_text(load(os.path.join(K, TF)))
pc.read_binary(load(os.path.join(K, BPC)))
# Skyfield keeps the last segment per body; the DE440 orientation file has two (1550-2426, 2426-2650), so pick the one
# that covers the test instants (Skyfield's segment map is internal, hence the explicit choice)
for seg in pc._binary_files[-1].segments:
    if seg.initial_jd <= 2460000 and seg.final_jd >= 2465000:
        pc._segment_map[seg.body] = seg
frame = pc.build_frame_named(FRAME)
moon, earth, sun = eph['moon'], eph['earth'], eph['sun']

rng = np.random.default_rng(1)
out = []
for _ in range(60):
    ms = int(1.70e12 + rng.random() * 4.2e11)
    t = ts.from_datetime(dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc))
    rot = frame.rotation_at(t)                       # ICRF -> Moon ME
    for lat, lon in SITES:
        la, lo = np.radians(lat), np.radians(lon)
        p = R_KM * np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])
        E = np.array([-np.sin(lo), np.cos(lo), 0.0])
        N = np.array([-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)])
        U = p / np.linalg.norm(p)
        rec = {'ms': ms, 'lat': lat, 'lon': lon}
        for name, body in (('sun', sun), ('earth', earth)):
            v = moon.at(t).observe(body).apparent().position.km   # from the Moon's centre: light time + aberration
            vb = rot @ v - p                                       # topocentric, body frame
            e, n, u = vb @ E, vb @ N, vb @ U
            rec[name] = [float(np.degrees(np.arctan2(e, n)) % 360), float(np.degrees(np.arcsin(u / np.linalg.norm(vb))))]
        out.append(rec)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(out, open(OUT, 'w'))
print(len(out), 'cases ->', OUT)
