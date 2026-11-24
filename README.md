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
- Wuthering Waves banner countdown (next phase, what follows, what is live now)
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
| `GCAL_ICS_URLS` | Secret iCal address(es), separated by spaces. Prefix one with `homework:` to read it as a homework/exam calendar |
| `SCHOOL_ICS_URL` | School dates iCal address (ATIW Termine). Exams and other school dates go to their own "Coming up" tab. Set with `private/set-calendars.ps1` |

Calendar extras: add `#countdown` to an event title to show it as a countdown.
Settings `calendarHide` (hide routine events by title), `birthdays` (`[{ "name", "date": "MM-DD", "year" }]`),
`countdowns` and `schoolRoutes` live in `private/config.json`.

## Wuthering Waves banners
The schedule is in `schedule/wuwa-banners.json` (public, no personal data). When Kuro
announces a new version or phase, add a line to `phases` and push. A start with an
offset (`2026-12-22T11:00+08:00`) is one global moment, like a version update after
maintenance; a start without one (`2026-12-03T10:00`) is server time, used for Phase 2
banners. `serverOffset` picks the server (Europe `+01:00`, America `-05:00`, Asia `+08:00`);
`wuwaServer` in `private/config.json` overrides it. Mark leaks and guesses with
`"tentative": true`. If the list runs out, the card estimates the next phase
`phaseDays` (21) after the last one and says so.

## Updates
Push to `main`. The Action deploys and writes `version.json`; the device reloads
within about 5 minutes, and once a night as a safety net.

## Safari 12 rules
JS ES2017 at most (no `?.`, `??`, object spread, `catch {}` without a variable,
`Array.flat`, `Promise.allSettled`). CSS: no flex `gap`, `aspect-ratio`,
`:is()`/`:where()`, `backdrop-filter`, `inset`, `clamp()`.
