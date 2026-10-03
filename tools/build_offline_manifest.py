"""Lists every file the app needs to work fully offline (app code + all data) with its size, for the
"Save everything for offline" option. Writes app/data/offline.json. Re-run after changing anything in app/ or app/data/;
tools/test.mjs fails if the list is out of date.
Usage: python3 tools/build_offline_manifest.py"""
import json, os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app')
SKIP = {'data/offline.json', 'sw.js', 'vendor/fflate.LICENSE', '.nojekyll'}
files = []
for d, _, fs in os.walk(ROOT):
    for f in fs:
        p = os.path.relpath(os.path.join(d, f), ROOT).replace(os.sep, '/')
        if p in SKIP: continue
        files.append([p, os.path.getsize(os.path.join(ROOT, p))])
files.sort()
out = {'files': files, 'bytes': sum(s for _, s in files)}
tmp = os.path.join(ROOT, 'data', 'offline.json.tmp')
with open(tmp, 'w') as fh: json.dump(out, fh, separators=(',', ':'))
os.replace(tmp, os.path.join(ROOT, 'data', 'offline.json'))
print(len(files), 'files,', round(out['bytes'] / 1e6, 1), 'MB')
