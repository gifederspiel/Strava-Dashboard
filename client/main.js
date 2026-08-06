// Running telemetry dashboard. Reads one static ./data/activities.json
// (normalised COROS runs + COROS's daily training-load series + fitness
// snapshot) and computes every metric client-side.

const state = { activities: [], load: [], fitness: null, range: '90', charts: {} };

// Fills the y-band [lo,hi] on a chart — used for the load-ratio optimal zone.
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
    const current = root.getAttribute('data-theme')
      || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    render();
  });
}

// ── Filtering ────────────────────────────────────────────────────────────
function cutoffMs() {
  if (state.range === 'all') return -Infinity;
  return Date.now() - Number(state.range) * 86400 * 1000;
}
function runsInRange() {
  const c = cutoffMs();
  return state.activities.filter((a) => new Date(a.date).getTime() >= c);
}
function loadInRange() {
  const c = cutoffMs();
  return state.load.filter((d) => new Date(d.date).getTime() >= c);
}
// runs usable for aerobic-efficiency (steady effort, excl. trail & short reps)
function efficiencyRuns(runs) {
  return runs
    .filter((r) => !r.trail && r.distanceKm >= 2 && r.avgHr > 0 && r.efficiency > 0)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

// ── Render ───────────────────────────────────────────────────────────────
function render() {
  const runs = runsInRange();
  const load = loadInRange();
  renderTiles(runs, load);
  renderLoadChart(load);
  renderEfficiency(runs);
  renderBalance(load);
  renderVolume(runs);
  renderPredictions();
  renderLog(runs);
}

function renderTiles(runs, load) {
  const f = state.fitness || {};
  const latest = load[load.length - 1];
  const first = load[0];
  const eff = efficiencyRuns(runs);
  const effNow = avg(eff.slice(-3).map((r) => r.efficiency));
  const effThen = avg(eff.slice(0, 3).map((r) => r.efficiency));

  const status = latest ? latest.comment : '';
  const statusClass = status === 'Excessive' ? 'tile__delta--down'
    : status === 'Optimized' ? 'tile__delta--up' : '';

  const tiles = [
    { label: 'VO₂max', value: f.vo2max != null ? String(f.vo2max) : '—', dot: 'var(--series-easy)' },
    { label: 'Threshold', value: fmtPace(f.thresholdPaceSecPerKm), unit: '/km' },
    fitnessTile(latest, first),
    { label: 'Fatigue', value: latest ? String(latest.short) : '—', unit: 'acute', dot: 'var(--series-quality)' },
    { label: 'Form', value: latest ? latest.ratio.toFixed(2) : '—',
      extra: status ? `<span class="tile__delta ${statusClass}">${status}</span>` : '' },
    effTile(effNow, effThen),
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

// ── Charts ───────────────────────────────────────────────────────────────
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
        backgroundColor: t.surface, titleColor: t.text, bodyColor: t.text,
        borderColor: t.grid, borderWidth: 1, padding: 10, cornerRadius: 8,
        titleFont: { family: 'JetBrains Mono' }, bodyFont: { family: 'JetBrains Mono' },
      },
    },
    font: { family: 'Space Grotesk' },
  };
}

