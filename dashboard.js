const MAX_POINTS = 40;

const scalingChart = new Chart(document.getElementById('scalingChart'), {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      {
        label: 'Queue depth',
        data: [],
        borderColor: '#fbbf24',
        backgroundColor: 'rgba(251,191,36,0.08)',
        tension: 0.25,
        yAxisID: 'y',
      },
      {
        label: 'Active workers',
        data: [],
        borderColor: '#4fd1c5',
        backgroundColor: 'rgba(79,209,197,0.08)',
        tension: 0.25,
        yAxisID: 'y1',
      },
    ],
  },
  options: {
    animation: false,
    responsive: true,
    interaction: { mode: 'index', intersect: false },
    scales: {
      y: { position: 'left', ticks: { color: '#8b96a5' }, grid: { color: '#1f2937' } },
      y1: { position: 'right', ticks: { color: '#8b96a5' }, grid: { display: false } },
      x: { ticks: { color: '#8b96a5', maxTicksLimit: 8 }, grid: { color: '#1f2937' } },
    },
    plugins: { legend: { labels: { color: '#e5e9f0' } } },
  },
});

const priorityChart = new Chart(document.getElementById('priorityChart'), {
  type: 'doughnut',
  data: {
    labels: ['Critical', 'Standard'],
    datasets: [{ data: [0, 0], backgroundColor: ['#ff5c5c', '#4fd1c5'] }],
  },
  options: {
    responsive: true,
    plugins: { legend: { position: 'bottom', labels: { color: '#e5e9f0' } } },
  },
});

let criticalCount = 0;
let standardCount = 0;

function addFeedItem(listId, html, className) {
  const list = document.getElementById(listId);
  const li = document.createElement('li');
  li.innerHTML = html;
  list.prepend(li);
  while (list.children.length > 25) list.removeChild(list.lastChild);
}

function updateStatCards({ queue, scaler, cdn }) {
  document.getElementById('statQueueDepth').textContent = queue.depth;
  document.getElementById('statQueueLanes').textContent =
    `critical ${queue.criticalDepth} · standard ${queue.standardDepth}`;

  document.getElementById('statWorkers').textContent = scaler.activeWorkers;
  document.getElementById('statWorkerRange').textContent =
    `min ${scaler.minWorkers} · max ${scaler.maxWorkers}`;

  document.getElementById('statProcessed').textContent = scaler.totalProcessed;
  document.getElementById('statFailed').textContent = `${scaler.totalFailed} failed`;

  document.getElementById('statLatency').textContent = `${scaler.avgProcessingTimeMs} ms`;
  document.getElementById('statScaleEvents').textContent =
    `${scaler.scaleOutEvents} scale-out · ${scaler.scaleInEvents} scale-in`;

  document.getElementById('statCdnRatio').textContent = `${Math.round(cdn.hitRatio * 100)}%`;
  document.getElementById('statCdnCounts').textContent = `${cdn.hits} hits · ${cdn.misses} misses`;
}

function pushChartPoint(queueDepth, activeWorkers) {
  const label = new Date().toLocaleTimeString();
  scalingChart.data.labels.push(label);
  scalingChart.data.datasets[0].data.push(queueDepth);
  scalingChart.data.datasets[1].data.push(activeWorkers);

  if (scalingChart.data.labels.length > MAX_POINTS) {
    scalingChart.data.labels.shift();
    scalingChart.data.datasets.forEach((d) => d.data.shift());
  }
  scalingChart.update('none');
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  const statusEl = document.getElementById('connStatus');

  ws.onopen = () => {
    statusEl.textContent = 'live';
    statusEl.classList.add('live');
  };

  ws.onclose = () => {
    statusEl.textContent = 'reconnecting…';
    statusEl.classList.remove('live');
    setTimeout(connect, 1500);
  };

  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);

    if (msg.channel === 'metrics' || msg.channel === 'snapshot') {
      updateStatCards(msg);
      pushChartPoint(msg.queue.depth, msg.scaler.activeWorkers);
    }

    if (msg.channel === 'requests' && msg.type === 'REQUEST_RECEIVED') {
      if (msg.priority === 'CRITICAL') criticalCount += 1;
      else standardCount += 1;
      priorityChart.data.datasets[0].data = [criticalCount, standardCount];
      priorityChart.update('none');

      addFeedItem(
        'requestFeed',
        `<span class="tag ${msg.priority.toLowerCase()}">${msg.priority}</span>
         <span>${msg.requestType} · ${msg.region}</span>`
      );
    }

    if (msg.channel === 'scaler' && (msg.type === 'SCALE_OUT' || msg.type === 'SCALE_IN')) {
      const cls = msg.type === 'SCALE_OUT' ? 'scaleout' : 'scalein';
      addFeedItem(
        'scaleFeed',
        `<span class="tag ${cls}">${msg.type}</span>
         <span>${msg.from} → ${msg.to} workers</span>`
      );
    }
  };
}

async function loadRegions() {
  try {
    const res = await fetch('/api/regions');
    const regions = await res.json();
    document.getElementById('regionList').textContent = regions.map((r) => r.name).join(' · ');
  } catch (err) {
    document.getElementById('regionList').textContent = 'unavailable';
  }
}

connect();
loadRegions();
