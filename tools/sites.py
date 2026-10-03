"""Curated site list shared by the data pipeline (build_data.py, fetch_windows.py).

Coordinates are planetocentric degrees, east-positive. Sites at or south of DEM_LIMIT_LAT get LOLA terrain
horizons; the rest use a smooth-sphere horizon. The web app uses the same limit (app/js/ui.js DEM_LIMIT_LAT).
"""

DEM_LIMIT_LAT = -79.5
MOON_R_M = 1737400.0   # LOLA reference sphere (PDS label OFFSET); app/js/astro.js MOON_R_KM is the same value

# precision: 'published' = coordinates from a published source; 'feature' = named-feature coordinates;
# 'region' = representative point inside an Artemis III candidate region that has no published point: the 1 km cell
# with the highest 2027 sunlight % + Sun-and-Earth % (app/data/years/overlay_2027.png) within search_km of the
# approximate region centre (approx_lat/approx_lon). tools/pick_region_points.py recomputes every one of them and
# fails if a point here no longer matches; the points are fixed here so every rebuild uses the same ones.
SITES = [
    dict(id='connecting-ridge', name='Connecting Ridge', group='Artemis', lat=-89.53432, lon=209.94767, precision='published',
         src='Gracy & Lee, LPSC 2024 #1695', note='Ridge linking Shackleton and de Gerlache; among the best-lit terrain on the Moon.'),
    dict(id='peak-near-shackleton', name='Peak near Shackleton', group='Artemis', lat=-89.01701, lon=126.27302, precision='published',
         src='Gracy & Lee, LPSC 2024 #1695', note='Massif near Shackleton overlooking ice-bearing permanently shadowed regions.'),
    dict(id='nobile-rim-2', name='Nobile Rim 2', group='Artemis', lat=-84.20156, lon=60.69989, precision='published',
         src='Evaluating potential landing sites for Artemis III (Acta Astronautica 2024), best point in DM2',
         note='One of the 9 Artemis III candidate regions (Oct 2024).'),
    dict(id='mons-mouton', name='Mons Mouton', group='Artemis', lat=-84.40534, lon=31.02163, approx_lat=-84.6, approx_lon=31.0, search_km=6, precision='region',
         src='IAU feature center 84.6°S 31.0°E', note='Broad flat-topped mountain; one of the 9 Artemis III candidate regions.'),
    dict(id='mons-mouton-plateau', name='Mons Mouton Plateau', group='Artemis', lat=-84.3, lon=30.6, precision='published',
         src='LROC NAC Artemis III region mosaic NAC_ROI_MOUTNPLTLOA, centre 84.3°S 30.6°E',
         note='Plateau on the north side of Mons Mouton; one of the 9 Artemis III candidate regions (Oct 2024).'),
    dict(id='malapert-massif', name='Malapert Massif', group='Artemis', lat=-85.99207, lon=2.1211, approx_lat=-86.0, approx_lon=0.0, search_km=6, precision='region',
         src='Approximate region center', note='Tall massif with good Earth visibility; Artemis III candidate region.'),
    dict(id='nobile-rim-1', name='Nobile Rim 1', group='Artemis', lat=-85.21763, lon=36.59349, approx_lat=-85.45, approx_lon=38.0, search_km=8, precision='region',
         src='Approximate region center (west rim of Nobile)', note='Artemis III candidate region on the rim of Nobile crater.'),
    dict(id='de-gerlache-rim-2', name='de Gerlache Rim 2', group='Artemis', lat=-88.70486, lon=-68.33404, approx_lat=-88.75, approx_lon=-68.0, search_km=6, precision='region',
         src='Approximate region center', note='Artemis III candidate region on the rim of de Gerlache crater.'),
    dict(id='haworth', name='Haworth', group='Artemis', lat=-86.93494, lon=-23.11766, approx_lat=-86.9, approx_lon=-20.0, search_km=6, precision='region',
         src='Approximate region center', note='Artemis III candidate region near Haworth crater.'),
    dict(id='slater-plain', name='Slater Plain', group='Artemis', lat=-87.84871, lon=-130.64892, approx_lat=-87.9, approx_lon=-125.0, search_km=8, precision='region',
         src='Approximate region center', note='Artemis III candidate region; plains near Slater crater.'),
    dict(id='peak-near-cabeus-b', name='Peak near Cabeus B', group='Artemis', lat=-84.42709, lon=-58.04848, approx_lat=-84.3, approx_lon=-60.0, search_km=8, precision='region',
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
