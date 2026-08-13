// Running telemetry dashboard. Reads one static ./data/activities.json
// (normalised COROS runs + COROS's daily training-load series + fitness
// snapshot) and computes advanced, activity-only statistics client-side.

// ponytail: estimated max HR — the one physical calibration knob. Zones and
// intensity are derived from this. Highest session-average seen is ~193 bpm,
// so true max is a little above. Adjust here if you know your real max HR.
const HR_MAX = 197;

// 5 HR zones as %HR_max upper bounds -> bpm cutoffs
const ZONE_PCT = [0.70, 0.80, 0.87, 0.92, 1.01];
const ZONE_MAX = ZONE_PCT.map((p) => Math.round(p * HR_MAX)); // [138,158,171,181,199]
const ZONE_LABELS = ['Z1 easy', 'Z2 aerobic', 'Z3 tempo', 'Z4 threshold', 'Z5 VO₂'];
// 3-zone polarised model (Seiler): easy < 82%, moderate 82–88%, hard ≥ 88%
const POLAR_LOW = Math.round(0.82 * HR_MAX);  // 162
const POLAR_HIGH = Math.round(0.88 * HR_MAX); // 173

const state = { activities: [], load: [], fitness: null, range: '90', charts: {} };

const bandPlugin = {
  id: 'band',
  beforeDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.lo == null) return;
    const { ctx, chartArea, scales } = chart;
    const y1 = scales.y.getPixelForValue(opts.hi);
    const y2 = scales.y.getPixelForValue(opts.lo);
    ctx.save();
    ctx.fillStyle = opts.color;
    ctx.fillRect(chartArea.left, y1, chartArea.right - chartArea.left, y2 - y1);
    ctx.restore();
  },
};
if (window.Chart) Chart.register(bandPlugin);

init();

async function init() {
  wireControls();
  try {
    const res = await fetch('./data/activities.json', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.activities = (data.activities || []).filter((a) => a.kind === 'run');
    state.load = data.load || [];
    state.fitness = data.fitness || null;
    setSynced(data.generatedAt);
    render();
  } catch (err) {
    const el = document.getElementById('status');
    el.hidden = false;
    el.textContent = `Couldn't load activity data (${err.message}). The daily sync may not have run yet.`;
  }
}

function wireControls() {
  document.getElementById('range').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-range]');
    if (!btn || btn.dataset.range === state.range) return;
    state.range = btn.dataset.range;
    document.querySelectorAll('.range__btn').forEach((b) => {
      const on = b.dataset.range === state.range;
      b.classList.toggle('range__btn--active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    render();
  });

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    const current = root.getAttribute('data-theme') || (isDark() ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    render();
  });
}

// ── Filtering ────────────────────────────────────────────────────────────
function cutoffMs() {
  return state.range === 'all' ? -Infinity : Date.now() - Number(state.range) * 86400 * 1000;
}
function runsInRange() {
  const c = cutoffMs();
  return state.activities.filter((a) => new Date(a.date).getTime() >= c);
}
function loadInRange() {
  const c = cutoffMs();
  return state.load.filter((d) => new Date(d.date).getTime() >= c);
}
function efficiencyRuns(runs) {
  return runs
    .filter((r) => !r.trail && r.distanceKm >= 2 && r.avgHr > 0 && r.efficiency > 0)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

// ── Sports-science helpers ─────────────────────────────────────────────────
function zoneIndex(hr) {
  for (let i = 0; i < ZONE_MAX.length; i += 1) if (hr <= ZONE_MAX[i]) return i;
  return 4;
}
function intensityBucket(hr) {
  if (hr < POLAR_LOW) return 'easy';
  if (hr < POLAR_HIGH + 1) return 'moderate';
  return 'hard';
}
// Edwards summated-zone session load: minutes × zone number (1–5)
function sessionLoad(r) {
  if (!r.avgHr) return 0;
  return (r.durationSec / 60) * (zoneIndex(r.avgHr) + 1);
}
function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}
function dayKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function stdev(arr) {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
}

