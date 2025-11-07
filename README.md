# Strava Proxy Server

Express proxy that wraps the Strava API so the dashboard can call a local server instead of managing OAuth in the browser. A lightweight frontend (in `client/`) consumes the proxy and renders your latest activities.

## Prerequisites
- Strava API application (https://www.strava.com/settings/api)
- Node.js 18+

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Set environment variables in `.env` (already ignored by git):
   ```ini
   STRAVA_CLIENT_ID=your-app-id
   STRAVA_CLIENT_SECRET=your-app-secret
   STRAVA_REFRESH_TOKEN=refresh-token-from-oauth
   # Optional: boot with a known access token and expiry
   STRAVA_ACCESS_TOKEN=initial-access-token
   STRAVA_ACCESS_TOKEN_EXPIRES_AT=unix-timestamp-ms
   # Optional overrides:
   # STRAVA_TOKEN_URL=https://www.strava.com/oauth/token
   # STRAVA_API_BASE_URL=https://www.strava.com/api/v3
   # PORT=4000
   # CLIENT_ORIGIN=http://localhost:5173
   # CLIENT_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
   ```
   The server automatically refreshes access tokens using the refresh token.

## Running
- `npm run start` – run the server on `PORT` (defaults to 4000)
- `npm run dev` – same as start but with Node's watch mode
- `npm run client` – serves the standalone frontend at http://localhost:5173

> Tip: set `CLIENT_ORIGIN=http://localhost:5173` in `.env` if you want to restrict CORS to the frontend URL instead of allowing all origins.

## Endpoints
- `GET /health` – quick health check  
- `GET /api/strava/athlete` – returns the authenticated athlete
- `GET /api/strava/activities?after=unix&before=unix&page=1&perPage=50` – paginated activity list
- `GET /api/strava/activities/latest?count=10` – convenience endpoint for the most recent activities
- `GET /api/strava/runs/latest?count=5` – latest running activities enriched with GPS + heart rate streams
- `GET /api/strava/runs/summary?range=week|month` – aggregate stats (distance, pace, elevation, HR) for the chosen window
- `GET /api/strava/activities/:id?includeAllEfforts=true` – detailed activity payload
- `POST /api/strava/refresh-token` – refreshes tokens and returns the new access + refresh pair

The low-level helper `stravaRequest` in `src/stravaClient.js` is exported so you can bolt on more endpoints if needed.

## Frontend usage
1. Start the proxy (`npm run dev`).
2. In a second terminal run `npm run client`.
3. Visit http://localhost:5173 to view the latest activity feed.

The frontend defaults to calling `http://localhost:4000`, but you can click the API target label in the footer to point it at another environment. The URL is stored in `localStorage` so it sticks between sessions.

The UI focuses on running workouts: an overview section lets you toggle between weekly and monthly totals (distance, time, pace, elevation, average heart rate, and longest run) via `/api/strava/runs/summary`, followed by a feed of recent runs with inline route maps and heart-rate charts sourced from `/api/strava/runs/latest`. Make sure your Strava tokens were authorised with `activity:read` (and `activity:read_all` if you need private runs or heart-rate streams).
