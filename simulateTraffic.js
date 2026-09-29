// simulateTraffic.js
//
// Standalone script for the demo/viva. Fires requests at the running server
// to show the auto-scaler reacting in real time on the dashboard.
//
// Usage:
//   node loadgen/simulateTraffic.js normal      -> steady low traffic
//   node loadgen/simulateTraffic.js disaster    -> sudden burst, like a
//                                                   real disaster event,
//                                                   then tapering off

const BASE_URL = process.env.BROKER_URL || 'http://localhost:4000';

const CITIES = [
  { name: 'Mumbai', lat: 19.076, lon: 72.8777 },
  { name: 'Delhi', lat: 28.7041, lon: 77.1025 },
  { name: 'San Francisco', lat: 37.7749, lon: -122.4194 },
  { name: 'London', lat: 51.5072, lon: -0.1276 },
  { name: 'Tokyo', lat: 35.6762, lon: 139.6503 },
  { name: 'Sao Paulo', lat: -23.5505, lon: -46.6333 },
];

const REQUEST_TYPES = ['MEDICAL', 'RESCUE', 'SHELTER', 'FOOD_WATER', 'INFRASTRUCTURE', 'OTHER'];

function jitter(coord, spread = 0.3) {
  return coord + (Math.random() - 0.5) * spread;
}

function randomRequest() {
  const city = CITIES[Math.floor(Math.random() * CITIES.length)];
  const requestType = REQUEST_TYPES[Math.floor(Math.random() * REQUEST_TYPES.length)];
  return {
    requestType,
    description: `${requestType} assistance needed near ${city.name}`,
    lat: jitter(city.lat),
    lon: jitter(city.lon),
    emergency: Math.random() < 0.15,
    reporterContact: `+91-90000${Math.floor(Math.random() * 90000)}`,
  };
}

async function fireRequest() {
  try {
    const res = await fetch(`${BASE_URL}/api/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(randomRequest()),
    });
    if (!res.ok) {
      console.error('Request rejected:', await res.text());
    }
  } catch (err) {
    console.error('Request failed:', err.message);
  }
}

async function runNormal() {
  console.log('Simulating steady baseline traffic (~3 req/sec). Ctrl+C to stop.');
  setInterval(() => {
    const burst = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < burst; i++) fireRequest();
  }, 1000);
}

async function runDisaster() {
  console.log('Simulating a disaster traffic spike...');
  console.log('Phase 1: baseline (10s)');
  for (let t = 0; t < 10; t++) {
    setTimeout(() => {
      for (let i = 0; i < 3; i++) fireRequest();
    }, t * 1000);
  }

  console.log('Phase 2: sudden spike at t=10s (~80 req/sec for 20s)');
  setTimeout(() => {
    const spikeInterval = setInterval(() => {
      for (let i = 0; i < 80; i++) fireRequest();
    }, 1000);
    setTimeout(() => clearInterval(spikeInterval), 20000);
  }, 10000);

  console.log('Phase 3: taper back to baseline after t=30s');
  setTimeout(() => {
    setInterval(() => {
      for (let i = 0; i < 3; i++) fireRequest();
    }, 1000);
  }, 30000);
}

const mode = process.argv[2] || 'normal';
if (mode === 'disaster') {
  runDisaster();
} else {
  runNormal();
}
