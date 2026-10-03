"""Lists every file the app needs to work fully offline (app code + all data) with its size, for the
"Save everything for offline" option, and keeps the service worker's cache names in step with the files:
  - app/data/offline.json  the file list, total size, and a content hash of the code and of the data
  - app/sw.js              VERSION (app shell cache) and DATA (terrain/map cache) names come from the content: they
                           change exactly when the code or the data changes (to a name built from its hash), so two
                           different versions can never share a name, even when GitHub rebuilds the live data on its own;
                           an app update never discards downloaded terrain unless the data itself changed
It also checks that the service worker precaches every code file (its SHELL list).
Usage: python3 tools/build_offline_manifest.py           rewrite after changing anything in app/
       python3 tools/build_offline_manifest.py --check   exit 1 if anything is out of date (run by tools/test.mjs)"""
import hashlib, json, os, re, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app')
SKIP = {'data/offline.json', 'sw.js', 'vendor/fflate.LICENSE', '.nojekyll'}
is_data = lambda p: p.startswith('data/') and not p.endswith('.json')   # the same rule as sw.js: cache-first data files

files = []
for d, _, fs in os.walk(ROOT):
    for f in fs:
        p = os.path.relpath(os.path.join(d, f), ROOT).replace(os.sep, '/')
        if p not in SKIP:
            files.append([p, os.path.getsize(os.path.join(ROOT, p))])
files.sort()


def digest(paths):
    h = hashlib.sha256()
    for p in paths:
        h.update(p.encode() + b'\0' + open(os.path.join(ROOT, p), 'rb').read())
    return h.hexdigest()[:16]


code_hash, data_hash = digest([p for p, _ in files if not is_data(p)]), digest([p for p, _ in files if is_data(p)])
man_path, sw_path = os.path.join(ROOT, 'data', 'offline.json'), os.path.join(ROOT, 'sw.js')
old = json.load(open(man_path)) if os.path.exists(man_path) else {}
sw = open(sw_path).read()
version, data_cache = re.search(r"const VERSION = '(lh-[^']+)'", sw), re.search(r"const DATA = '(lh-data-[^']+)'", sw)
shell = set(re.findall(r"'([^']+)'", re.search(r'const SHELL = \[([^\]]+)\]', sw).group(1)))
shell |= set(re.findall(r"'([^']+)'", re.search(r'const FALLBACK = [^\[]*\[([^\]]*)\]', sw).group(1)))   # precached only where needed
problems = [f'sw.js SHELL is missing {p}' for p, _ in files if not is_data(p) and p.endswith(('.js', '.css', '.html', '.webmanifest')) and p not in shell]
problems += [f'sw.js SHELL lists a missing file: {p}' for p in shell - {'./'} if not os.path.exists(os.path.join(ROOT, p))]

# unchanged content keeps its current name (nothing to download again); changed content gets a name from its hash
new_version = version.group(1) if old.get('code') in (None, code_hash) else f'lh-{code_hash[:12]}'
new_data = data_cache.group(1) if old.get('data') in (None, data_hash) else f'lh-data-{data_hash[:12]}'
out = {'files': files, 'bytes': sum(s for _, s in files), 'code': code_hash, 'data': data_hash, 'version': new_version, 'dataCache': new_data}

if '--check' in sys.argv:
    if old != out:
        problems.append('app/data/offline.json or the cache names in app/sw.js are out of date: run python3 tools/build_offline_manifest.py')
    for p in problems: print('FAIL', p)
    sys.exit(1 if problems else 0)

for p in problems: print('WARNING', p)
tmp = man_path + '.tmp'
with open(tmp, 'w') as fh: json.dump(out, fh, separators=(',', ':'))
os.replace(tmp, man_path)
sw2 = sw.replace(version.group(0), f"const VERSION = '{new_version}'").replace(data_cache.group(0), f"const DATA = '{new_data}'")
if sw2 != sw: open(sw_path, 'w').write(sw2)
print(len(files), 'files,', round(out['bytes'] / 1e6, 1), 'MB · cache names', new_version, new_data)
