// requestProcessor.js
//
// This file is the entry point for a worker_thread. Each running instance
// of this thread stands in for one warm Lambda execution environment in the
// real deployment - it pulls one message off the queue, does the "work"
// (validation, dispatch-to-responder lookup, ledger update), and reports
// back. The auto-scaler decides how many of these are alive at once, the
// same way Lambda concurrency (or an ECS/EC2 Auto Scaling group, for the
// GCP Cloud Run variant) scales the number of execution environments based
// on incoming load.

const { parentPort, workerData } = require('worker_threads');

const { workerId } = workerData;

// Simulated per-request processing cost. Emergency requests get a shorter,
// more deterministic path (less validation, priority dispatch lookup only)
// which mirrors why the real design keeps a separate lightweight Lambda
// for CRITICAL requests rather than reusing the standard handler.
function simulateProcessingTime(priority) {
  if (priority === 'CRITICAL') {
    return 120 + Math.random() * 180; // 120-300ms
  }
  return 300 + Math.random() * 700; // 300-1000ms
}

parentPort.on('message', async (msg) => {
  if (msg.type !== 'PROCESS') return;

  const { request } = msg;
  const start = Date.now();
  const processingTime = simulateProcessingTime(request.priority);

  await new Promise((resolve) => setTimeout(resolve, processingTime));

  // Simulated failure rate for downstream dispatch (e.g. responder service
  // timeout) - kept low but non-zero so the dashboard has something real to
  // show for the retry path.
  const failed = Math.random() < 0.02;

  parentPort.postMessage({
    type: 'RESULT',
    workerId,
    requestId: request.requestId,
    success: !failed,
    durationMs: Date.now() - start,
  });
});
