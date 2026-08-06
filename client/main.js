// Running telemetry dashboard. Reads one static ./data/activities.json
// (normalised COROS data) and computes every metric client-side.

const state = { all: [], range: '90', charts: {} };

init();

async function init() {
  wireControls();
  try {
    const res = await fetch('./data/activities.json', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.all = (data.activities || []).filter((a) => a.kind === 'run');
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
    render(); // re-theme charts
  });
}

// ── Filtering ────────────────────────────────────────────────────────────
function inRange(activities) {
  if (state.range === 'all') return activities;
  const days = Number(state.range);
  const cutoff = Date.now() - days * 86400 * 1000;
  return activities.filter((a) => new Date(a.date).getTime() >= cutoff);
}

function previousWindow(activities, days) {
  const now = Date.now();
  const start = now - days * 86400 * 1000;
  const prevStart = start - days * 86400 * 1000;
  return activities.filter((a) => {
    const t = new Date(a.date).getTime();
    return t >= prevStart && t < start;
  });
}

// ── Render ───────────────────────────────────────────────────────────────
function render() {
  const runs = inRange(state.all);
  renderTiles(runs);
  renderVolume(runs);
  renderPace(runs);
  renderEfficiency(runs);
  renderDistance(runs);
  renderLog(runs);
}

function renderTiles(runs) {
  const totalKm = sum(runs.map((r) => r.distanceKm));
  const totalSec = sum(runs.map((r) => r.durationSec));
  const quality = runs.filter((r) => r.quality);
  const easy = runs.filter((r) => !r.quality && !r.trail);

  let deltaHtml = '';
  if (state.range !== 'all') {
    const prevKm = sum(previousWindow(state.all, Number(state.range)).map((r) => r.distanceKm));
    if (prevKm > 0) {
      const pct = Math.round(((totalKm - prevKm) / prevKm) * 100);
      const up = pct >= 0;
      deltaHtml = `<span class="tile__delta ${up ? 'tile__delta--up' : 'tile__delta--down'}">${up ? '▲' : '▼'} ${Math.abs(pct)}% vs prev</span>`;
    }
  }

  const tiles = [
    { label: 'Distance', value: fmt1(totalKm), unit: 'km', dot: 'var(--series-easy)', extra: deltaHtml },
    { label: 'Runs', value: String(runs.length), unit: '' },
    { label: 'Time', value: fmtHours(totalSec), unit: '' },
    { label: 'Easy pace', value: fmtPace(weightedPace(easy)), unit: '/km', dot: 'var(--series-easy)' },
    { label: 'Avg HR', value: String(Math.round(weightedHr(runs)) || 0), unit: 'bpm' },
    { label: 'Quality', value: String(quality.length), unit: 'sessions', dot: 'var(--series-quality)' },
  ];

  document.getElementById('tiles').innerHTML = tiles
    .map(
      (t) => `<div class="tile" ${t.dot ? `style="--dot:${t.dot}"` : ''}>
        <span class="tile__label">${t.label}</span>
        <span class="tile__value">${t.value}${t.unit ? `<small>${t.unit}</small>` : ''}</span>
        ${t.extra || ''}
      </div>`
    )
    .join('');
}

// ── Charts ───────────────────────────────────────────────────────────────
function theme() {
  const s = getComputedStyle(document.documentElement);
  const v = (n) => s.getPropertyValue(n).trim();
  return {
    easy: v('--series-easy'),
    quality: v('--series-quality'),
    text: v('--text-2'),
    muted: v('--muted'),
    grid: v('--grid'),
    surface: v('--surface'),
  };
}

function baseOptions(t) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: t.surface,
        titleColor: t.text,
        bodyColor: t.text,
        borderColor: t.grid,
        borderWidth: 1,
        padding: 10,
        cornerRadius: 8,
        titleFont: { family: 'JetBrains Mono' },
        bodyFont: { family: 'JetBrains Mono' },
      },
    },
    font: { family: 'Space Grotesk' },
  };
}

function mount(id, config) {
  if (state.charts[id]) state.charts[id].destroy();
  state.charts[id] = new Chart(document.getElementById(id), config);
}