function buildWeeks(runs) {
  const dayLoad = new Map();
  const weeks = new Map();
  for (const r of runs) {
    const wk = mondayOf(r.date);
    if (!weeks.has(wk)) weeks.set(wk, { key: wk, label: shortDate(wk), km: 0, easyMin: 0, moderateMin: 0, hardMin: 0, load: 0 });
    const w = weeks.get(wk);
    const min = r.durationSec / 60;
    w.km += r.distanceKm;
    w.load += sessionLoad(r);
    if (r.avgHr) w[`${intensityBucket(r.avgHr)}Min`] += min;
    const dk = dayKey(r.date);
    dayLoad.set(dk, (dayLoad.get(dk) || 0) + sessionLoad(r));
  }
  // monotony per week (mean/SD of the week's 7 daily loads, rest days = 0)
  for (const w of weeks.values()) {
    const days = [];
    for (let i = 0; i < 7; i += 1) days.push(dayLoad.get(w.key + i * 86400000) || 0);
    const mean = days.reduce((a, b) => a + b, 0) / 7;
    const sd = stdev(days);
    w.monotony = sd > 0.5 ? mean / sd : null;
    w.strain = w.monotony ? w.load * w.monotony : null;
  }
  return { weeks: [...weeks.values()].sort((a, b) => a.key - b.key), dayLoad };
}

function zoneMinutes(runs) {
  const z = [0, 0, 0, 0, 0];
  for (const r of runs) if (r.avgHr) z[zoneIndex(r.avgHr)] += r.durationSec / 60;
  return z;
}
function polarization(runs) {
  const t = { easy: 0, moderate: 0, hard: 0 };
  for (const r of runs) if (r.avgHr) t[intensityBucket(r.avgHr)] += r.durationSec / 60;
  const total = t.easy + t.moderate + t.hard || 1;
  return { pct: { easy: t.easy / total, moderate: t.moderate / total, hard: t.hard / total }, total };
}

// ── Render ───────────────────────────────────────────────────────────────
function render() {
  const runs = runsInRange();
  const load = loadInRange();
  const { weeks, dayLoad } = buildWeeks(runs);
  renderTiles(runs, load, weeks, dayLoad);
  renderLoadChart(load);
  renderIntensity(weeks, runs);
  renderEfficiency(runs);
  renderZones(runs);
  renderWeeklyLoad(weeks);
  renderBalance(load);
  renderRecords(runs, weeks);
  renderPredictions();
  renderLog(runs);
}

function last7Monotony(dayLoad) {
  const today = dayKey(Date.now());
  const days = [];
  for (let i = 0; i < 7; i += 1) days.push(dayLoad.get(today - i * 86400000) || 0);
  const mean = days.reduce((a, b) => a + b, 0) / 7;
  const sd = stdev(days);
  const monotony = sd > 0.5 ? mean / sd : null;
  return { monotony, load7: days.reduce((a, b) => a + b, 0) };
}

function renderTiles(runs, load, weeks, dayLoad) {
  const f = state.fitness || {};
  const latest = load[load.length - 1];
  const first = load[0];
  const eff = efficiencyRuns(runs);
  const effNow = avg(eff.slice(-3).map((r) => r.efficiency));
  const effThen = avg(eff.slice(0, 3).map((r) => r.efficiency));
  const pol = polarization(runs);
  const lastWeek = weeks[weeks.length - 1];
  const { monotony } = last7Monotony(dayLoad);

  const status = latest ? latest.comment : '';
  const statusClass = status === 'Excessive' ? 'tile__delta--down' : status === 'Optimized' ? 'tile__delta--up' : '';

  const tiles = [
    { label: 'VO₂max', value: f.vo2max != null ? String(f.vo2max) : '—', dot: 'var(--series-easy)' },
    { label: 'Threshold', value: fmtPace(f.thresholdPaceSecPerKm), unit: '/km' },
    fitnessTile(latest, first),
    effTile(effNow, effThen),
    { label: 'Form', value: latest ? latest.ratio.toFixed(2) : '—', extra: status ? `<span class="tile__delta ${statusClass}">${status}</span>` : '' },
    { label: 'Weekly load', value: lastWeek ? String(Math.round(lastWeek.load)) : '—', unit: 'EU', dot: 'var(--series-quality)' },
    { label: 'Easy share', value: `${Math.round(pol.pct.easy * 100)}`, unit: '%', dot: 'var(--series-easy)',
      extra: `<span class="tile__delta">${Math.round(pol.pct.moderate * 100)}% mod · ${Math.round(pol.pct.hard * 100)}% hard</span>` },
    { label: 'Monotony', value: monotony ? monotony.toFixed(1) : '—',
      extra: monotony ? `<span class="tile__delta ${monotony > 2 ? 'tile__delta--down' : 'tile__delta--up'}">${monotony > 2 ? 'high · vary it' : 'healthy'}</span>` : '' },
  ];
  document.getElementById('tiles').innerHTML = tiles.map(tileHtml).join('');
}

