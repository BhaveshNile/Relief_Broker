// geoRouter.js
//
// Simulates the job CloudFront + Route 53 latency-based routing does in the
// real deployment: pick the nearest edge region for an incoming request so
// that relief requests get processed close to where the disaster is
// happening instead of round-tripping to a single central server.
//
// In the real AWS build this logic doesn't run as application code at all -
// it's Route 53 latency routing + CloudFront edge locations. We reproduce
// the same decision here (nearest region by great-circle distance) so the
// simulation's routing behaviour matches what the deployed system would do.

const REGIONS = [
  { code: 'us-east-1', name: 'US East (N. Virginia)', lat: 38.13, lon: -78.45 },
  { code: 'us-west-2', name: 'US West (Oregon)', lat: 45.87, lon: -119.69 },
  { code: 'eu-west-1', name: 'EU (Ireland)', lat: 53.41, lon: -8.24 },
  { code: 'ap-south-1', name: 'Asia Pacific (Mumbai)', lat: 19.08, lon: 72.88 },
  { code: 'ap-southeast-1', name: 'Asia Pacific (Singapore)', lat: 1.35, lon: 103.82 },
];

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

// Haversine formula - straight-line distance between two lat/lon points in km
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function routeToNearestRegion(originLat, originLon) {
  let best = null;
  let bestDist = Infinity;

  for (const region of REGIONS) {
    const d = distanceKm(originLat, originLon, region.lat, region.lon);
    if (d < bestDist) {
      bestDist = d;
      best = region;
    }
  }

  return {
    region: best.code,
    regionName: best.name,
    distanceKm: Math.round(bestDist),
  };
}

module.exports = { routeToNearestRegion, REGIONS, distanceKm };
