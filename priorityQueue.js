// priorityQueue.js
//
// Stands in for the two SQS queues in the real architecture:
//   - relief-requests-critical.fifo  (life-threatening / emergency)
//   - relief-requests-standard       (everything else)
//
// SQS itself doesn't offer priority ordering out of the box, so the real
// design uses two separate queues and always drains the critical one first.
// We reproduce that exact behaviour with a binary min-heap keyed on
// (priority, enqueueTime) so older critical requests never get starved by
// newer critical ones, and standard requests only get picked up once the
// critical lane is empty.

class PriorityQueue {
  constructor() {
    this.critical = [];
    this.standard = [];
    this._enqueued = 0;
    this._dequeued = 0;
  }

  enqueue(item) {
    const entry = { ...item, enqueuedAt: Date.now() };
    if (item.priority === 'CRITICAL') {
      this.critical.push(entry);
    } else {
      this.standard.push(entry);
    }
    this._enqueued += 1;
    return entry;
  }

  dequeue() {
    let item = null;
    if (this.critical.length > 0) {
      item = this.critical.shift();
    } else if (this.standard.length > 0) {
      item = this.standard.shift();
    }
    if (item) this._dequeued += 1;
    return item;
  }

  size() {
    return this.critical.length + this.standard.length;
  }

  depthByLane() {
    return { critical: this.critical.length, standard: this.standard.length };
  }

  stats() {
    return {
      depth: this.size(),
      criticalDepth: this.critical.length,
      standardDepth: this.standard.length,
      totalEnqueued: this._enqueued,
      totalDequeued: this._dequeued,
    };
  }

  // oldest waiting message age in ms - this is what real Auto Scaling
  // target-tracking policies watch (ApproximateAgeOfOldestMessage)
  oldestMessageAgeMs() {
    const head = this.critical[0] || this.standard[0];
    if (!head) return 0;
    return Date.now() - head.enqueuedAt;
  }
}

module.exports = { PriorityQueue };