function fitnessTile(latest, first) {
  let extra = '';
  if (latest && first && first.long > 0) {
    const d = latest.long - first.long;
    const up = d >= 0;
    extra = `<span class="tile__delta ${up ? 'tile__delta--up' : 'tile__delta--down'}">${up ? '▲' : '▼'} ${Math.abs(d)} in range</span>`;
  }
  return { label: 'Fitness', value: latest ? String(latest.long) : '—', unit: 'chronic', dot: 'var(--series-easy)', extra };
}
function effTile(now, then) {
  if (!now) return { label: 'Efficiency', value: '—', unit: 'm/beat' };
  let extra = '';
  if (then) {
    const pct = Math.round(((now - then) / then) * 100);
    const up = pct >= 0;
    extra = `<span class="tile__delta ${up ? 'tile__delta--up' : 'tile__delta--down'}">${up ? '▲' : '▼'} ${Math.abs(pct)}% in range</span>`;
  }
  return { label: 'Efficiency', value: now.toFixed(2), unit: 'm/beat', dot: 'var(--series-easy)', extra };
}
function tileHtml(t) {
  return `<div class="tile" ${t.dot ? `style="--dot:${t.dot}"` : ''}>
    <span class="tile__label">${t.label}</span>
    <span class="tile__value">${t.value}${t.unit ? `<small>${t.unit}</small>` : ''}</span>
    ${t.extra || ''}
  </div>`;
}

// ── Chart infra ────────────────────────────────────────────────────────────
function isDark() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t === 'dark';
  return !matchMedia('(prefers-color-scheme: light)').matches;
}
function intensityColors() {
  return isDark()
    ? { easy: '#3987e5', moderate: '#c98500', hard: '#e66767' }
    : { easy: '#2a78d6', moderate: '#eda100', hard: '#e34948' };
}
function zoneRamp() {
  return isDark()
    ? ['#cde2fb', '#86b6ef', '#3987e5', '#256abf', '#184f95']
    : ['#b7d3f6', '#6da7ec', '#2a78d6', '#1c5cab', '#0d366b'];
}
function theme() {
  const s = getComputedStyle(document.documentElement);
  const v = (n) => s.getPropertyValue(n).trim();
  return { easy: v('--series-easy'), quality: v('--series-quality'), text: v('--text-2'), muted: v('--muted'), grid: v('--grid'), surface: v('--surface'), good: v('--good') };
}
function baseOptions(t) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'nearest', intersect: false },
    plugins: {
      legend: { display: false },
      band: {},
      tooltip: {
        backgroundColor: t.surface, titleColor: t.text, bodyColor: t.text, borderColor: t.grid, borderWidth: 1,
        padding: 10, cornerRadius: 8, titleFont: { family: 'JetBrains Mono' }, bodyFont: { family: 'JetBrains Mono' },
      },
    },
    font: { family: 'Space Grotesk' },
  };
}
function axis(t, extra = {}) {
  return { ticks: { color: t.muted, font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: t.grid, drawTicks: false }, border: { display: false }, ...extra };
}
function timeAxis(t, max = 6) {
  return axis(t, { type: 'linear', grid: { display: false }, ticks: { color: t.muted, font: { family: 'JetBrains Mono', size: 10 }, callback: (v) => shortDate(v), maxTicksLimit: max } });
}
function mount(id, config) {
  if (state.charts[id]) state.charts[id].destroy();
  const el = document.getElementById(id);
  if (el) state.charts[id] = new Chart(el, config);
}

