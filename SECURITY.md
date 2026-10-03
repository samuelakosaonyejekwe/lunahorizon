# Security

LunaHorizon is a static web app: no server, no accounts, no cookies and no analytics. Everything is computed in the
visitor's browser; the only things it stores are its settings and the user's own sites (in the browser's local storage)
and the files saved for offline use (in the service worker's cache), all on that device.

Protections in place:

* A Content-Security-Policy that allows scripts, styles, data and workers from the app's own origin only (plus the one
  inline theme script, by its hash; `npm test` checks the hash).
* Text from links and from device storage is validated or escaped before it is used; damaged or outdated stored values
  fall back to defaults instead of breaking the app. Exported CSV cells cannot run as spreadsheet formulas.
* The service worker only ever deletes its own caches (names starting `lh-`).
* The deploy workflow runs with read-only repository access, pins every action to an exact commit and keeps no token
  on disk.

## Reporting a vulnerability

Please use **Security → Report a vulnerability** on this repository (GitHub private vulnerability reporting), not a
public issue.
