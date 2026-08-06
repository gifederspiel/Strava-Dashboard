// Turns client/data/raw.json (COROS fields transcribed by the daily agent) into
// client/data/activities.json — one payload the dashboard reads and analyses
// client-side: normalised runs + COROS's own daily training-load series + the
// current fitness snapshot. Deterministic; the agent only transcribes numbers.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DATA_DIR = path.join(__dirname, '..', 'client', 'data');

const SPORT = {
  100: 'Road', 101: 'Treadmill', 102: 'Trail', 103: 'Track',
  400: 'Cardio', 401: 'Cardio', 402: 'Strength',
};
const STRENGTH_TYPES = new Set([400, 401, 402]);

function normalise(a) {
  const durationSec = a.endTimestamp && a.startTimestamp
    ? a.endTimestamp - a.startTimestamp
    : a.durationSec || 0;
  const distanceKm = Number(a.distanceKm || 0);
  const paceSecPerKm = a.paceSecPerKm || (distanceKm > 0 ? durationSec / distanceKm : 0);
  const avgHr = Number(a.avgHr || 0);
  const distanceM = distanceKm * 1000;
  // Efficiency = metres covered per heartbeat; rises as aerobic fitness improves.
  const efficiency = avgHr > 0 && durationSec > 0
    ? distanceM / (avgHr * (durationSec / 60))
    : 0;
  return {
    id: String(a.labelId),
    date: new Date(Number(a.startTimestamp) * 1000).toISOString(),
    sportType: a.sportType,
    sport: SPORT[a.sportType] || 'Run',
    name: a.name || SPORT[a.sportType] || 'Session',
    distanceKm,
    durationSec,
    paceSecPerKm,
    avgHr,
    calories: Number(a.calories || 0),
    efficiency: Math.round(efficiency * 1000) / 1000,
    kind: STRENGTH_TYPES.has(a.sportType) ? 'workout' : 'run',
    trail: a.sportType === 102,
  };
}

function main() {
  const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'raw.json'), 'utf8'));
  const activities = (raw.activities || [])
    .filter((a) => a.labelId && a.startTimestamp)
    .map(normalise)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const load = (raw.load || [])
    .filter((d) => d && d.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  fs.writeFileSync(
    path.join(DATA_DIR, 'activities.json'),
    JSON.stringify({
      generatedAt: raw.generatedAt || new Date().toISOString(),
      fitness: raw.fitness || null,
      load,
      activities,
    })
  );

  const runs = activities.filter((a) => a.kind === 'run').length;
  console.log(`Built activities.json: ${activities.length} activities (${runs} runs), ${load.length} load days`);
}

function selfCheck() {
  const now = Math.floor(Date.now() / 1000);
  const road = normalise({ labelId: 'a', sportType: 100, name: 'Lucerne Run', startTimestamp: now - 3600, endTimestamp: now - 1800, distanceKm: 6, paceSecPerKm: 300, avgHr: 150, calories: 400 });
  const trail = normalise({ labelId: 'b', sportType: 102, name: 'Calvi Trail', startTimestamp: now - 200, endTimestamp: now - 100, distanceKm: 14, paceSecPerKm: 768, avgHr: 137, calories: 1600 });
  assert.strictEqual(road.trail, false, 'road run not trail');
  assert.strictEqual(trail.trail, true, 'sportType 102 is trail');
  assert.strictEqual(road.durationSec, 1800, 'duration from timestamps');
  assert.ok(!('quality' in road), 'no name-based quality flag anymore');
  // 6000 m / (150 bpm * 30 min) = 1.333 m/beat
  assert.ok(Math.abs(road.efficiency - 1.333) < 0.01, 'efficiency = m per heartbeat');
  console.log('selfcheck ok');
}

if (require.main === module) {
  process.argv.includes('--check') ? selfCheck() : main();
}