function renderLoadChart(load) {
  const t = theme();
  const pts = (key) => load.map((d) => ({ x: new Date(d.date).getTime(), y: d[key] }));
  mount('chart-load', {
    type: 'line',
    data: {
      datasets: [
        { label: 'Fitness', data: pts('long'), borderColor: t.easy, backgroundColor: t.easy, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, tension: 0.35 },
        { label: 'Fatigue', data: pts('short'), borderColor: t.quality, backgroundColor: t.quality, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.35, borderDash: [4, 3] },
      ],
    },
    options: {
      ...baseOptions(t), parsing: false,
      scales: { x: timeAxis(t), y: axis(t) },
      plugins: { ...baseOptions(t).plugins, tooltip: { ...baseOptions(t).plugins.tooltip, callbacks: { title: (c) => shortDate(c[0].parsed.x), label: (c) => `${c.dataset.label}: ${c.parsed.y}` } } },
    },
  });
  document.getElementById('load-legend').innerHTML = legend([['Fitness', t.easy], ['Fatigue', t.quality]]);
}

function renderIntensity(weeks, runs) {
  const t = theme();
  const c = intensityColors();
  const labels = weeks.map((w) => w.label);
  mount('chart-intensity', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Easy', data: weeks.map((w) => round1(w.easyMin)), backgroundColor: c.easy, borderRadius: 3, stack: 'i' },
        { label: 'Moderate', data: weeks.map((w) => round1(w.moderateMin)), backgroundColor: c.moderate, borderRadius: 3, stack: 'i' },
        { label: 'Hard', data: weeks.map((w) => round1(w.hardMin)), backgroundColor: c.hard, borderRadius: 3, stack: 'i' },
      ],
    },
    options: {
      ...baseOptions(t),
      scales: {
        x: axis(t, { stacked: true, grid: { display: false } }),
        y: axis(t, { stacked: true, title: { display: true, text: 'minutes', color: t.muted, font: { size: 10 } } }),
      },
      plugins: { ...baseOptions(t).plugins, tooltip: { ...baseOptions(t).plugins.tooltip, callbacks: { label: (x) => `${x.dataset.label}: ${Math.round(x.raw)} min` } } },
    },
  });
  document.getElementById('intensity-legend').innerHTML = legend([['Easy', c.easy], ['Moderate', c.moderate], ['Hard', c.hard]]);

  const pol = polarization(runs);
  const e = Math.round(pol.pct.easy * 100), m = Math.round(pol.pct.moderate * 100), h = Math.round(pol.pct.hard * 100);
  const read = e >= 75 && h >= 8 ? 'well polarised — plenty of easy volume with real hard work'
    : e >= 80 ? 'very easy-heavy — room for more quality'
    : m >= 35 ? 'threshold-heavy — the classic “grey zone”, consider easier easy days'
    : 'balanced';
  document.getElementById('polar-note').innerHTML = `<strong>${e}% easy · ${m}% moderate · ${h}% hard</strong> — ${read}.`;
}

function renderEfficiency(runs) {
  const t = theme();
  const eff = efficiencyRuns(runs);
  const points = eff.map((r) => ({ x: new Date(r.date).getTime(), y: r.efficiency }));
  const trend = regressionLine(points);
  mount('chart-efficiency', {
    type: 'scatter',
    data: {
      datasets: [
        { label: 'Run', data: points, backgroundColor: t.easy, pointRadius: 3, pointHoverRadius: 5 },
        ...(trend ? [{ label: 'Trend', data: trend, type: 'line', borderColor: t.text, borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0 }] : []),
      ],
    },
    options: {
      ...baseOptions(t), parsing: false,
      scales: { x: timeAxis(t, 5), y: axis(t) },
      plugins: { ...baseOptions(t).plugins, tooltip: { ...baseOptions(t).plugins.tooltip, filter: (i) => i.datasetIndex === 0, callbacks: { title: (c) => shortDate(c[0].parsed.x), label: (c) => `${c.parsed.y.toFixed(2)} m/beat` } } },
    },
  });
}

