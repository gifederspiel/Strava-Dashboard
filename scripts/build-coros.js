// Turns client/data/raw.json (flat COROS fields, transcribed by the daily agent)
// into the dashboard JSON the client already renders. All math lives here so the
// agent only has to transcribe numbers, never compute summaries.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DATA_DIR = path.join(__dirname, '..', 'client', 'data');
const RUN_COUNT = 10;
const WORKOUT_COUNT = 5;

const SPORT_NAMES = {
  100: 'Run', 101: 'Indoor Run', 102: 'Trail Run', 103: 'Track Run',
  400: 'Cardio', 401: 'Cardio', 402: 'Strength',
};
const RUN_TYPES = new Set([100, 101, 102, 103]);
const STRENGTH_TYPES = new Set([400, 401, 402]);

// COROS activity -> the Strava-ish shape client/main.js already reads.
function toActivity(a) {
  const distanceMeters = Number(a.distanceKm || 0) * 1000;
  const movingTime = a.durationSec ?? (Number(a.endTimestamp || 0) - Number(a.startTimestamp || 0));
  const hr = Number(a.avgHr || 0);
  return {
    id: a.labelId,
    name: a.name || SPORT_NAMES[a.sportType] || 'Activity',
    sport_type: SPORT_NAMES[a.sportType] || 'Workout',
    type: SPORT_NAMES[a.sportType] || 'Workout',
    start_date: new Date(Number(a.startTimestamp) * 1000).toISOString(),
    distance: distanceMeters,
    moving_time: movingTime,
    elapsed_time: movingTime,
    total_elevation_gain: Number(a.elevGainM || 0),
    average_speed: movingTime > 0 ? distanceMeters / movingTime : 0,
    average_heartrate: hr,
    has_heartrate: hr > 0,
    calories: Number(a.calories || 0),
    suffer_score: Number(a.trainingLoad || 0),
    description: '',
  };
}

function summarise(activities, key, sinceDays) {
  const cutoff = Date.now() - sinceDays * 86400 * 1000;
  const runs = activities.filter((a) => new Date(a.start_date).getTime() >= cutoff);

  const totals = { distanceMeters: 0, movingTimeSeconds: 0, elapsedTimeSeconds: 0, elevationGainMeters: 0 };
  let hrWeightedSum = 0;
  let hrWeight = 0;
  let longest = null;

  for (const a of runs) {
    totals.distanceMeters += a.distance;
    totals.movingTimeSeconds += a.moving_time;
    totals.elapsedTimeSeconds += a.elapsed_time;
    totals.elevationGainMeters += a.total_elevation_gain;
    if (a.average_heartrate > 0 && a.moving_time > 0) {
      hrWeightedSum += a.average_heartrate * a.moving_time;
      hrWeight += a.moving_time;
    }
    if (!longest || a.distance > longest.distance) longest = a;
  }

  return {
    range: key,
    from: new Date(cutoff).toISOString(),
    to: new Date().toISOString(),
    runCount: runs.length,
    totals,
    averages: {
      paceSecondsPerKm: totals.distanceMeters > 0 ? totals.movingTimeSeconds / (totals.distanceMeters / 1000) : null,
      heartRateBpm: hrWeight > 0 ? hrWeightedSum / hrWeight : null,
    },
    longestRun: longest
      ? {
          id: longest.id, name: longest.name, startDate: longest.start_date,
          distanceMeters: longest.distance, movingTimeSeconds: longest.moving_time,
          averagePaceSecondsPerKm: longest.distance > 0 ? longest.moving_time / (longest.distance / 1000) : null,
        }
      : null,
  };
}

function write(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data));
}

function main() {
  const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'raw.json'), 'utf8'));
  const activities = (raw.activities || [])
    .map((a) => ({ ...toActivity(a), __sportType: a.sportType }))
    .sort((a, b) => new Date(b.start_date) - new Date(a.start_date));

  const runs = activities.filter((a) => RUN_TYPES.has(a.__sportType));
  const workouts = activities.filter((a) => STRENGTH_TYPES.has(a.__sportType));

  write('runs.json', runs.slice(0, RUN_COUNT).map(({ __sportType, ...activity }) => ({ activity, streams: {} })));
  write('workouts.json', workouts.slice(0, WORKOUT_COUNT).map(({ __sportType, ...activity }) => activity));
  write('summary-week.json', summarise(runs, 'week', 7));
  write('summary-month.json', summarise(runs, 'month', 30));
  console.log(`Built ${runs.length} runs, ${workouts.length} workouts from ${(raw.activities || []).length} activities`);
}

function selfCheck() {
  const raw = {
    activities: [
      { labelId: '1', sportType: 100, name: 'A', startTimestamp: Math.floor(Date.now() / 1000) - 3600, endTimestamp: Math.floor(Date.now() / 1000) - 3300, distanceKm: 1, avgHr: 150, calories: 60 },
      { labelId: '2', sportType: 103, name: 'B', startTimestamp: Math.floor(Date.now() / 1000) - 7200, durationSec: 600, distanceKm: 2, avgHr: 160, calories: 120 },
      { labelId: '3', sportType: 402, name: 'Lift', startTimestamp: Math.floor(Date.now() / 1000) - 100, durationSec: 1800, distanceKm: 0, avgHr: 110, calories: 200, trainingLoad: 40 },
    ],
  };
  const activities = raw.activities.map((a) => ({ ...toActivity(a), __sportType: a.sportType }));
  const runs = activities.filter((a) => RUN_TYPES.has(a.__sportType));
  const workouts = activities.filter((a) => STRENGTH_TYPES.has(a.__sportType));

  assert.strictEqual(runs.length, 2, 'two runs classified');
  assert.strictEqual(workouts.length, 1, 'one strength workout classified');
  assert.strictEqual(runs.find((r) => r.id === '1').moving_time, 300, 'duration from end-start');
  assert.strictEqual(runs.find((r) => r.id === '2').moving_time, 600, 'duration from durationSec');

  const week = summarise(runs, 'week', 7);
  assert.strictEqual(week.runCount, 2, 'both runs within a week');
  assert.strictEqual(week.totals.distanceMeters, 3000, 'distance total 3km');
  assert.strictEqual(week.averages.paceSecondsPerKm, 300, 'pace 900s / 3km = 300');
  assert.strictEqual(week.longestRun.id, '2', 'longest is 2km run');
  assert.ok(workouts[0].suffer_score === 40, 'trainingLoad -> suffer_score');
  console.log('selfcheck ok');
}

if (require.main === module) {
  process.argv.includes('--check') ? selfCheck() : main();
}
