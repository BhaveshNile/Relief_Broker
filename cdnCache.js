// cdnCache.js
//
// A very small edge-cache simulation for the read-heavy, rarely-changing
// endpoints (region list, public status feed) - the same class of traffic
// CloudFront absorbs at the edge in the real deployment so it never reaches
// API Gateway / Lambda at all during a traffic spike. This is intentionally
// simple: a TTL cache keyed on the route, with a hit/miss counter exposed
// to the dashboard so you can show CDN offload as a real number in the demo.

const store = new Map();
let hits = 0;
let misses = 0;

function cdnCache(ttlMs = 3000) {
  return (req, res, next) => {
    const key = req.originalUrl;
    const cached = store.get(key);

    if (cached && Date.now() - cached.at < ttlMs) {
      hits += 1;
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached.body);
    }

    misses += 1;
    res.setHeader('X-Cache', 'MISS');
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      store.set(key, { body, at: Date.now() });
      return originalJson(body);
    };
    next();
  };
}

function cdnStats() {
  const total = hits + misses;
  return {
    hits,
    misses,
    hitRatio: total === 0 ? 0 : Number((hits / total).toFixed(3)),
  };
}

module.exports = { cdnCache, cdnStats };
