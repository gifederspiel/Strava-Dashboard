import { API_BASE_URL, LATEST_ACTIVITY_COUNT } from './config.js';

const RUNS_ENDPOINT = '/api/strava/runs/latest';
const WORKOUTS_ENDPOINT = '/api/strava/workouts/latest';
const SUMMARY_ENDPOINT = '/api/strava/runs/summary';
const RANGE_LABELS = {
  week: 'This Week',
  month: 'This Month',
};

const statusEl = document.getElementById('status');
const summaryStatusEl = document.getElementById('summary-status');
const summaryCardsEl = document.getElementById('summary-cards');
const activitiesEl = document.getElementById('activities');
const apiTargetEl = document.getElementById('api-target');
const toggleButtons = Array.from(document.querySelectorAll('#range-toggle [data-range]'));

let currentRange = 'week';

init();

function init() {
  apiTargetEl.textContent = API_BASE_URL;
  apiTargetEl.title = 'Click to change the API base URL';
  apiTargetEl.addEventListener('click', handleApiTargetChange);

  toggleButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const { range } = button.dataset;
      if (!range || range === currentRange) return;
      currentRange = range;
      updateRangeButtons();
      loadSummary();
    });
  });

  updateRangeButtons();
  loadSummary();
  loadActivities();
}

function handleApiTargetChange() {
  const next = prompt('Set Strava API base URL', API_BASE_URL);
  if (next && next.trim().length > 0) {
    localStorage.setItem('STRAVA_API_BASE_URL', next.trim());
    window.location.reload();
  }
}

function updateRangeButtons() {
  toggleButtons.forEach((button) => {
    button.classList.toggle('toggle-button--active', button.dataset.range === currentRange);
  });
}

async function loadSummary() {
  setSummaryStatus('Loading overview…');

  try {
    const url = new URL(SUMMARY_ENDPOINT, API_BASE_URL);
    url.searchParams.set('range', currentRange);

    const data = await fetchFromApi(url);
    renderSummary(data);
    setSummaryStatus(formatSummaryStatus(data), 'success');
  } catch (error) {
    console.error('Failed to load run summary', error);
    summaryCardsEl.innerHTML = '';
    setSummaryStatus(`Failed to load overview: ${error.message}`, 'error');
  }
}

async function loadActivities() {
  setStatus('Fetching recent sessions…');

  try {
    const runsUrl = new URL(RUNS_ENDPOINT, API_BASE_URL);
    runsUrl.searchParams.set('count', LATEST_ACTIVITY_COUNT);

    const workoutsUrl = new URL(WORKOUTS_ENDPOINT, API_BASE_URL);
    workoutsUrl.searchParams.set('count', Math.max(Math.ceil(LATEST_ACTIVITY_COUNT / 2), 3));

    const [runsData, workoutsData] = await Promise.all([fetchFromApi(runsUrl), fetchFromApi(workoutsUrl)]);

    const { sessions, runCount, workoutCount } = prepareSessions(
      Array.isArray(runsData) ? runsData : [],
      Array.isArray(workoutsData) ? workoutsData : []
    );

    renderActivities(sessions);

    if (!sessions.length) {
      setStatus('No recent sessions returned. Check Strava permissions or try refreshing.', 'error');
      return;
    }

    setStatus(
      `Showing ${sessions.length} sessions (${runCount} run${runCount === 1 ? '' : 's'} · ${workoutCount} workout${workoutCount === 1 ? '' : 's'})`,
      'success'
    );
  } catch (error) {
    console.error('Failed to load sessions', error);
    setStatus(`Failed to load activities: ${error.message}`, 'error');
  }
}

