# Architecture

## Target cloud architecture (what this project models)

```
                     ┌─────────────────┐
        requests     │   CloudFront      │  edge caching for read-only
      ───────────►   │   (global CDN)    │  routes; absorbs read traffic
                      └────────┬─────────┘  during a spike before it ever
                               │             reaches the API
                      ┌────────▼─────────┐
                      │   API Gateway     │  request validation, throttling,
                      │  (REST/HTTP API)  │  routes to the intake Lambda
                      └────────┬─────────┘
                               │
                      ┌────────▼─────────┐
                      │  Intake Lambda    │  validate → classify priority →
                      │  (requestIntake)  │  geo-route → write ledger row
                      └───┬────────────┬─┘
                          │            │
              ┌───────────▼──┐   ┌─────▼────────────┐
              │ SQS: critical │   │ SQS: standard     │  decouples intake
              │   .fifo queue │   │   queue            │  from processing so
              └───────┬───────┘   └─────────┬──────────┘  a burst never
                      │                     │             blocks the API
              ┌───────▼─────────────────────▼──────────┐
              │     Lambda concurrency pool              │  scales out on
              │  (dispatch / processing function)        │  queue depth via
              └───────────────────┬───────────────────┘  Application Auto
                                  │                        Scaling target
                        ┌─────────▼─────────┐              tracking
                        │    DynamoDB        │  request ledger, status,
                        │  (RequestLedger)   │  GSI on status for ops queries
                        └────────────────────┘
```

## Local simulation -> real service mapping

| Local module | Simulates | Real AWS service | Real GCP equivalent |
|---|---|---|---|
| `server.js` (Express routes) | API Gateway | API Gateway (REST/HTTP API) | Cloud Endpoints / API Gateway |
| `lambda/requestIntake.js` | Intake Lambda | AWS Lambda | Cloud Function / Cloud Run |
| `lambda/geoRouter.js` | CloudFront + Route 53 latency routing | CloudFront + Route 53 | Cloud CDN + Cloud Load Balancing |
| `lambda/cdnCache.js` | Edge caching of read-only responses | CloudFront cache behavior | Cloud CDN cache |
| `queue/priorityQueue.js` | Two SQS queues (critical/standard) | Amazon SQS (2 queues) | Cloud Pub/Sub (2 topics) |
| `scaler/autoScaler.js` | Application Auto Scaling target-tracking policy | Application Auto Scaling on Lambda reserved concurrency, or an ECS/EC2 Auto Scaling Group | Cloud Run concurrency-based autoscaling |
| `workers/requestProcessor.js` (one `worker_thread`) | One warm Lambda execution environment | AWS Lambda (dispatch function) | Cloud Run instance |
| `db/dynamoStore.js` | DynamoDB table + GSI | Amazon DynamoDB | Firestore / Cloud Bigtable |
| `public/` dashboard + WebSocket push | CloudWatch dashboard / ops console | CloudWatch + a small ops Lambda, or Amazon Managed Grafana | Cloud Monitoring dashboard |

## Why the scaling policy is shaped the way it is

- **Target-tracking, not step-scaling.** The scaler doesn't wait for a fixed
  threshold breach; it continuously computes desired capacity from
  `queueDepth / targetPerWorker`, matching how Application Auto Scaling's
  target-tracking policies behave against an SQS-based custom metric
  (`ApproximateNumberOfMessagesVisible`).
- **Asymmetric cooldowns.** Scale-out cooldown is short (1.5s) so the system
  reacts fast to a sudden spike; scale-in cooldown is longer (8s) so a
  momentary dip in the queue doesn't tear down capacity right before the
  next burst — mirrors AWS's own guidance to scale out aggressively and
  scale in conservatively for bursty, latency-sensitive workloads.
- **Two priority lanes instead of one.** SQS has no native priority
  ordering, so the real design (and this simulation) uses two queues and
  always drains the critical lane first, exactly as you'd implement
  priority triage against SQS in production.
- **Min capacity > 0.** `MIN_WORKERS = 2` keeps a warm floor so the very
  first requests of a new spike aren't paying a cold-start penalty — the
  same reason production Lambda deployments configure provisioned
  concurrency for latency-critical paths.

## Failure handling

- A crashed worker (`workers/requestProcessor.js` throwing) is caught by
  `autoScaler.js`'s `worker.on('error', ...)` handler, which terminates and
  immediately respawns a replacement — analogous to Lambda automatically
  replacing a failed execution environment.
- ~2% of processed requests are simulated to fail downstream dispatch
  (`workers/requestProcessor.js`); these are marked `FAILED` in the ledger
  rather than silently dropped, so a real deployment's retry/DLQ policy has
  something concrete to act on.

## Known simplifications (be ready to name these in a viva)

- Real DynamoDB is a managed, horizontally-partitioned store; `dynamoStore.js`
  is a single in-memory `Map` with a JSON snapshot for durability across
  restarts, sized for demo, not production, throughput.
- Real SQS delivery is at-least-once and can redeliver; `priorityQueue.js`
  is a single-process in-memory queue, which is why the mapping table above
  calls it a *simulation* of SQS, not a reimplementation.
- The real edge cache (CloudFront) fronts every region's traffic globally;
  `cdnCache.js` caches only within this one process, which is enough to
  demonstrate the hit/miss behaviour but not global edge distribution.