function renderVolume(runs) {
  const t = theme();
  const weeks = groupByWeek(runs);
  const labels = weeks.map((w) => w.label);
  const axis = { ticks: { color: t.muted, font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: t.grid, drawTicks: false } };

  mount('chart-volume', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Easy', data: weeks.map((w) => round1(w.easyKm)), backgroundColor: t.easy, borderRadius: 3, stack: 'v' },
        { label: 'Quality', data: weeks.map((w) => round1(w.qualityKm)), backgroundColor: t.quality, borderRadius: 3, stack: 'v' },
      ],
    },
    options: {
      ...baseOptions(t),
      scales: {
        x: { ...axis, stacked: true, grid: { display: false } },
        y: { ...axis, stacked: true, border: { display: false }, title: { display: true, text: 'km', color: t.muted, font: { size: 10 } } },
      },
      plugins: { ...baseOptions(t).plugins, tooltip: { ...baseOptions(t).plugins.tooltip, callbacks: { label: (c) => `${c.dataset.label}: ${c.raw} km` } } },
    },
  });

  document.getElementById('volume-legend').innerHTML = legend([
    ['Easy', t.easy],
    ['Quality', t.quality],
  ]);
}

function renderPace(runs) {
  const t = theme();
  const easy = runs.filter((r) => !r.quality && !r.trail && r.distanceKm >= 2)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const points = easy.map((r) => ({ x: new Date(r.date).getTime(), y: r.paceSecPerKm }));
  const axis = { ticks: { color: t.muted, font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: t.grid, drawTicks: false } };

  mount('chart-pace', {
    type: 'line',
    data: { datasets: [{ data: points, borderColor: t.easy, backgroundColor: t.easy, borderWidth: 2, pointRadius: 2.5, pointHoverRadius: 5, tension: 0.3 }] },
    options: {
      ...baseOptions(t),
      parsing: false,
      scales: {
        x: { ...axis, type: 'linear', grid: { display: false }, ticks: { ...axis.ticks, callback: (v) => shortDate(v), maxTicksLimit: 6 } },
        // pace axis reversed so a faster (lower) pace sits higher = improvement up
        y: { ...axis, reverse: true, border: { display: false }, ticks: { ...axis.ticks, callback: (v) => fmtPace(v) } },
      },
      plugins: { ...baseOptions(t).plugins, tooltip: { ...baseOptions(t).plugins.tooltip, callbacks: { title: (c) => shortDate(c[0].parsed.x), label: (c) => `${fmtPace(c.parsed.y)} /km` } } },
    },
  });
}

function renderEfficiency(runs) {
  const t = theme();
  const usable = runs.filter((r) => !r.trail && r.distanceKm >= 2 && r.avgHr > 0);
  const easy = usable.filter((r) => !r.quality).map((r) => ({ x: r.paceSecPerKm, y: r.avgHr }));
  const quality = usable.filter((r) => r.quality).map((r) => ({ x: r.paceSecPerKm, y: r.avgHr }));
  const axis = { ticks: { color: t.muted, font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: t.grid, drawTicks: false } };

  mount('chart-efficiency', {
    type: 'scatter',
    data: {
      datasets: [
        { label: 'Easy', data: easy, backgroundColor: t.easy, pointRadius: 4, pointHoverRadius: 6 },
        { label: 'Quality', data: quality, backgroundColor: t.quality, pointRadius: 4, pointHoverRadius: 6 },
      ],
    },
    options: {
      ...baseOptions(t),
      scales: {
        x: { ...axis, reverse: true, border: { display: false }, title: { display: true, text: 'pace  (faster →)', color: t.muted, font: { size: 10 } }, ticks: { ...axis.ticks, callback: (v) => fmtPace(v) } },
        y: { ...axis, border: { display: false }, title: { display: true, text: 'avg HR', color: t.muted, font: { size: 10 } } },
      },
      plugins: {
        ...baseOptions(t).plugins,
        tooltip: { ...baseOptions(t).plugins.tooltip, callbacks: { label: (c) => `${fmtPace(c.parsed.x)} /km · ${c.parsed.y} bpm` } },
      },
    },
  });
}

