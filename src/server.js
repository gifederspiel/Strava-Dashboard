require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stravaClient = require('./stravaClient');
const { createCache } = require('./cache');

const app = express();
const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN;
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGINS || CLIENT_ORIGIN || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const EXPANDED_CLIENT_ORIGINS = CLIENT_ORIGINS.flatMap((origin) => {
  if (!origin) {
    return [];
  }

  if (/^https?:\/\/localhost/.test(origin)) {
    return [origin, origin.replace('localhost', '127.0.0.1')];
  }

  if (/^https?:\/\/127\.0\.0\.1/.test(origin)) {
    return [origin, origin.replace('127.0.0.1', 'localhost')];
  }

  return [origin];
});

const UNIQUE_ALLOWED_ORIGINS = Array.from(new Set(EXPANDED_CLIENT_ORIGINS));
const RUN_SUMMARY_PAGE_SIZE = Number(process.env.RUN_SUMMARY_PAGE_SIZE || 100);
const RUN_SUMMARY_MAX_PAGES = Number(process.env.RUN_SUMMARY_MAX_PAGES || 5);

const LATEST_ACTIVITIES_CACHE_MS = Number(process.env.LATEST_ACTIVITIES_CACHE_MS || 30_000);
const LATEST_RUNS_CACHE_MS = Number(process.env.LATEST_RUNS_CACHE_MS || 120_000);
const LATEST_WORKOUTS_CACHE_MS = Number(process.env.LATEST_WORKOUTS_CACHE_MS || 120_000);
const RUN_SUMMARY_CACHE_MS = Number(process.env.RUN_SUMMARY_CACHE_MS || 120_000);

const latestActivitiesCache = createCache(LATEST_ACTIVITIES_CACHE_MS);
const latestRunsCache = createCache(LATEST_RUNS_CACHE_MS);
const latestWorkoutsCache = createCache(LATEST_WORKOUTS_CACHE_MS);
const runSummaryCache = createCache(RUN_SUMMARY_CACHE_MS);

app.use(express.json());
app.use(
  cors({
    origin: UNIQUE_ALLOWED_ORIGINS.length ? UNIQUE_ALLOWED_ORIGINS : '*',
  })
);

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'strava-proxy',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/strava/athlete', async (_req, res) => {
  try {
    const athlete = await stravaClient.fetchAthlete();
    res.json(athlete);
  } catch (error) {
    handleStravaError(error, res);
  }
});

app.get('/api/strava/activities', async (req, res) => {
  const { before, after, page, perPage } = req.query;

  const parsedQuery = {
    before: toNumber(before),
    after: toNumber(after),
    page: toNumber(page),
    perPage: toNumber(perPage),
  };

  try {
    const activities = await stravaClient.fetchActivities(parsedQuery);
    res.json(activities);
  } catch (error) {
    handleStravaError(error, res);
  }
});

app.get('/api/strava/activities/latest', async (req, res) => {
  const count = clampCount(req.query.count);
  const cacheKey = `activities_latest:${count}`;

  const cachedActivities = latestActivitiesCache.get(cacheKey);
  if (cachedActivities !== undefined) {
    res.json(cachedActivities);
    return;
  }

  try {
    const activities = await stravaClient.fetchActivities({
      perPage: count,
      page: 1,
    });
    latestActivitiesCache.set(cacheKey, activities);
    res.json(activities);
  } catch (error) {
    handleStravaError(error, res);
  }
});

