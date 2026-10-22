/**
 * Pure distance/geofence math for the geofenced QR attendance feature —
 * no DB, no server boot. See src/server/utils/geofence.js.
 */
const { haversineDistanceMeters, checkGeofence, MAX_ACCURACY_M } = require('../../src/server/utils/geofence');

// Main Gate test fixture, matching the one used throughout this feature's
// live verification (see the HR attendance commits).
const SITE = { name: 'Main Gate', latitude: 1.2921, longitude: 36.8219, radius_m: 100 };

test('haversineDistanceMeters returns ~0 for the same point', () => {
  expect(haversineDistanceMeters(1.2921, 36.8219, 1.2921, 36.8219)).toBeCloseTo(0, 3);
});

test('haversineDistanceMeters: a known ~111km north-south separation (1 degree of latitude)', () => {
  const d = haversineDistanceMeters(0, 36.8219, 1, 36.8219);
  expect(d).toBeGreaterThan(110500);
  expect(d).toBeLessThan(111500);
});

test('checkGeofence: inside the radius with good accuracy is accepted', () => {
  // ~0.0005 degrees of latitude is roughly 55m — well inside a 100m radius.
  const result = checkGeofence({ latitude: 1.2921 + 0.0005, longitude: 36.8219, accuracyM: 10, site: SITE });
  expect(result.ok).toBe(true);
  expect(result.distance_m).toBeLessThan(100);
});

test('checkGeofence: exactly on the fence center is accepted', () => {
  const result = checkGeofence({ latitude: SITE.latitude, longitude: SITE.longitude, accuracyM: 5, site: SITE });
  expect(result.ok).toBe(true);
  expect(result.distance_m).toBeCloseTo(0, 1);
});

test('checkGeofence: at the edge, within radius + accuracy margin, is accepted', () => {
  // ~150m away, accuracy 60m -> allowed = 100 + 60 = 160m, 150 < 160 passes.
  const result = checkGeofence({ latitude: 1.2921 + 0.00135, longitude: 36.8219, accuracyM: 60, site: SITE });
  expect(result.ok).toBe(true);
});

test('checkGeofence: clearly outside the radius is rejected with a specific, named-site message', () => {
  // ~1.1km north — far outside any reasonable accuracy margin.
  const result = checkGeofence({ latitude: 1.3021, longitude: 36.8219, accuracyM: 10, site: SITE });
  expect(result.ok).toBe(false);
  expect(result.reason).toMatch(/Main Gate/);
  expect(result.reason).toMatch(/Move closer/);
});

test('checkGeofence: poor GPS accuracy is rejected outright, even standing on the exact center', () => {
  const result = checkGeofence({ latitude: SITE.latitude, longitude: SITE.longitude, accuracyM: MAX_ACCURACY_M + 50, site: SITE });
  expect(result.ok).toBe(false);
  expect(result.reason).toMatch(/location signal is too weak/);
});

test('checkGeofence: accuracy exactly at the configured cap is still accepted', () => {
  const result = checkGeofence({ latitude: SITE.latitude, longitude: SITE.longitude, accuracyM: MAX_ACCURACY_M, site: SITE });
  expect(result.ok).toBe(true);
});

test('checkGeofence: missing/non-numeric coordinates are rejected, not silently coerced', () => {
  const result = checkGeofence({ latitude: NaN, longitude: 36.8219, accuracyM: 10, site: SITE });
  expect(result.ok).toBe(false);
  expect(result.reason).toMatch(/Location not available/);
});

test('checkGeofence: a larger radius site accepts a proportionally farther point', () => {
  const bigSite = { ...SITE, radius_m: 2000 };
  // ~1.1km away — would fail the 100m site above but fits comfortably in 2000m.
  const result = checkGeofence({ latitude: 1.3021, longitude: 36.8219, accuracyM: 10, site: bigSite });
  expect(result.ok).toBe(true);
});
