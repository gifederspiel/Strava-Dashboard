# Strava Dashboard

A fully static running dashboard (`client/`) hosted on GitHub Pages at
[run.gianfederspiel.ch](https://run.gianfederspiel.ch). There is **no backend** —
the page reads pre-generated JSON from `client/data/`.

## How the data flows

1. A daily **Claude cloud routine** (120-day window) calls the COROS connector,
   transcribes activities into `client/data/raw.json`, and runs `scripts/build-coros.js`.
2. `build-coros.js` normalises `raw.json` into `client/data/activities.json` — runs
   (with a per-run aerobic-efficiency value), COROS's daily training-load series
   (fitness / fatigue / ratio), and the current fitness snapshot (VO₂max, threshold,
   race predictions). The dashboard reads that one file and computes the charts
   client-side.
3. The routine commits `client/data/` to `main`; the push triggers the Pages
   deploy in `.github/workflows/main.yml`.

Manage the routine at https://claude.ai/code/routines

## Local development

```bash
npm run build     # rebuild client/data/activities.json from client/data/raw.json
npm test          # build-coros self-check (asserts classification + duration)
npm run client    # serve client/ at http://localhost:5173
```

The dashboard is a static page using Chart.js (CDN) and Google Fonts; it reads only
`./data/activities.json`. Dark is the default theme with a light toggle.

To refresh `raw.json` yourself, ask Claude (with the COROS connector) to pull your
recent COROS activities in the shape documented at the top of `scripts/build-coros.js`.

## Notes / possible extensions

- **Route map + heart-rate graph** are omitted: COROS `getActivityDetail` returns
  summary metrics only, not per-point GPS/HR streams. Those live in the activity's
  FIT file — parsing it (`queryActivityFitFileDownloadUrls` + a FIT parser) is the
  upgrade path if you want the graphs back.
- **Header profile** (name/avatar) is dropped: COROS `queryUserInfo` exposes only
  height/weight/gender, no display name or avatar.
