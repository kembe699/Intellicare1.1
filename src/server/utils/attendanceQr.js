/**
 * HMAC-signed QR tokens for attendance_sites, two modes:
 *
 *  - printed (static): the token IS site.qr_key, a random value stored on
 *    the row. Signing it just proves the QR came from this server (so a
 *    forged/edited URL fails signature verification before any DB lookup);
 *    the actual "did HR regenerate this" check is a DB comparison against
 *    the site's CURRENT qr_key, so regenerating invalidates every
 *    previously-printed poster immediately, not just future scans.
 *
 *  - rotating (display): the token is derived from site.qr_key + a 30s time
 *    bucket, so a photo of the screen stops verifying within ~60-90s. The
 *    display page re-fetches a fresh token every 30s; verification accepts
 *    the current bucket and the previous one only, to tolerate normal
 *    clock/network lag between the display and the scanning phone.
 *
 * Secret comes from ATTENDANCE_QR_SECRET — a boot-time requirement, not a
 * per-tenant one, same as JWT_SECRET: this signs server-issued tokens, it
 * doesn't need to vary by hospital.
 */
const crypto = require('crypto');

const SECRET = process.env.ATTENDANCE_QR_SECRET;
const ROTATING_BUCKET_MS = 30 * 1000;

function requireSecret() {
  if (!SECRET) {
    throw new Error('ATTENDANCE_QR_SECRET is not set — geofenced attendance QR codes cannot be signed or verified.');
  }
}

function hmac(payload) {
  requireSecret();
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Generates a fresh random key for a site (used on create + regenerate). */
function generateSiteKey() {
  return crypto.randomBytes(24).toString('base64url');
}

/** Builds the static (printed) QR payload for a site: { token, sig }. */
function signStaticToken(site) {
  const token = `${site.id}.${site.qr_key}`;
  return { token, sig: hmac(token) };
}

/** Builds the current rotating-display QR payload for a site. */
function signRotatingToken(site, atMs = Date.now()) {
  const bucket = Math.floor(atMs / ROTATING_BUCKET_MS);
  const token = `${site.id}.${site.qr_key}.${bucket}`;
  return { token, sig: hmac(token), expiresInMs: ROTATING_BUCKET_MS - (atMs % ROTATING_BUCKET_MS) };
}

/**
 * Verifies a scanned { token, sig } pair against a site row loaded from the
 * DB (caller already resolved site_id -> site). Returns
 * { valid, method, reason }. Does NOT check geofence/sequence — purely
 * "is this a genuine, currently-valid code for this site".
 */
function verifyToken({ token, sig, site }) {
  if (!token || !sig) return { valid: false, method: null, reason: 'Missing or malformed QR code.' };
  if (!timingSafeEqual(hmac(token), sig)) {
    return { valid: false, method: null, reason: 'This QR code is invalid or has been tampered with.' };
  }
  const parts = String(token).split('.');
  if (parts.length === 2) {
    // Static: token = `${siteId}.${qrKey}` — valid only if it matches the
    // site's CURRENT key (so a regenerate invalidates old printed posters
    // even though their signature still checks out above).
    const [, qrKey] = parts;
    if (site.qr_mode !== 'printed') return { valid: false, method: null, reason: 'This site no longer uses a printed QR code. Ask HR for the current code.' };
    if (!timingSafeEqual(qrKey, site.qr_key)) {
      return { valid: false, method: null, reason: 'This QR code has been replaced. Ask HR for the current poster.' };
    }
    return { valid: true, method: 'qr_static', reason: null };
  }
  if (parts.length === 3) {
    // Rotating: token = `${siteId}.${qrKey}.${bucket}` — valid only for the
    // current or immediately-previous 30s bucket.
    const [, qrKey, bucketStr] = parts;
    if (site.qr_mode !== 'rotating') return { valid: false, method: null, reason: 'This site no longer uses a rotating display code.' };
    if (!timingSafeEqual(qrKey, site.qr_key)) {
      return { valid: false, method: null, reason: 'This code is out of date. Rescan the display screen.' };
    }
    const bucket = parseInt(bucketStr, 10);
    const currentBucket = Math.floor(Date.now() / ROTATING_BUCKET_MS);
    if (!Number.isFinite(bucket) || currentBucket - bucket > 1 || bucket - currentBucket > 0) {
      return { valid: false, method: null, reason: 'This QR code has expired. Rescan the display screen — it refreshes every 30 seconds.' };
    }
    return { valid: true, method: 'qr_rotating', reason: null };
  }
  return { valid: false, method: null, reason: 'Malformed QR code.' };
}

module.exports = { generateSiteKey, signStaticToken, signRotatingToken, verifyToken };
