"""
Builds the independent accuracy reference for the app's ephemeris: Sun and Earth azimuth/elevation seen from
lunar surface sites, computed with JPL DE421 and the MOON_ME_DE421 body frame (Skyfield + NAIF kernels).
tools/test.mjs compares app/js/astro.js against this file.

Usage: python3 tools/validate.py <kernel-dir>
  <kernel-dir> must contain de421.bsp, moon_080317.tf and moon_pa_de421_1900-2050.bpc
  (https://ssd.jpl.nasa.gov/ftp/eph/planets/bsp/ and https://naif.jpl.nasa.gov/pub/naif/generic_kernels/).
Output: tools/fixtures/de421_reference.json (60 random instants in 2024-2036 at 4 sites = 240 cases).
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
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'de421_reference.json')
R_KM = MOON_R_M / 1000
SITES = [(-89.53432, 209.94767), (-84.7906, 29.1957), (-85.4, 36.0), (18.56, 61.81)]

ts = load.timescale()
eph = load(os.path.join(K, 'de421.bsp'))
pc = PlanetaryConstants()
pc.read_text(load(os.path.join(K, 'moon_080317.tf')))
pc.read_binary(load(os.path.join(K, 'moon_pa_de421_1900-2050.bpc')))
frame = pc.build_frame_named('MOON_ME_DE421')
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
