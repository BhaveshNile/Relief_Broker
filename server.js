// server.js
//
// Plays the role of API Gateway in front of the Lambda handlers. Every
// route below maps 1:1 to a resource you'd define in API Gateway (see
// docs/serverless.yml for the actual AWS resource definitions). Business
// logic never lives in this file - it only validates the transport layer
// and calls into lambda/*.js, exactly like API Gateway just invokes a
// Lambda and returns whatever it responds with.

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');

const { intake } = require('./lambda/requestIntake');
const { REGIONS } = require('./lambda/geoRouter');
const { cdnCache, cdnStats } = require('./lambda/cdnCache');
const { PriorityQueue } = require('./queue/priorityQueue');
const { DynamoStore } = require('./db/dynamoStore');
const { AutoScaler } = require('./scaler/autoScaler');

const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const queue = new PriorityQueue();
const store = new DynamoStore();

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(event) {
  const payload = JSON.stringify(event);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(payload);
  });
}

const autoScaler = new AutoScaler({
  queue,
  store,
  onEvent: (event) => broadcast({ channel: 'scaler', ...event }),
});

// --- API Gateway resource: POST /api/requests --------------------------
// Invokes the intake Lambda. This is the endpoint under load during a
// disaster - it must stay fast even when thousands of these land per
// minute, which is why it only validates + enqueues and never blocks on
// the actual dispatch work.
app.post('/api/requests', (req, res) => {
  const result = intake(req.body || {});
  if (!result.ok) {
    return res.status(400).json({ error: 'VALIDATION_FAILED', details: result.errors });
  }

  store.put(result.record);
  queue.enqueue(result.record);

  broadcast({
    channel: 'requests',
    type: 'REQUEST_RECEIVED',
    requestId: result.record.requestId,
    priority: result.record.priority,
    requestType: result.record.requestType,
    region: result.record.region,
  });

  res.status(202).json({
    requestId: result.record.requestId,
    status: 'PENDING',
    priority: result.record.priority,
    routedRegion: result.record.regionName,
  });
});

// --- API Gateway resource: GET /api/requests/{id} -----------------------
app.get('/api/requests/:id', (req, res) => {
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json(record);
});

// --- API Gateway resource: GET /api/requests -----------------------------
app.get('/api/requests', (req, res) => {
  const status = req.query.status;
  const records = status ? store.queryByStatus(status, 200) : store.all(200);
  res.json(records);
});

// --- Edge-cached, read-only resources (served via simulated CDN) ---------
app.get('/api/regions', cdnCache(10000), (req, res) => {
  res.json(REGIONS);
});

// --- Ops dashboard metrics feed -------------------------------------------
app.get('/api/metrics', (req, res) => {
  res.json({
    timestamp: Date.now(),
    queue: queue.stats(),
    scaler: autoScaler.snapshot(),
    cdn: cdnStats(),
    totalRecords: store.count(),
  });
});

// Poll-based fallback + initial snapshot for the dashboard's WebSocket client
wss.on('connection', (ws) => {
  ws.send(
    JSON.stringify({
      channel: 'snapshot',
      queue: queue.stats(),
      scaler: autoScaler.snapshot(),
      cdn: cdnStats(),
    })
  );
});

// Push a metrics tick every second so the dashboard graphs move even when
// no individual request/scale event just fired.
setInterval(() => {
  broadcast({
    channel: 'metrics',
    timestamp: Date.now(),
    queue: queue.stats(),
    scaler: autoScaler.snapshot(),
    cdn: cdnStats(),
  });
}, 1000);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

server.listen(PORT, () => {
  console.log(`Relief Broker API Gateway simulation listening on http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}`);
});