async function fetchFromApi(urlOrString) {
  const url = urlOrString instanceof URL ? urlOrString : new URL(urlOrString, API_BASE_URL);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function renderSummary(data) {
  summaryCardsEl.innerHTML = '';

  if (!data || data.runCount === 0) {
    const card = createSummaryCard(
      RANGE_LABELS[currentRange] || 'Overview',
      '0 km',
      'No runs recorded in this period.'
    );
    summaryCardsEl.appendChild(card);
    return;
  }

  const totals = data.totals || {};
  const averages = data.averages || {};

  const cards = [
    createSummaryCard(
      'Total Distance',
      formatKilometers(totals.distanceMeters),
      `${data.runCount} run${data.runCount === 1 ? '' : 's'}`
    ),
    createSummaryCard(
      'Moving Time',
      formatDuration(totals.movingTimeSeconds),
      'All runs in range'
    ),
    createSummaryCard(
      'Average Pace',
      formatPaceFromSeconds(averages.paceSecondsPerKm),
      'Weighted by distance'
    ),
    createSummaryCard(
      'Elevation Gain',
      formatElevation(totals.elevationGainMeters),
      'Total ascent'
    ),
    createSummaryCard(
      'Avg Heart Rate',
      formatHeartRate(averages.heartRateBpm),
      'Weighted by moving time'
    ),
  ];

  cards.forEach((card) => summaryCardsEl.appendChild(card));

  if (data.longestRun) {
    summaryCardsEl.appendChild(createLongestRunCard(data.longestRun));
  }
}

function renderActivities(entries) {
  activitiesEl.innerHTML = '';

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'status status--error';
    empty.textContent = 'No recent sessions returned. Check Strava permissions or try refreshing.';
    activitiesEl.appendChild(empty);
    return;
  }

  entries.forEach((entry) => {
    const activity = entry?.activity;
    if (!activity) {
      return;
    }

    if (entry.kind === 'workout') {
      const workoutCard = buildWorkoutCard(activity);
      if (workoutCard) {
        activitiesEl.appendChild(workoutCard);
      }
      return;
    }

    const runCard = buildRunCard(activity, entry.streams || {});
    if (runCard) {
      activitiesEl.appendChild(runCard);
    }
  });
}

function prepareSessions(runEntries, workoutEntries) {
  const runSessions = runEntries
    .map((entry) => {
      const activity = entry?.activity;
      if (!activity) {
        return null;
      }

      return {
        kind: 'run',
        activity,
        streams: entry?.streams || {},
      };
    })
    .filter(Boolean);

  const workoutSessions = workoutEntries
    .map((activity) => {
      if (!activity) {
        return null;
      }
      return {
        kind: 'workout',
        activity,
      };
    })
    .filter(Boolean);

  const sessions = [...runSessions, ...workoutSessions].sort(
    (a, b) => getActivityTimestamp(b.activity) - getActivityTimestamp(a.activity)
  );

  return {
    sessions,
    runCount: runSessions.length,
    workoutCount: workoutSessions.length,
  };
}

