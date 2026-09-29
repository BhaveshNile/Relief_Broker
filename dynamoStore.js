// dynamoStore.js
//
// Stand-in for the DynamoDB table `RequestLedger` in the real deployment:
//   partition key: requestId (S)
//   GSI: status-index (PK: status, SK: createdAt) - used by the ops
//        dashboard to page through PENDING / PROCESSING / RESOLVED items
//
// We keep the same access patterns (get by id, query by status, put, update)
// against an in-memory Map, and flush to a local JSON file periodically so
// state survives a restart during a demo - the same reason the real table
// has point-in-time recovery turned on.

const fs = require('fs');
const path = require('path');

const SNAPSHOT_FILE = path.join(__dirname, 'snapshot.json');

class DynamoStore {
  constructor() {
    this.table = new Map();
    this._load();
    this._dirty = false;
    setInterval(() => this._flush(), 5000).unref();
  }

  _load() {
    try {
      if (fs.existsSync(SNAPSHOT_FILE)) {
        const raw = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
        for (const item of raw) this.table.set(item.requestId, item);
      }
    } catch (err) {
      // Corrupt snapshot shouldn't take the whole broker down - start clean
      console.warn('[dynamoStore] snapshot load failed, starting empty:', err.message);
    }
  }

  _flush() {
    if (!this._dirty) return;
    const all = Array.from(this.table.values()).slice(-2000); // cap file growth
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(all, null, 2));
    this._dirty = false;
  }

  put(item) {
    this.table.set(item.requestId, item);
    this._dirty = true;
    return item;
  }

  get(requestId) {
    return this.table.get(requestId) || null;
  }

  update(requestId, patch) {
    const existing = this.table.get(requestId);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.table.set(requestId, updated);
    this._dirty = true;
    return updated;
  }

  queryByStatus(status, limit = 50) {
    const out = [];
    for (const item of this.table.values()) {
      if (item.status === status) out.push(item);
      if (out.length >= limit) break;
    }
    return out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  all(limit = 100) {
    return Array.from(this.table.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }

  count() {
    return this.table.size;
  }
}

module.exports = { DynamoStore };
