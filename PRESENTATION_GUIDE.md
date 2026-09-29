# Presentation / viva notes

## One-line pitch

"Relief dispatch systems fail exactly when they're needed most — during a
disaster, request volume can spike 20-50x in minutes and a fixed-capacity
server falls over. This project is an auto-scaling, serverless request
broker that absorbs that spike by adding processing capacity in real time
and prioritising life-safety requests over routine ones, instead of
processing everything first-in-first-out."

## Suggested demo flow (5-7 minutes)

1. **Start the server**, open the dashboard at `localhost:4000`. Point out
   the five stat cards are live (queue depth, active workers, requests
   processed, avg processing time, CDN cache ratio) — this is real telemetry
   off the running system, not a mock.
2. **Submit one request manually** via curl or Postman (a `MEDICAL` one) —
   show it appear instantly in the live feed, tagged `CRITICAL`, and show
   which region it got geo-routed to.
3. **Run `npm run loadtest:disaster`** in a second terminal. Narrate the
   three phases as they happen:
   - baseline traffic, 2 workers, dashboard steady
   - the spike hits at t=10s — queue depth chart jumps, and within ~1.5s
     the "Scaling events" panel logs a `SCALE_OUT` event, worker count
     climbing toward the max
   - once the spike tapers (t=30s+), point out the scaler *waits* (8s
     cooldown) before scaling back in, and explain why (avoiding thrashing
     if another burst follows immediately — this is a real AWS Auto Scaling
     pattern, not something invented for the demo)
4. **Open `docs/ARCHITECTURE.md`** on screen and walk the mapping table:
   every module the evaluator just watched running maps to a named AWS
   service. This is the moment to show `docs/serverless.yml` and say "this
   is the actual deployable config for the same system on real AWS."

## Likely questions and how to answer them

**"Is this actually deployed on AWS?"**
No — it's a local simulation that reproduces the same architectural
decisions (decoupling via a queue, target-tracking auto-scaling, priority
lanes, edge caching) using equivalent local primitives (worker threads for
Lambda concurrency, an in-memory two-lane queue for SQS). `serverless.yml`
in `docs/` is the real, deployable version of the same design — deploying
it is a configuration exercise (AWS credentials + `serverless deploy`), not
a redesign.

**"Why not just use a single beefier server instead of auto-scaling?"**
Vertical scaling has a ceiling and doesn't help with the actual failure
mode here — a 50x traffic multiplier in under a minute. Horizontal
auto-scaling adds capacity proportional to load and releases it afterward,
which is both more resilient to unpredictable spikes and cheaper at
baseline than provisioning for peak load permanently.

**"What happens if a worker crashes mid-request?"**
Explain the `worker.on('error', ...)` handler in `autoScaler.js`: the
crashed worker is terminated and immediately replaced, and because the
message had already been marked `PROCESSING` in the ledger rather than
deleted from the queue, a production SQS deployment's visibility timeout +
redrive policy (see the DLQ configuration in `serverless.yml`) would
redeliver it for retry.

**"How do you decide what counts as an emergency?"**
Walk through `lambda/requestIntake.js`'s `classifyPriority` — `MEDICAL` and
`RESCUE` request types are always critical (life-safety by definition);
other types are only escalated if the caller explicitly flags them, which
keeps the critical lane reserved for genuine emergencies instead of being
diluted by mis-tagged routine requests.

**"What's the actual availability number your architecture targets?"**
The "Real-World Impact" framing (99.99% availability under burst load)
comes from decoupling intake from processing via a queue — API Gateway +
the intake Lambda can keep accepting requests even if the processing layer
is fully saturated, so the system never returns an error to the caller
purely because of load; the request is durably queued instead. That's the
same reasoning AWS gives for SQS-fronted Lambda architectures achieving
very high availability at the ingestion layer specifically.
