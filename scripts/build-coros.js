// Turns client/data/raw.json (flat COROS fields, transcribed by the daily agent)
// into client/data/activities.json: one normalized, sorted array the dashboard
// reads and analyses entirely client-side. Keep this deterministic — the agent
// only transcribes numbers, this file does the classifying.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DATA_DIR = path.join(__dirname, '..', 'client', 'data');

const SPORT = {
  100: 'Road', 101: 'Treadmill', 102: 'Trail', 103: 'Track',
  400: 'Cardio', 401: 'Cardio', 402: 'Strength',
};
const RUN_TYPES = new Set([100, 101, 102, 103]);
const STRENGTH_TYPES = new Set([400, 401, 402]);
// Names COROS gives structured sessions. Track runs (103) are always quality.
const QUALITY_RE = /interval|tempo|threshold|vo2|fartlek|\bstrides?\b|\d+\s*[x×]\s*\d|pace\b/i;

function normalise(a) {
  const durationSec = a.endTimestamp && a.startTimestamp
    ? a.endTimestamp - a.startTimestamp
    : a.durationSec || 0;
  const distanceKm = Number(a.distanceKm || 0);
  const paceSecPerKm = a.paceSecPerKm || (distanceKm > 0 ? durationSec / distanceKm : 0);
  const quality = a.sportType === 103 || QUALITY_RE.test(a.name || '');
  return {
    id: String(a.labelId),
    date: new Date(Number(a.startTimestamp) * 1000).toISOString(),
    sportType: a.sportType,
    sport: SPORT[a.sportType] || 'Run',
    name: a.name || SPORT[a.sportType] || 'Session',
    distanceKm,
    durationSec,
    paceSecPerKm,
    avgHr: Number(a.avgHr || 0),
    calories: Number(a.calories || 0),
    kind: STRENGTH_TYPES.has(a.sportType) ? 'workout' : 'run',
    quality,
    trail: a.sportType === 102,
  };
}

function main() {
  const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'raw.json'), 'utf8'));
  const activities = (raw.activities || [])
    .filter((a) => a.labelId && a.startTimestamp)
    .map(normalise)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  fs.writeFileSync(
    path.join(DATA_DIR, 'activities.json'),
    JSON.stringify({ generatedAt: raw.generatedAt || new Date().toISOString(), activities })
  );

  const runs = activities.filter((a) => a.kind === 'run').length;
  console.log(`Built activities.json: ${activities.length} activities (${runs} runs)`);
}

function selfCheck() {
  const now = Math.floor(Date.now() / 1000);
  const rows = [
    normalise({ labelId: 'a', sportType: 100, name: 'Lucerne Run', startTimestamp: now - 3600, endTimestamp: now - 3300, distanceKm: 1, paceSecPerKm: 300, avgHr: 150, calories: 60 }),
    normalise({ labelId: 'b', sportType: 103, name: '5K Pace Intervals', startTimestamp: now - 7200, endTimestamp: now - 6600, distanceKm: 2, paceSecPerKm: 300, avgHr: 165, calories: 120 }),
    normalise({ labelId: 'c', sportType: 100, name: '4 x 1600m tempo', startTimestamp: now - 100, endTimestamp: now, distanceKm: 6, paceSecPerKm: 345, avgHr: 171, calories: 500 }),
    normalise({ labelId: 'd', sportType: 102, name: 'Calvi Trail Run', startTimestamp: now - 200, endTimestamp: now - 100, distanceKm: 14, paceSecPerKm: 768, avgHr: 137, calories: 1600 }),
  ];
  assert.strictEqual(rows[0].quality, false, 'plain road run is not quality');
  assert.strictEqual(rows[1].quality, true, 'track run is quality');
  assert.strictEqual(rows[2].quality, true, 'name "tempo" is quality');
  assert.strictEqual(rows[3].trail, true, 'sportType 102 is trail');
  assert.strictEqual(rows[0].durationSec, 300, 'duration from timestamps');
  assert.strictEqual(rows[0].kind, 'run', 'road run classified as run');
  console.log('selfcheck ok');
}

if (require.main === module) {
  process.argv.includes('--check') ? selfCheck() : main();
}
