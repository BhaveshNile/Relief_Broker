// autoScaler.js
//
// Simulates AWS Application Auto Scaling in "target tracking" mode, which is
// what the real Lambda/ECS deployment would use:
//
//   target metric   : messages-in-flight per worker (like ApproximateNumber
//                      OfMessagesVisible / concurrent executions)
//   target value     : TARGET_PER_WORKER
//   scale-out step   : add workers when queue pressure exceeds target
//   scale-in cooldown: wait COOLDOWN_MS after a scale-in before scaling in
//                      again, to avoid thrashing on bursty traffic
//   min / max        : MIN_WORKERS / MAX_WORKERS, same idea as an Auto
//                      Scaling group's min/max capacity or a Lambda
//                      reserved-concurrency ceiling
//
// This is the module that actually demonstrates "auto-scaling" for the
// project - everything else is plumbing to generate the load it reacts to.

const { Worker } = require('worker_threads');
const path = require('path');

const MIN_WORKERS = 2;
const MAX_WORKERS = 20;
const TARGET_PER_WORKER = 4; // target queue depth per warm worker
const SCALE_CHECK_INTERVAL_MS = 1000;
const SCALE_IN_COOLDOWN_MS = 8000;
const SCALE_OUT_COOLDOWN_MS = 1500;

class AutoScaler {
  constructor({ queue, store, onEvent }) {
    this.queue = queue;
    this.store = store;
    this.onEvent = onEvent || (() => {});
    this.workers = new Map(); // workerId -> { worker, busy }
    this.nextWorkerId = 1;
    this.lastScaleOutAt = 0;
    this.lastScaleInAt = 0;
    this.metrics = {
      totalProcessed: 0,
      totalFailed: 0,
      scaleOutEvents: 0,
      scaleInEvents: 0,
      processingTimesMs: [], // rolling window for avg latency
    };

    for (let i = 0; i < MIN_WORKERS; i++) this._spawnWorker();

    this._dispatchLoop = setInterval(() => this._dispatch(), 100);
    this._scaleLoop = setInterval(() => this._evaluateScaling(), SCALE_CHECK_INTERVAL_MS);
  }

  _spawnWorker() {
    const workerId = `worker-${this.nextWorkerId++}`;
    const worker = new Worker(path.join(__dirname, '..', 'workers', 'requestProcessor.js'), {
      workerData: { workerId },
    });

    worker.on('message', (msg) => this._handleWorkerMessage(workerId, msg));
    worker.on('error', (err) => {
      console.error(`[autoScaler] ${workerId} crashed:`, err.message);
      this._terminateWorker(workerId);
      this._spawnWorker(); // replace a crashed worker, like Lambda would
    });

    this.workers.set(workerId, { worker, busy: false });
    this.onEvent({ type: 'WORKER_SPAWNED', workerId, totalWorkers: this.workers.size });
    return workerId;
  }

  _terminateWorker(workerId) {
    const entry = this.workers.get(workerId);
    if (!entry) return;
    entry.worker.terminate();
    this.workers.delete(workerId);
    this.onEvent({ type: 'WORKER_TERMINATED', workerId, totalWorkers: this.workers.size });
  }

  _handleWorkerMessage(workerId, msg) {
    if (msg.type !== 'RESULT') return;
    const entry = this.workers.get(workerId);
    if (entry) entry.busy = false;

    this.metrics.totalProcessed += 1;
    if (!msg.success) this.metrics.totalFailed += 1;

    this.metrics.processingTimesMs.push(msg.durationMs);
    if (this.metrics.processingTimesMs.length > 200) {
      this.metrics.processingTimesMs.shift();
    }

    this.store.update(msg.requestId, {
      status: msg.success ? 'RESOLVED' : 'FAILED',
      processedByWorker: workerId,
      processingDurationMs: msg.durationMs,
    });

    this.onEvent({
      type: 'REQUEST_COMPLETED',
      requestId: msg.requestId,
      success: msg.success,
      durationMs: msg.durationMs,
      workerId,
    });
  }

  _dispatch() {
    for (const [workerId, entry] of this.workers) {
      if (entry.busy) continue;
      const item = this.queue.dequeue();
      if (!item) break;
      entry.busy = true;
      this.store.update(item.requestId, { status: 'PROCESSING' });
      entry.worker.postMessage({ type: 'PROCESS', request: item });
    }
  }

  _evaluateScaling() {
    const depth = this.queue.size();
    const workerCount = this.workers.size;
    const desired = Math.min(
      MAX_WORKERS,
      Math.max(MIN_WORKERS, Math.ceil(depth / TARGET_PER_WORKER))
    );

    const now = Date.now();

    if (desired > workerCount && now - this.lastScaleOutAt > SCALE_OUT_COOLDOWN_MS) {
      const toAdd = Math.min(desired - workerCount, MAX_WORKERS - workerCount);
      for (let i = 0; i < toAdd; i++) this._spawnWorker();
      this.lastScaleOutAt = now;
      this.metrics.scaleOutEvents += 1;
      this.onEvent({
        type: 'SCALE_OUT',
        reason: `queue depth ${depth} exceeds target (${TARGET_PER_WORKER}/worker)`,
        from: workerCount,
        to: workerCount + toAdd,
      });
    } else if (
      desired < workerCount &&
      now - this.lastScaleInAt > SCALE_IN_COOLDOWN_MS &&
      now - this.lastScaleOutAt > SCALE_IN_COOLDOWN_MS
    ) {
      const idleWorkers = Array.from(this.workers.entries()).filter(([, e]) => !e.busy);
      const toRemove = Math.min(workerCount - desired, idleWorkers.length);
      for (let i = 0; i < toRemove; i++) this._terminateWorker(idleWorkers[i][0]);
      if (toRemove > 0) {
        this.lastScaleInAt = now;
        this.metrics.scaleInEvents += 1;
        this.onEvent({
          type: 'SCALE_IN',
          reason: `queue depth ${depth} below target, releasing idle capacity`,
          from: workerCount,
          to: workerCount - toRemove,
        });
      }
    }
  }

  avgProcessingTimeMs() {
    const arr = this.metrics.processingTimesMs;
    if (arr.length === 0) return 0;
    return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  }

  snapshot() {
    return {
      activeWorkers: this.workers.size,
      minWorkers: MIN_WORKERS,
      maxWorkers: MAX_WORKERS,
      targetPerWorker: TARGET_PER_WORKER,
      busyWorkers: Array.from(this.workers.values()).filter((e) => e.busy).length,
      totalProcessed: this.metrics.totalProcessed,
      totalFailed: this.metrics.totalFailed,
      scaleOutEvents: this.metrics.scaleOutEvents,
      scaleInEvents: this.metrics.scaleInEvents,
      avgProcessingTimeMs: this.avgProcessingTimeMs(),
    };
  }
}

module.exports = { AutoScaler, MIN_WORKERS, MAX_WORKERS };