function axis(t, extra = {}) {
  return { ticks: { color: t.muted, font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: t.grid, drawTicks: false }, border: { display: false }, ...extra };
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
      ...baseOptions(t),
      parsing: false,
      scales: {
        x: axis(t, { type: 'linear', grid: { display: false }, ticks: { color: t.muted, font: { family: 'JetBrains Mono', size: 10 }, callback: (v) => shortDate(v), maxTicksLimit: 6 } }),
        y: axis(t),
      },
      plugins: { ...baseOptions(t).plugins, tooltip: { ...baseOptions(t).plugins.tooltip, callbacks: { title: (c) => shortDate(c[0].parsed.x), label: (c) => `${c.dataset.label}: ${c.parsed.y}` } } },
    },
  });
  document.getElementById('load-legend').innerHTML = legend([['Fitness', t.easy], ['Fatigue', t.quality]]);
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
        ...(trend ? [{ label: 'Trend', data: trend, type: 'line', borderColor: t.text, borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, tension: 0 }] : []),
      ],
    },
    options: {
      ...baseOptions(t),
      parsing: false,
      scales: {
        x: axis(t, { type: 'linear', grid: { display: false }, ticks: { color: t.muted, font: { family: 'JetBrains Mono', size: 10 }, callback: (v) => shortDate(v), maxTicksLimit: 5 } }),
        y: axis(t),
      },
      plugins: { ...baseOptions(t).plugins, tooltip: { ...baseOptions(t).plugins.tooltip, filter: (i) => i.datasetIndex === 0, callbacks: { title: (c) => shortDate(c[0].parsed.x), label: (c) => `${c.parsed.y.toFixed(2)} m/beat` } } },
    },
  });
}

function renderBalance(load) {
  const t = theme();
  const points = load.map((d) => ({ x: new Date(d.date).getTime(), y: d.ratio }));
  const bandColor = hexToRgba(t.good, 0.13);
  mount('chart-balance', {
    type: 'line',
    data: { datasets: [{ data: points, borderColor: t.muted, backgroundColor: t.muted, borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.3, segment: { borderColor: (ctx) => (ctx.p1.parsed.y > 1.5 ? t.quality : t.muted) } }] },
    options: {
      ...baseOptions(t),
      parsing: false,
      scales: {
        x: axis(t, { type: 'linear', grid: { display: false }, ticks: { color: t.muted, font: { family: 'JetBrains Mono', size: 10 }, callback: (v) => shortDate(v), maxTicksLimit: 6 } }),
        y: axis(t, { suggestedMin: 0.7, suggestedMax: 1.6 }),
      },
      plugins: { ...baseOptions(t).plugins, band: { lo: 0.8, hi: 1.3, color: bandColor }, tooltip: { ...baseOptions(t).plugins.tooltip, callbacks: { title: (c) => shortDate(c[0].parsed.x), label: (c) => `ratio ${c.parsed.y.toFixed(2)}` } } },
    },
  });
}

function renderVolume(runs) {
  const t = theme();
  const weeks = groupByWeek(runs);
  mount('chart-volume', {
    type: 'bar',
    data: { labels: weeks.map((w) => w.label), datasets: [{ data: weeks.map((w) => round1(w.km)), backgroundColor: t.easy, borderRadius: 3 }] },
    options: {
      ...baseOptions(t),
      scales: {
        x: axis(t, { grid: { display: false } }),
        y: axis(t, { title: { display: true, text: 'km', color: t.muted, font: { size: 10 } } }),
      },
      plugins: { ...baseOptions(t).plugins, tooltip: { ...baseOptions(t).plugins.tooltip, callbacks: { label: (c) => `${c.raw} km` } } },
    },
  });
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

// ── Math / helpers ─────────────────────────────────────────────────────────
function regressionLine(points) {
  if (points.length < 3) return null;
  const n = points.length;
  const xs = points.map((p) => p.x);
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  for (const p of points) { sxx += (p.x - mean) ** 2; sxy += (p.x - mean) * (p.y - my); }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  return [{ x: x0, y: my + slope * (x0 - mean) }, { x: x1, y: my + slope * (x1 - mean) }];
}

function groupByWeek(runs) {
  const map = new Map();
  for (const r of runs) {
    const d = new Date(r.date);
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const key = monday.getTime();
    if (!map.has(key)) map.set(key, { key, label: shortDate(key), km: 0 });
    map.get(key).km += r.distanceKm;
  }
  return [...map.values()].sort((a, b) => a.key - b.key);
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
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const round1 = (n) => Math.round(n * 10) / 10;

function fmt1(n) { return (Math.round(n * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
function fmtPace(sec) {
  if (!sec || !isFinite(sec)) return '—';
  return `${Math.floor(sec / 60)}:${Math.round(sec % 60).toString().padStart(2, '0')}`;
}
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