app.get('/api/strava/runs/latest', async (req, res) => {
  const count = clampCount(req.query.count);
  const cacheKey = `runs_latest:${count}`;

  const cachedRuns = latestRunsCache.get(cacheKey);
  if (cachedRuns !== undefined) {
    res.json(cachedRuns);
    return;
  }

  try {
    const activities = await stravaClient.fetchActivities({
      perPage: Math.min(count * 3, 50),
      page: 1,
    });

    const runs = activities.filter(isRunActivity).slice(0, count);

    const enrichedRuns = await Promise.all(
      runs.map(async (run) => {
        try {
          const [activity, streams] = await Promise.all([
            stravaClient.fetchActivityById(run.id),
            stravaClient.fetchActivityStreams(run.id, ['time', 'latlng', 'heartrate']),
          ]);

          return {
            activity,
            streams,
          };
        } catch (error) {
          if (error.response && error.response.status === 404) {
            return {
              activity: run,
              streams: {},
            };
          }
          throw error;
        }
      })
    );

    latestRunsCache.set(cacheKey, enrichedRuns);
    res.json(enrichedRuns);
  } catch (error) {
    handleStravaError(error, res);
  }
});

app.get('/api/strava/workouts/latest', async (req, res) => {
  const count = clampCount(req.query.count);
  const cacheKey = `workouts_latest:${count}`;

  const cachedWorkouts = latestWorkoutsCache.get(cacheKey);
  if (cachedWorkouts !== undefined) {
    res.json(cachedWorkouts);
    return;
  }

  try {
    const activities = await stravaClient.fetchActivities({
      perPage: Math.min(count * 3, 50),
      page: 1,
    });

    const workouts = activities.filter(isStrengthActivity).slice(0, count);

    const enrichedWorkouts = await Promise.all(
      workouts.map(async (workout) => {
        try {
          const activity = await stravaClient.fetchActivityById(workout.id);
          return activity;
        } catch (error) {
          if (error.response && error.response.status === 404) {
            return workout;
          }
          throw error;
        }
      })
    );

    latestWorkoutsCache.set(cacheKey, enrichedWorkouts);
    res.json(enrichedWorkouts);
  } catch (error) {
    handleStravaError(error, res);
  }
});

