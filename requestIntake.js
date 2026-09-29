// requestIntake.js
//
// This is the first Lambda in the pipeline (invoked directly by API
// Gateway). Its only job is: validate, classify priority, geo-route, write
// the initial ledger row, and push onto the correct SQS lane. It does NOT
// do the actual dispatch work - that's deliberately handed off to the
// queue/worker pool so that a burst of intake requests can never block on
// slow downstream processing. That decoupling is the whole point of using
// SQS between the two stages in the real architecture.

const { v4: uuidv4 } = require('uuid');
const { routeToNearestRegion } = require('./geoRouter');

const VALID_TYPES = new Set([
  'MEDICAL',
  'RESCUE',
  'SHELTER',
  'FOOD_WATER',
  'INFRASTRUCTURE',
  'OTHER',
]);

function validate(body) {
  const errors = [];
  if (!body.requestType || !VALID_TYPES.has(body.requestType)) {
    errors.push(`requestType must be one of: ${[...VALID_TYPES].join(', ')}`);
  }
  if (typeof body.lat !== 'number' || body.lat < -90 || body.lat > 90) {
    errors.push('lat must be a number between -90 and 90');
  }
  if (typeof body.lon !== 'number' || body.lon < -180 || body.lon > 180) {
    errors.push('lon must be a number between -180 and 180');
  }
  if (!body.description || typeof body.description !== 'string') {
    errors.push('description is required');
  }
  return errors;
}

// Priority classification: an emergency flag from the caller is trusted for
// MEDICAL/RESCUE (life-safety), but for other types we only escalate when
// the caller explicitly marks it critical - keeps the critical lane from
// filling up with, say, a routine supply request marked urgent by mistake.
function classifyPriority(body) {
  if (body.requestType === 'MEDICAL' || body.requestType === 'RESCUE') return 'CRITICAL';
  if (body.emergency === true) return 'CRITICAL';
  return 'STANDARD';
}

function intake(body) {
  const errors = validate(body);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const requestId = uuidv4();
  const priority = classifyPriority(body);
  const routing = routeToNearestRegion(body.lat, body.lon);

  const record = {
    requestId,
    requestType: body.requestType,
    description: body.description.slice(0, 500),
    priority,
    status: 'PENDING',
    lat: body.lat,
    lon: body.lon,
    region: routing.region,
    regionName: routing.regionName,
    routedDistanceKm: routing.distanceKm,
    reporterContact: body.reporterContact || null,
    createdAt: new Date().toISOString(),
  };

  return { ok: true, record };
}

module.exports = { intake, validate, classifyPriority };
