# Strava Dashboard

Monorepo that contains a small Express proxy (`src/`) plus the Strava dashboard frontend (`client/`). The proxy handles OAuth/token refresh against Strava so the browser can safely fetch recent activities.

## Requirements
- Node.js 18+
- Strava API application (https://www.strava.com/settings/api)
- A refresh token generated for that application with `activity:read` (and `activity:read_all` if you need private data)

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env` with the required secrets:
   ```ini
   STRAVA_CLIENT_ID=12345
   STRAVA_CLIENT_SECRET=abc123
   STRAVA_REFRESH_TOKEN=refresh-token-from-oauth
   PORT=4000                # optional, defaults to 4000
   CLIENT_ORIGIN=http://localhost:5173
   ```
   The server refreshes the access token automatically using the refresh token.

## Request caching
To avoid Strava's 15-minute/24-hour rate limits, the proxy caches expensive responses for a short window (activities list ~30s, run/workout detail ~2min, summaries ~2min). Override the defaults via environment variables when needed:
```ini
LATEST_ACTIVITIES_CACHE_MS=30000
LATEST_RUNS_CACHE_MS=120000
LATEST_WORKOUTS_CACHE_MS=120000
RUN_SUMMARY_CACHE_MS=120000
```
Set any value to `0` to disable caching for that endpoint.

## Running locally
```bash
npm run dev     # start the proxy with watch mode
npm run client  # start the Vite dev server for the dashboard
```
- Proxy defaults to `http://localhost:4000`.
- Frontend dev server runs on `http://localhost:5173` and calls the proxy.

## Frontend configuration
The deployed dashboard points at `https://my-strava-dashboard.onrender.com`. For local work you can either edit `client/config.js` (`API_BASE_URL`) or run:
```js
localStorage.setItem('STRAVA_API_BASE_URL', 'http://localhost:4000');
```
then reload the page.

Cold starts on Render take ~50 seconds, so the first API request may pause while the instance wakes up.

## Available endpoints
- `GET /health`
- `GET /api/strava/athlete`
- `GET /api/strava/activities/latest?count=10`
- `GET /api/strava/runs/latest?count=5`
- `GET /api/strava/runs/summary?range=week|month`

These cover the data the dashboard needs; see `src/server.js` if you want to extend them.
