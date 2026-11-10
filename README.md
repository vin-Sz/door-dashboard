# Door Dashboard

A "leaving the house" screen for an old iPad (iOS 12 / Safari 12), 1024×768 landscape.
Plain HTML + CSS + JavaScript, no framework, no build step for the page.

## Privacy model
The public code contains no personal data. Location, station, timetable, WebUntis
and calendar data are all published **encrypted** (`data/*.enc.json`, AES-GCM).
The page decrypts them in the browser with the key from the URL fragment
(`#k=...`), which is never sent to the server. Without the key the page shows a
clock and a lock symbol only.

## Shows
- Clock, date, reminder banners
- Weather (Open-Meteo) with umbrella and jacket tips
- Train/bus departures (Transitous, DBF fallback) with delays and "leave in X min"
- School day from WebUntis (fallback: regular timetable), calm screen on weekends and holidays
- Calendar events (iCal) and the next holidays
- Dim night mode (tap to wake for 2 minutes, preview with `#night=1`)

## Settings
Kept locally in `private/config.json` (git-ignored) and stored as the GitHub
secret `PRIVATE_CONFIG`. After editing, run:

    powershell -ExecutionPolicy Bypass -File scripts/push-config.ps1

The iPad picks up the change within about 10 minutes.

## Secrets
| Secret | Purpose |
|---|---|
| `DATA_KEY` | Encryption key, also in the device URL as `#k=...` |
| `PRIVATE_CONFIG` | Contents of `private/config.json` |
| `UNTIS_SERVER`, `UNTIS_SCHOOL`, `UNTIS_USER`, `UNTIS_SECRET` | WebUntis login (key from "Untis Mobile" access) |
| `GCAL_ICS_URLS` | Secret iCal address(es), separated by spaces |

## Updates
Push to `main`. The Action deploys and writes `version.json`; the device reloads
within about 5 minutes, and once a night as a safety net.

## Safari 12 rules
JS ES2017 at most (no `?.`, `??`, object spread, `catch {}` without a variable,
`Array.flat`, `Promise.allSettled`). CSS: no flex `gap`, `aspect-ratio`,
`:is()`/`:where()`, `backdrop-filter`, `inset`, `clamp()`.