function buildRunCard(activity, streams) {
  const {
    id,
    name,
    sport_type: sportType,
    type,
    start_date: startDate,
    distance,
    moving_time: movingTime,
    total_elevation_gain: elevationGain,
    average_speed: averageSpeed,
    average_heartrate: averageHeartRate,
    description,
    has_heartrate: hasHeartRate,
  } = activity;

  const card = document.createElement('article');
  card.className = 'activity-card activity-card--run';
  card.dataset.activityId = id;

  const header = document.createElement('div');
  header.className = 'activity-card__header';

  const titleBlock = document.createElement('div');
  titleBlock.className = 'activity-card__title-block';

  const heading = document.createElement('h2');
  heading.textContent = name || 'Untitled Run';
  titleBlock.appendChild(heading);

  const dateEl = document.createElement('p');
  dateEl.className = 'activity-card__date';
  dateEl.textContent = formatDateFriendly(startDate);
  titleBlock.appendChild(dateEl);

  header.appendChild(titleBlock);

  const sportEl = document.createElement('span');
  sportEl.className = 'activity-card__sport';
  sportEl.textContent = sportType || type || 'Run';
  header.appendChild(sportEl);

  card.appendChild(header);

  const summary = createActivitySummary([
    { label: 'Distance', value: formatDistance(distance) },
    { label: 'Duration', value: formatDuration(movingTime) },
    { label: 'Pace', value: formatPace(averageSpeed) },
    { label: 'Avg HR', value: formatHeartRate(averageHeartRate) },
    { label: 'Elevation', value: formatElevation(elevationGain) },
  ]);
  card.appendChild(summary);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'activity-card__toggle';
  toggle.textContent = 'Show details';
  toggle.setAttribute('aria-expanded', 'false');
  card.appendChild(toggle);

  const details = document.createElement('div');
  details.className = 'activity-card__details';
  details.hidden = true;

  if (description) {
    const notes = document.createElement('p');
    notes.className = 'activity-notes';
    notes.innerHTML = linkify(escapeHtml(description));
    details.appendChild(notes);
  }

  const visuals = document.createElement('div');
  visuals.className = 'activity-visuals';

  const latLngStream = streams?.latlng?.data || [];
  visuals.appendChild(createRouteBlock(latLngStream));

  const heartRateStream = streams?.heartrate?.data || [];
  const timeStream = streams?.time?.data || [];
  visuals.appendChild(createHeartRateBlock(heartRateStream, timeStream, hasHeartRate));

  details.appendChild(visuals);
  card.appendChild(details);

  toggle.addEventListener('click', () => {
    const expanded = !card.classList.contains('activity-card--expanded');
    card.classList.toggle('activity-card--expanded', expanded);
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    toggle.textContent = expanded ? 'Hide details' : 'Show details';
    details.hidden = !expanded;
  });

  const footer = document.createElement('div');
  footer.className = 'activity-footer';

  const link = document.createElement('a');
  link.href = `https://www.strava.com/activities/${id}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = 'activity-link';
  link.textContent = 'View on Strava';
  footer.appendChild(link);

  card.appendChild(footer);

  return card;
}

function buildWorkoutCard(activity) {
  const {
    id,
    name,
    start_date: startDate,
    moving_time: movingTime,
    average_heartrate: averageHeartRate,
    calories,
    suffer_score: relativeEffort,
    description,
  } = activity;

  const card = document.createElement('article');
  card.className = 'activity-card activity-card--workout';
  card.dataset.activityId = id;

  const header = document.createElement('div');
  header.className = 'activity-card__header';

  const titleBlock = document.createElement('div');
  titleBlock.className = 'activity-card__title-block';

  const heading = document.createElement('h2');
  heading.textContent = name || 'Workout Session';
  titleBlock.appendChild(heading);

  const dateEl = document.createElement('p');
  dateEl.className = 'activity-card__date';
  dateEl.textContent = formatDateFriendly(startDate);
  titleBlock.appendChild(dateEl);

  header.appendChild(titleBlock);

  const sportEl = document.createElement('span');
  sportEl.className = 'activity-card__sport activity-card__sport--workout';
  sportEl.textContent = 'Workout';
  header.appendChild(sportEl);

  card.appendChild(header);

  const summary = createActivitySummary([
    { label: 'Duration', value: formatDuration(movingTime) },
    { label: 'Avg HR', value: formatHeartRate(averageHeartRate) },
    { label: 'Calories', value: formatCalories(calories) },
    { label: 'Rel. Effort', value: formatRelativeEffort(relativeEffort) },
  ]);
  card.appendChild(summary);

  if (description) {
    const notes = document.createElement('p');
    notes.className = 'activity-notes';
    notes.innerHTML = linkify(escapeHtml(description));
    card.appendChild(notes);
  }

  const footer = document.createElement('div');
  footer.className = 'activity-footer';

  if (id) {
    const link = document.createElement('a');
    link.href = `https://www.strava.com/activities/${id}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'activity-link';
    link.textContent = 'View on Strava';
    footer.appendChild(link);
  }

  card.appendChild(footer);

  return card;
}

function createActivitySummary(items) {
  const container = document.createElement('div');
  container.className = 'activity-summary';

  items.forEach(({ label, value }) => {
    const item = document.createElement('div');
    item.className = 'activity-summary__item';

    const itemLabel = document.createElement('span');
    itemLabel.className = 'activity-summary__label';
    itemLabel.textContent = label;

    const itemValue = document.createElement('span');
    itemValue.className = 'activity-summary__value';
    itemValue.textContent = value;

    item.appendChild(itemLabel);
    item.appendChild(itemValue);
    container.appendChild(item);
  });

  return container;
}

function createRouteBlock(latLngStream) {
  const block = document.createElement('section');
  block.className = 'visual-block';

  const title = document.createElement('h3');
  title.textContent = 'Route';
  block.appendChild(title);

  const body = document.createElement('div');
  body.className = 'visual-block__body';

  if (Array.isArray(latLngStream) && latLngStream.length >= 2) {
    const { canvas, ctx, width, height } = createHiDPICanvas(360, 220);
    canvas.className = 'route-canvas';
    drawRoute(ctx, latLngStream, width, height);
    body.appendChild(canvas);
  } else {
    body.appendChild(createEmptyVisual('No GPS track available for this run.'));
  }

  block.appendChild(body);
  return block;
}