function renderDistance(runs) {
  const t = theme();
  const buckets = [
    { label: '<2', min: 0, max: 2 },
    { label: '2–4', min: 2, max: 4 },
    { label: '4–6', min: 4, max: 6 },
    { label: '6–8', min: 6, max: 8 },
    { label: '8–12', min: 8, max: 12 },
    { label: '12+', min: 12, max: Infinity },
  ];
  const counts = buckets.map((b) => runs.filter((r) => r.distanceKm >= b.min && r.distanceKm < b.max).length);
  const axis = { ticks: { color: t.muted, font: { family: 'JetBrains Mono', size: 10 }, precision: 0 }, grid: { color: t.grid, drawTicks: false } };

  mount('chart-distance', {
    type: 'bar',
    data: { labels: buckets.map((b) => b.label), datasets: [{ data: counts, backgroundColor: t.easy, borderRadius: 3 }] },
    options: {
      ...baseOptions(t),
      scales: {
        x: { ...axis, grid: { display: false }, title: { display: true, text: 'km', color: t.muted, font: { size: 10 } } },
        y: { ...axis, border: { display: false }, title: { display: true, text: 'runs', color: t.muted, font: { size: 10 } } },
      },
      plugins: { ...baseOptions(t).plugins, tooltip: { ...baseOptions(t).plugins.tooltip, callbacks: { label: (c) => `${c.raw} run${c.raw === 1 ? '' : 's'}` } } },
    },
  });
}

function renderLog(runs) {
  const rows = runs.slice(0, 25);
  document.getElementById('log-count').textContent = `${runs.length} runs`;
  document.getElementById('log-body').innerHTML = rows
    .map((r) => {
      const tag = r.trail ? 'trail' : r.quality ? 'quality' : 'easy';
      return `<tr>
        <td class="num">${shortDate(new Date(r.date).getTime())}</td>
        <td><div class="log__name">${escapeHtml(r.name)}</div><div class="log__loc">${r.sport}</div></td>
        <td><span class="tag tag--${tag}">${tag}</span></td>
        <td class="num">${fmt1(r.distanceKm)}</td>
        <td class="num">${r.trail ? '—' : fmtPace(r.paceSecPerKm)}</td>
        <td class="num">${r.avgHr || '—'}</td>
        <td class="num">${fmtClock(r.durationSec)}</td>
      </tr>`;
    })
    .join('');
}

// ── Helpers ──────────────────────────────────────────────────────────────
function groupByWeek(runs) {
  const map = new Map();
  for (const r of runs) {
    const d = new Date(r.date);
    const monday = new Date(d);
    const day = (d.getDay() + 6) % 7; // Mon=0
    monday.setDate(d.getDate() - day);
    monday.setHours(0, 0, 0, 0);
    const key = monday.getTime();
    if (!map.has(key)) map.set(key, { key, label: shortDate(key), easyKm: 0, qualityKm: 0 });
    const w = map.get(key);
    if (r.quality) w.qualityKm += r.distanceKm;
    else w.easyKm += r.distanceKm;
  }
  return [...map.values()].sort((a, b) => a.key - b.key);
}

function legend(items) {
  return items
    .map(([name, color]) => `<span class="legend__item"><span class="legend__swatch" style="background:${color}"></span>${name}</span>`)
    .join('');
}

const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const round1 = (n) => Math.round(n * 10) / 10;

function weightedPace(runs) {
  const dist = sum(runs.map((r) => r.distanceKm));
  if (!dist) return 0;
  return sum(runs.map((r) => r.paceSecPerKm * r.distanceKm)) / dist;
}
function weightedHr(runs) {
  const withHr = runs.filter((r) => r.avgHr > 0);
  const time = sum(withHr.map((r) => r.durationSec));
  if (!time) return 0;
  return sum(withHr.map((r) => r.avgHr * r.durationSec)) / time;
}

function fmt1(n) {
  return (Math.round(n * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function fmtPace(sec) {
  if (!sec || !isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
function fmtHours(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtClock(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
function shortDate(ms) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(ms));
}
function setSynced(iso) {
  if (!iso) return;
  const d = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(iso));
  document.getElementById('synced').textContent = `Running telemetry · synced ${d}`;
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