app.get('/api/strava/runs/summary', async (req, res) => {
  const { range: rangeParam } = req.query;
  const { key: rangeKey, start, end } = resolveRangeWindow(rangeParam);
  const cacheKey = `run_summary:${rangeKey}:${start.toISOString()}:${end.toISOString()}`;

  const cachedSummary = runSummaryCache.get(cacheKey);
  if (cachedSummary !== undefined) {
    res.json(cachedSummary);
    return;
  }

  try {
    const runs = await fetchRunsInRange({
      after: Math.floor(start.getTime() / 1000),
      before: Math.floor(end.getTime() / 1000),
    });

    const summary = summariseRuns(runs);

    const payload = {
      range: rangeKey,
      from: start.toISOString(),
      to: end.toISOString(),
      runCount: runs.length,
      totals: summary.totals,
      averages: summary.averages,
      longestRun: summary.longestRun,
    };

    runSummaryCache.set(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    handleStravaError(error, res);
  }
});

app.get('/api/strava/activities/:id', async (req, res) => {
  const { id } = req.params;
  const { includeAllEfforts } = req.query;

  try {
    const includeEfforts =
      typeof includeAllEfforts === 'string'
        ? includeAllEfforts.toLowerCase() === 'true'
        : Boolean(includeAllEfforts);

    const activity = await stravaClient.fetchActivityById(id, {
      includeAllEfforts: includeEfforts,
    });
    res.json(activity);
  } catch (error) {
    handleStravaError(error, res);
  }
});

app.post('/api/strava/refresh-token', async (_req, res) => {
  try {
    const { accessToken, refreshToken, expiresAt } = await stravaClient.refreshAccessToken();
    res.json({
      accessToken,
      refreshToken,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  } catch (error) {
    handleStravaError(error, res);
  }
});

function handleStravaError(error, res) {
  if (error.response) {
    const { status, data } = error.response;
    res.status(status).json({
      error: 'Strava API request failed',
      status,
      data,
    });
  } else {
    res.status(500).json({
      error: error.message || 'Unknown Strava API error',
    });
  }
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const num = Number(value);
  return Number.isNaN(num) ? undefined : num;
}

function clampCount(value) {
  const parsed = toNumber(value) || 10;
  if (parsed < 1) {
    return 1;
  }
  if (parsed > 50) {
    return 50;
  }
  return Math.floor(parsed);
}

function resolveRangeWindow(rangeParam) {
  const lower = (rangeParam || '').toString().toLowerCase();
  const now = new Date();
  const end = new Date(now);
  let key = 'week';
  const start = new Date(now);

  if (lower === 'month' || lower === 'this_month') {
    key = 'month';
    start.setDate(start.getDate() - 30);
  } else {
    key = 'week';
    start.setDate(start.getDate() - 7);
  }

  start.setHours(0, 0, 0, 0);
  end.setMilliseconds(0);

  return { key, start, end };
}

async function fetchRunsInRange({ after, before, perPage = RUN_SUMMARY_PAGE_SIZE, maxPages = RUN_SUMMARY_MAX_PAGES }) {
  const runs = [];
  let page = 1;

  while (page <= maxPages) {
    const activities = await stravaClient.fetchActivities({
      after,
      before,
      page,
      perPage,
    });

    if (!activities.length) {
      break;
    }

    runs.push(...activities.filter(isRunActivity));

    if (activities.length < perPage) {
      break;
    }

    page += 1;
  }

  return runs;
}

function summariseRuns(runs) {
  const totals = {
    distanceMeters: 0,
    movingTimeSeconds: 0,
    elapsedTimeSeconds: 0,
    elevationGainMeters: 0,
  };

  let heartRateWeightedSum = 0;
  let heartRateWeight = 0;
  let longestRun = null;

  runs.forEach((activity) => {
    const distance = Number(activity.distance || 0);
    const movingTime = Number(activity.moving_time || 0);
    const elapsedTime = Number(activity.elapsed_time || 0);
    const elevationGain = Number(activity.total_elevation_gain || 0);
    const averageHeartRate = Number(activity.average_heartrate || 0);

    totals.distanceMeters += distance;
    totals.movingTimeSeconds += movingTime;
    totals.elapsedTimeSeconds += elapsedTime;
    totals.elevationGainMeters += elevationGain;

    if (averageHeartRate > 0 && movingTime > 0) {
      heartRateWeightedSum += averageHeartRate * movingTime;
      heartRateWeight += movingTime;
    }

    if (!longestRun || distance > Number(longestRun.distance || 0)) {
      longestRun = activity;
    }
  });

  const averagePaceSecondsPerKm =
    totals.distanceMeters > 0 ? totals.movingTimeSeconds / (totals.distanceMeters / 1000) : null;

  const averages = {
    paceSecondsPerKm: averagePaceSecondsPerKm,
    heartRateBpm: heartRateWeight > 0 ? heartRateWeightedSum / heartRateWeight : null,
  };

  const longestRunInfo = longestRun
    ? {
        id: longestRun.id,
        name: longestRun.name,
        startDate: longestRun.start_date,
        distanceMeters: Number(longestRun.distance || 0),
        movingTimeSeconds: Number(longestRun.moving_time || 0),
        averagePaceSecondsPerKm:
          Number(longestRun.distance || 0) > 0
            ? Number(longestRun.moving_time || 0) / (Number(longestRun.distance || 0) / 1000)
            : null,
      }
    : null;

  return {
    totals,
    averages,
    longestRun: longestRunInfo,
  };
}

function isRunActivity(activity) {
  if (!activity) {
    return false;
  }

  const { sport_type: sportType, type } = activity;
  const target = (sportType || type || '').toLowerCase();
  return target === 'run' || target === 'trailrun' || target === 'trail run' || target === 'virtualrun';
}

function isStrengthActivity(activity) {
  if (!activity) {
    return false;
  }

  const { sport_type: sportType, type } = activity;
  const target = (sportType || type || '').toLowerCase();

  return (
    target === 'workout' ||
    target === 'weighttraining' ||
    target === 'weight training' ||
    target === 'strengthtraining' ||
    target === 'strength training'
  );
}

app.listen(PORT, () => {
  console.log(`Strava proxy listening on port ${PORT}`);
});