function createHeartRateBlock(heartRateStream, timeStream, hasHeartRate) {
  const block = document.createElement('section');
  block.className = 'visual-block';

  const title = document.createElement('h3');
  title.textContent = 'Heart Rate';
  block.appendChild(title);

  const body = document.createElement('div');
  body.className = 'visual-block__body';

  if (Array.isArray(heartRateStream) && heartRateStream.length >= 2) {
    const { canvas, ctx, width, height } = createHiDPICanvas(360, 220);
    canvas.className = 'heart-rate-canvas';
    drawHeartRate(ctx, heartRateStream, timeStream, width, height);
    body.appendChild(canvas);

    const summary = summariseHeartRate(heartRateStream);
    if (summary) {
      const summaryEl = document.createElement('p');
      summaryEl.className = 'heart-rate-summary';
      summaryEl.textContent = `Avg ${summary.avg} bpm · Min ${summary.min} · Max ${summary.max}`;
      body.appendChild(summaryEl);
    }
  } else {
    const message = hasHeartRate
      ? 'Heart rate stream unavailable for this activity.'
      : 'No heart rate recorded.';
    body.appendChild(createEmptyVisual(message));
  }

  block.appendChild(body);
  return block;
}

function createEmptyVisual(message) {
  const el = document.createElement('div');
  el.className = 'visual-empty';
  el.textContent = message;
  return el;
}

function createSummaryCard(title, value, caption) {
  const card = document.createElement('div');
  card.className = 'summary-card';

  const heading = document.createElement('h3');
  heading.textContent = title;
  card.appendChild(heading);

  const valueEl = document.createElement('div');
  valueEl.className = 'summary-card__value';
  valueEl.textContent = value;
  card.appendChild(valueEl);

  if (caption) {
    const captionEl = document.createElement('p');
    captionEl.className = 'summary-card__caption';
    captionEl.textContent = caption;
    card.appendChild(captionEl);
  }

  return card;
}

