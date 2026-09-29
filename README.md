# Auto-Scaling Serverless Emergency Relief Request Broker

A request-intake and dispatch system for disaster and civic-emergency relief
requests, built to stay available and responsive even when request volume
spikes 20-30x within seconds — the exact failure mode that takes down
conventional relief dispatch systems during a real disaster.

This repo contains a **fully working local simulation** of the target
serverless architecture. Every module maps directly onto a specific AWS (or
GCP) managed service — see `docs/ARCHITECTURE.md` for the mapping and
`docs/serverless.yml` for the actual Infrastructure-as-Code you'd deploy if
you took this to real AWS. Running it locally means you can demo the whole
system — including live auto-scaling — on a laptop with no cloud account
and no cost, which is what makes it workable as a final year project.

## Why local simulation instead of a real AWS deployment

Three practical reasons this project ships as a working local simulation
rather than a live AWS deployment:

1. **No dependency on a personal AWS account during evaluation.** Examiners
   / juries often ask to run the project on the spot — an AWS-hosted demo
   depends on credentials, region availability, and cost controls staying
   intact between submission and viva.
2. **The auto-scaling behaviour is the thing being demonstrated.** Running
   it locally with `worker_threads` as the "Lambda execution environments"
   reproduces the *same* scaling decisions (target-tracking on queue depth,
   cooldowns, min/max capacity) without hiding them behind an AWS console
   you'd have to screen-share.
3. **It is a straight lift to real AWS.** Because the code is already split
   into the same boundaries API Gateway/Lambda/SQS/DynamoDB impose, the
   `docs/serverless.yml` in this repo is a real, deployable Serverless
   Framework config for the same logic — see `docs/ARCHITECTURE.md` for
   exactly what would change.

## Running it

```bash
npm install
npm start
```

Then open **http://localhost:4000** — that's the live ops dashboard.

### Demo traffic

In a second terminal, generate load against the running server:

```bash
# steady baseline traffic
npm run loadtest:normal

# a full disaster scenario: baseline -> sudden 80 req/sec spike -> taper
npm run loadtest:disaster
```

Watch the dashboard: queue depth climbs, the auto-scaler adds worker
capacity (visible in the "Scaling events" feed and the chart), throughput
recovers, then capacity is released once the queue drains.

### Submitting a request manually

```bash
curl -X POST http://localhost:4000/api/requests \
  -H "Content-Type: application/json" \
  -d '{
    "requestType": "MEDICAL",
    "description": "Person trapped under debris, needs urgent medical aid",
    "lat": 19.07,
    "lon": 72.87,
    "reporterContact": "+91-9000012345"
  }'
```

`requestType` is one of `MEDICAL`, `RESCUE`, `SHELTER`, `FOOD_WATER`,
`INFRASTRUCTURE`, `OTHER`. `MEDICAL` and `RESCUE` are always routed to the
critical priority lane; anything else can be escalated by setting
`"emergency": true` in the body.

## Project layout

```
server.js                 API Gateway simulation (Express) + WebSocket push
lambda/
  requestIntake.js         Intake Lambda: validation, priority classification
  geoRouter.js              CloudFront/Route53 nearest-region routing
  cdnCache.js                Edge cache simulation for read-heavy routes
queue/
  priorityQueue.js          Two-lane SQS simulation (critical / standard)
scaler/
  autoScaler.js              Target-tracking auto-scaler over worker_threads
workers/
  requestProcessor.js        One worker = one warm Lambda execution env
db/
  dynamoStore.js              DynamoDB table simulation (in-memory + snapshot)
loadgen/
  simulateTraffic.js          Demo load generator (normal / disaster modes)
public/                     Ops dashboard (vanilla JS + Chart.js)
docs/
  ARCHITECTURE.md            Local module -> real AWS/GCP service mapping
  serverless.yml              Deployable AWS SAM/Serverless Framework config
  PRESENTATION_GUIDE.md       Notes for explaining the project in a viva
```

## What actually demonstrates "auto-scaling" here

`scaler/autoScaler.js` runs a target-tracking loop every second: it looks
at current queue depth, computes desired worker count
(`ceil(queueDepth / targetPerWorker)`), and scales the `worker_threads`
pool up or down within `MIN_WORKERS`/`MAX_WORKERS`, with separate cooldowns
for scale-out (fast, 1.5s) and scale-in (conservative, 8s) — the same
asymmetry AWS Application Auto Scaling recommends, so a burst gets capacity
immediately but a brief lull doesn't cause thrashing.

## Requirements

- Node.js 18+
- No external services, database, or AWS account needed to run the demo