function renderZones(runs) {
  const t = theme();
  const mins = zoneMinutes(runs);
  const ramp = zoneRamp();
  const ranges = ZONE_MAX.map((hi, i) => (i === 0 ? `<${ZONE_MAX[0]}` : i === 4 ? `${ZONE_MAX[3] + 1}+` : `${ZONE_MAX[i - 1] + 1}–${hi}`));
  mount('chart-zones', {
    type: 'bar',
    data: {
      labels: ZONE_LABELS.map((l, i) => `${l}  ${ranges[i]}`),
      datasets: [{ data: mins.map((m) => Math.round(m)), backgroundColor: ramp, borderRadius: 3 }],
    },
    options: {
      ...baseOptions(t), indexAxis: 'y',
      scales: {
        x: axis(t, { title: { display: true, text: 'minutes', color: t.muted, font: { size: 10 } } }),
        y: axis(t, { grid: { display: false }, ticks: { color: t.text, font: { family: 'Space Grotesk', size: 11 } } }),
      },
      plugins: { ...baseOptions(t).plugins, tooltip: { ...baseOptions(t).plugins.tooltip, callbacks: { label: (x) => `${Math.round(x.raw)} min` } } },
    },
  });
  document.getElementById('hrmax-note').textContent = `est. max HR ${HR_MAX} bpm`;
}

function renderWeeklyLoad(weeks) {
  const t = theme();
  mount('chart-weekly-load', {
    type: 'bar',
    data: { labels: weeks.map((w) => w.label), datasets: [{ data: weeks.map((w) => Math.round(w.load)), backgroundColor: t.easy, borderRadius: 3, monotony: weeks.map((w) => w.monotony) }] },
    options: {
      ...baseOptions(t),
      scales: {
        x: axis(t, { grid: { display: false } }),
        y: axis(t, { title: { display: true, text: 'effort units', color: t.muted, font: { size: 10 } } }),
      },
      plugins: {
        ...baseOptions(t).plugins,
        tooltip: { ...baseOptions(t).plugins.tooltip, callbacks: {
          label: (x) => `${x.raw} EU`,
          afterLabel: (x) => { const mo = weeks[x.dataIndex].monotony; return mo ? `monotony ${mo.toFixed(1)}` : ''; },
        } },
      },
    },
  });
}

function renderBalance(load) {
  const t = theme();
  const points = load.map((d) => ({ x: new Date(d.date).getTime(), y: d.ratio }));
  mount('chart-balance', {
    type: 'line',
    data: { datasets: [{ data: points, borderColor: t.muted, backgroundColor: t.muted, borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.3, segment: { borderColor: (ctx) => (ctx.p1.parsed.y > 1.5 ? t.quality : t.muted) } }] },
    options: {
      ...baseOptions(t), parsing: false,
      scales: { x: timeAxis(t), y: axis(t, { suggestedMin: 0.7, suggestedMax: 1.6 }) },
      plugins: { ...baseOptions(t).plugins, band: { lo: 0.8, hi: 1.3, color: hexToRgba(t.good, 0.13) }, tooltip: { ...baseOptions(t).plugins.tooltip, callbacks: { title: (c) => shortDate(c[0].parsed.x), label: (c) => `ratio ${c.parsed.y.toFixed(2)}` } } },
    },
  });
}

