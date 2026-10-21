/**
 * Haversine great-circle distance between two lat/lon points, in meters.
 * Accurate enough for a 30-2000m geofence radius — no need for a more
 * precise ellipsoidal model at this scale.
 */
function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // mean Earth radius, meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const MAX_ACCURACY_M = Number(process.env.ATTENDANCE_MAX_ACCURACY_M) || 100;

/**
 * Checks a reported clock-in location against a site's geofence. Returns
 * { ok, distance_m, reason } — reason is a human-readable message suitable
 * for showing directly to the employee on the portal screen.
 */
function checkGeofence({ latitude, longitude, accuracyM, site }) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || Number.isNaN(latitude) || Number.isNaN(longitude)) {
    return { ok: false, distance_m: null, reason: 'Location not available. Enable location services and try again.' };
  }
  if (typeof accuracyM !== 'number' || Number.isNaN(accuracyM) || accuracyM > MAX_ACCURACY_M) {
    return { ok: false, distance_m: null, reason: `Your location signal is too weak (±${Math.round(accuracyM || 0)}m). Move to an open area and try again.` };
  }
  const distance_m = haversineDistanceMeters(latitude, longitude, Number(site.latitude), Number(site.longitude));
  // Accuracy margin: a GPS fix is a disc of radius accuracyM around the
  // true position, so a point reported just outside the fence may actually
  // be inside it (or vice versa) — allow up to the reported accuracy as
  // slack rather than penalizing a weak-but-under-the-cap signal twice.
  const allowed = Number(site.radius_m) + accuracyM;
  if (distance_m > allowed) {
    return {
      ok: false,
      distance_m,
      reason: `You are ${Math.round(distance_m)} m from ${site.name}. Move closer and try again.`,
    };
  }
  return { ok: true, distance_m, reason: null };
}

module.exports = { haversineDistanceMeters, checkGeofence, MAX_ACCURACY_M };
