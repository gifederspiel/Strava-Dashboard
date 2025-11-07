export const API_BASE_URL =
  window.__STRAVA_API_BASE_URL__ ||
  import.meta?.env?.VITE_STRAVA_API_BASE_URL ||
  'http://localhost:4000';

export const LATEST_ACTIVITY_COUNT = 10;