function renderRecords(runs, weeks) {
  const road = runs.filter((r) => !r.trail && r.avgHr > 0);
  const fastest = minBy(road.filter((r) => r.distanceKm >= 3), (r) => r.paceSecPerKm);
  const fastest10 = minBy(road.filter((r) => r.distanceKm >= 10), (r) => r.paceSecPerKm);
  const longest = maxBy(runs, (r) => r.distanceKm);
  const bigWeek = maxBy(weeks, (w) => w.km);
  const totalKm = sum(runs.map((r) => r.distanceKm));
  const totalSec = sum(runs.map((r) => r.durationSec));

  const rows = [
    fastest && { label: 'Fastest pace', value: fmtPace(fastest.paceSecPerKm), unit: '/km', sub: `${escapeHtml(fastest.name)} · ${fmt1(fastest.distanceKm)} km` },
    fastest10 && { label: 'Fastest 10 km+', value: fmtPace(fastest10.paceSecPerKm), unit: '/km', sub: `${escapeHtml(fastest10.name)} · ${fmt1(fastest10.distanceKm)} km` },
    longest && { label: 'Longest run', value: fmt1(longest.distanceKm), unit: 'km', sub: shortDate(new Date(longest.date).getTime()) },
    bigWeek && { label: 'Biggest week', value: fmt1(bigWeek.km), unit: 'km', sub: `week of ${bigWeek.label}` },
    { label: 'Total distance', value: fmt1(totalKm), unit: 'km', sub: `${runs.length} runs` },
    { label: 'Total time', value: fmtHours(totalSec), sub: `${Math.round(totalSec / 3600 / (weeks.length || 1) * 10) / 10} h/week` },
  ].filter(Boolean);

  document.getElementById('records').innerHTML = rows
    .map((r) => `<div class="record">
      <span class="record__label">${r.label}</span>
      <span class="record__value">${r.value}${r.unit ? `<small>${r.unit}</small>` : ''}</span>
      <span class="record__sub">${r.sub}</span>
    </div>`)
    .join('');
}

function renderPredictions() {
  const p = (state.fitness && state.fitness.predictions) || {};
  const rows = [['5K', p['5k']], ['10K', p['10k']], ['Half', p.half], ['Marathon', p.marathon]];
  document.getElementById('predictions').innerHTML = rows
    .map(([k, v]) => `<div class="predict__row"><span class="predict__dist">${k}</span><span class="predict__time">${v || '—'}</span></div>`)
    .join('');
}

function renderLog(runs) {
  document.getElementById('log-count').textContent = `${runs.length} runs`;
  document.getElementById('log-body').innerHTML = runs.slice(0, 25)
    .map((r) => `<tr>
      <td class="num">${shortDate(new Date(r.date).getTime())}</td>
      <td><div class="log__name">${escapeHtml(r.name)}</div></td>
      <td><span class="log__loc">${r.sport}</span></td>
      <td class="num">${fmt1(r.distanceKm)}</td>
      <td class="num">${r.trail ? '—' : fmtPace(r.paceSecPerKm)}</td>
      <td class="num">${r.avgHr || '—'}</td>
      <td class="num">${r.efficiency ? r.efficiency.toFixed(2) : '—'}</td>
      <td class="num">${fmtClock(r.durationSec)}</td>
    </tr>`)
    .join('');
}

// ── Math / format helpers ──────────────────────────────────────────────────
function regressionLine(points) {
  if (points.length < 3) return null;
  const n = points.length;
  const xs = points.map((p) => p.x);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0, sxy = 0;
  for (const p of points) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  return [{ x: x0, y: my + slope * (x0 - mx) }, { x: x1, y: my + slope * (x1 - mx) }];
}
function legend(items) {
  return items.map(([name, color]) => `<span class="legend__item"><span class="legend__swatch" style="background:${color}"></span>${name}</span>`).join('');
}
function hexToRgba(hex, alpha) {
  const h = (hex || '').replace('#', '');
  if (h.length < 6) return `rgba(12,163,12,${alpha})`;
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
const sum = (a) => a.reduce((x, y) => x + y, 0);
const avg = (a) => (a.length ? sum(a) / a.length : 0);
const round1 = (n) => Math.round(n * 10) / 10;
const minBy = (a, f) => (a.length ? a.reduce((m, x) => (f(x) < f(m) ? x : m)) : null);
const maxBy = (a, f) => (a.length ? a.reduce((m, x) => (f(x) > f(m) ? x : m)) : null);

function fmt1(n) { return (Math.round(n * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
function fmtPace(sec) { if (!sec || !isFinite(sec)) return '—'; return `${Math.floor(sec / 60)}:${Math.round(sec % 60).toString().padStart(2, '0')}`; }
function fmtHours(sec) { const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; }
function fmtClock(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`;
}
function shortDate(ms) { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(ms)); }
function setSynced(iso) {
  if (!iso) return;
  const d = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(iso));
  document.getElementById('synced').textContent = `Running telemetry · synced ${d}`;
}
function escapeHtml(str) { return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
