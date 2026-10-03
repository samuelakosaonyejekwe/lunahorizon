"""The NASA source files the app's data is built from, and whether NASA has published newer versions of them.

  python3 tools/nasa_sources.py --check    ask NASA's servers (HTTP HEAD) for each file's size, date and version tag and
                                           compare with tools/nasa_sources.json, the versions the data in app/data/ was
                                           built from. Prints the result; in GitHub Actions also sets the step output
                                           changed=true|false. A server that cannot be reached never counts as a change.
  python3 tools/nasa_sources.py --check --live <site-url>
                                           compare with the versions the live app was built from (its data/meta.json)
                                           instead, so a scheduled check rebuilds once per NASA update, not every time
  python3 tools/nasa_sources.py --record   store the current versions in tools/nasa_sources.json and in app/data/meta.json
                                           (shown in the app), after the data has been rebuilt from them.

The deploy workflow (.github/workflows/pages.yml) runs --check every 6 hours on GitHub's servers and, when NASA has
changed a file, rebuilds all data from the new files and republishes the app."""
import json, os, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RECORD = os.path.join(HERE, 'nasa_sources.json')
META = os.path.join(HERE, '..', 'app', 'data', 'meta.json')
PDS = 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/'
SOURCES = {   # file -> what it feeds (the same URLs as tools/fetch_windows.py and README "Rebuild the data")
    'ldem_80s_80m.img': 'LOLA 80 m south polar DEM: site horizons, browser terrain, 3D view',
    'ldem_75s_240m.img': 'LOLA 240 m south polar DEM: site horizons, yearly maps, 3D view',
    'ldem_80s_20m.img': 'LOLA 20 m south polar DEM: high-resolution windows around sites',
    'ldem_875s_5m.img': 'LOLA 5 m south polar DEM: high-resolution windows near the pole',
}


def head(url):
    req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'lunahorizon-data'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return {'bytes': int(r.headers.get('Content-Length') or 0), 'last_modified': r.headers.get('Last-Modified'), 'etag': r.headers.get('ETag')}
        except Exception as e:  # noqa: BLE001  (network errors of every kind are retried, then reported)
            err = e
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f'{url}: {err}')


def current():
    return {name: {'url': PDS + name, 'used_for': use, **head(PDS + name)} for name, use in SOURCES.items()}


def output(changed):
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as fh:
            fh.write(f'changed={"true" if changed else "false"}\n')


if '--check' in sys.argv:
    live = sys.argv[sys.argv.index('--live') + 1] if '--live' in sys.argv else None
    try:
        if live:   # the live app publishes the file dates it was built from
            req = urllib.request.Request(live.rstrip('/') + '/data/meta.json', headers={'User-Agent': 'lunahorizon-data', 'Cache-Control': 'no-cache'})
            with urllib.request.urlopen(req, timeout=60) as r:
                old = {n: {'last_modified': d} for n, d in json.load(r).get('nasa_sources', {}).items()}
            keys = ('last_modified',)
        else:
            old = json.load(open(RECORD)) if os.path.exists(RECORD) else {}
            keys = ('bytes', 'last_modified', 'etag')
        now = current()
    except Exception as e:  # noqa: BLE001  (an unreachable server never triggers a rebuild)
        print('Server not reachable, treated as unchanged:', e)
        output(False)
        sys.exit(0)
    print('Compared with', f'the live app ({live})' if live else 'tools/nasa_sources.json')
    changed = []
    for name, v in now.items():
        o = old.get(name, {})
        same = all(o.get(k) == v[k] for k in keys)
        print(f"{'same   ' if same else 'CHANGED'} {name:20} {v['last_modified']}  {v['bytes']:>12,} bytes")
        if not same: changed.append(name)
    print(f"NASA has published new versions of: {', '.join(changed)}" if changed else 'The app data is built from NASA\'s current files.')
    output(bool(changed))
elif '--record' in sys.argv:
    now = current()
    json.dump(now, open(RECORD, 'w'), indent=1)
    meta = json.load(open(META))
    meta['nasa_sources'] = {name: v['last_modified'] for name, v in now.items()}
    json.dump(meta, open(META, 'w'), indent=1)
    print('recorded', ', '.join(f"{n} ({v['last_modified']})" for n, v in now.items()))
else:
    print(__doc__)