function createLongestRunCard(run) {
  const card = document.createElement('div');
  card.className = 'summary-card summary-card--highlight';

  const heading = document.createElement('h3');
  heading.textContent = 'Longest Run';
  card.appendChild(heading);

  const valueEl = document.createElement('div');
  valueEl.className = 'summary-card__value';
  valueEl.textContent = formatDistance(run.distanceMeters);
  card.appendChild(valueEl);

  const caption = document.createElement('p');
  caption.className = 'summary-card__caption';
  caption.textContent = `${formatDateShort(run.startDate)} · ${formatDuration(
    run.movingTimeSeconds
  )}`;
  card.appendChild(caption);

  const link = document.createElement('a');
  link.href = `https://www.strava.com/activities/${run.id}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = 'activity-link';
  link.textContent = run.name || 'View on Strava';
  card.appendChild(link);

  return card;
}

function createHiDPICanvas(width, height) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  return { canvas, ctx, width, height };
}

function drawRoute(ctx, latLngStream, width, height) {
  const padding = 18;
  const coords = latLngStream.map(([lat, lon]) => ({ lat, lon }));

  const lats = coords.map((p) => p.lat);
  const lons = coords.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  const meanLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const lonFactor = Math.cos(meanLatRad) || 1;

  const projected = coords.map(({ lat, lon }) => ({
    x: (lon - minLon) * lonFactor,
    y: lat - minLat,
  }));

  const xs = projected.map((p) => p.x);
  const ys = projected.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const rangeX = Math.max(maxX - minX, 1e-6);
  const rangeY = Math.max(maxY - minY, 1e-6);
  const scale = Math.min(
    (width - padding * 2) / rangeX,
    (height - padding * 2) / rangeY
  );

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, height);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#f97316';

  ctx.beginPath();
  projected.forEach((point, index) => {
    const x = padding + (point.x - minX) * scale;
    const y = height - padding - (point.y - minY) * scale;

    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();

  const startPoint = projected[0];
  const endPoint = projected[projected.length - 1];
  const startX = padding + (startPoint.x - minX) * scale;
  const startY = height - padding - (startPoint.y - minY) * scale;
  const endX = padding + (endPoint.x - minX) * scale;
  const endY = height - padding - (endPoint.y - minY) * scale;

  ctx.fillStyle = '#22c55e';
  ctx.beginPath();
  ctx.arc(startX, startY, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(endX, endY, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawHeartRate(ctx, heartRateStream, timeStream, width, height) {
  const padding = 22;
  const times =
    Array.isArray(timeStream) && timeStream.length === heartRateStream.length
      ? timeStream
      : heartRateStream.map((_, index) => index);

  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minHR = Math.min(...heartRateStream);
  const maxHR = Math.max(...heartRateStream);

  const timeRange = Math.max(maxTime - minTime, 1);
  const hrRange = Math.max(maxHR - minHR, 1);
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, height - padding);
  ctx.lineTo(width - padding, height - padding);
  ctx.stroke();

  const gradient = ctx.createLinearGradient(0, padding, 0, height - padding);
  gradient.addColorStop(0, 'rgba(248, 113, 113, 0.35)');
  gradient.addColorStop(1, 'rgba(248, 113, 113, 0)');

  ctx.beginPath();
  let lastX = padding;

  heartRateStream.forEach((hr, index) => {
    const t = times[index];
    const x = padding + ((t - minTime) / timeRange) * chartWidth;
    const y = height - padding - ((hr - minHR) / hrRange) * chartHeight;

    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }

    lastX = x;
  });

  ctx.lineWidth = 2;
  ctx.strokeStyle = '#f97316';
  ctx.stroke();

  ctx.lineTo(lastX, height - padding);
  ctx.lineTo(padding, height - padding);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.fillStyle = '#475569';
  ctx.font = '12px "Inter", "Segoe UI", sans-serif';
  ctx.fillText(`${Math.round(maxHR)} bpm`, padding + 6, padding + 12);
  ctx.fillText(`${Math.round(minHR)} bpm`, padding + 6, height - padding - 6);
}

function summariseHeartRate(data) {
  if (!Array.isArray(data) || !data.length) {
    return null;
  }

  const total = data.reduce((sum, value) => sum + value, 0);
  const min = Math.min(...data);
  const max = Math.max(...data);
  const avg = Math.round(total / data.length);

  return {
    min: Math.round(min),
    max: Math.round(max),
    avg,
  };
}

function setStatus(message, tone) {
  statusEl.textContent = message;
  statusEl.classList.toggle('status--error', tone === 'error');
  statusEl.classList.toggle('status--success', tone === 'success');
}

function setSummaryStatus(message, tone) {
  summaryStatusEl.textContent = message;
  summaryStatusEl.classList.toggle('status--error', tone === 'error');
  summaryStatusEl.classList.toggle('status--success', tone === 'success');
}

function formatSummaryStatus(data) {
  if (!data) {
    return '';
  }

  const label = RANGE_LABELS[data.range] || 'Range';
  const rangeText = `${formatDateShort(data.from)} – ${formatDateShort(data.to)}`;
  return `${label} • ${rangeText}`;
}

function getActivityTimestamp(activity) {
  if (!activity) {
    return 0;
  }

  const value = activity.start_date || activity.start_date_local;
  if (!value) {
    return 0;
  }

  const date = new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

function formatKilometers(meters) {
  if (!Number.isFinite(meters)) return '0 km';
  const kilometers = meters / 1000;
  return `${kilometers.toFixed(kilometers >= 100 ? 0 : 1)} km`;
}

function formatHeartRate(bpm) {
  if (!Number.isFinite(bpm) || bpm <= 0) {
    return '—';
  }
  return `${Math.round(bpm)} bpm`;
}

function formatCalories(calories) {
  if (!Number.isFinite(calories) || calories <= 0) {
    return '—';
  }
  return `${Math.round(calories)} kcal`;
}

function formatRelativeEffort(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return '—';
  }
  return `${Math.round(value)}`;
}

function formatDateFriendly(value) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
  const datePart = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
  const timePart = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: 'numeric',
  }).format(date);
  return `${weekday}, ${datePart} • ${timePart}`;
}

function formatDateShort(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '-';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts = [
    hrs > 0 ? `${hrs}h` : null,
    mins > 0 ? `${mins}m` : null,
    secs > 0 ? `${secs}s` : null,
  ].filter(Boolean);
  return parts.join(' ') || '0s';
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '-';
  const kilometers = meters / 1000;
  return `${kilometers.toFixed(kilometers >= 10 ? 0 : 1)} km`;
}

function formatElevation(meters) {
  if (!Number.isFinite(meters)) return '-';
  return `${meters.toFixed(0)} m`;
}

function formatPace(speedMetersPerSecond) {
  if (!Number.isFinite(speedMetersPerSecond) || speedMetersPerSecond <= 0) {
    return '-';
  }
  const paceSeconds = 1000 / speedMetersPerSecond;
  return formatPaceFromSeconds(paceSeconds);
}

function formatPaceFromSeconds(paceSeconds) {
  if (!Number.isFinite(paceSeconds) || paceSeconds <= 0) {
    return '—';
  }
  const mins = Math.floor(paceSeconds / 60);
  const secs = Math.round(paceSeconds % 60)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs} /km`;
}

function escapeHtml(input) {
  const str = String(input ?? '');
  return str.replace(/[&<>"']/g, (ch) => {
    const escapeMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return escapeMap[ch] || ch;
  });
}

function linkify(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.replace(
    urlRegex,
    (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
}
