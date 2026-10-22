/**
 * HMAC-signed attendance QR tokens — forgery resistance, regenerated-key
 * invalidation, and rotating-token expiry. No DB, no server boot. See
 * src/server/utils/attendanceQr.js.
 *
 * ATTENDANCE_QR_SECRET must be set before the module is first required —
 * it's read into a top-level const at module load, not re-read per call.
 */
process.env.ATTENDANCE_QR_SECRET = 'test-secret-do-not-use-in-production';

const { generateSiteKey, signStaticToken, signRotatingToken, verifyToken } = require('../../src/server/utils/attendanceQr');

function makeSite(overrides = {}) {
  return { id: 'site-123', qr_mode: 'printed', qr_key: generateSiteKey(), ...overrides };
}

test('generateSiteKey produces a non-trivial, non-repeating value', () => {
  const a = generateSiteKey();
  const b = generateSiteKey();
  expect(a).not.toEqual(b);
  expect(a.length).toBeGreaterThan(20);
});

test('a genuine static token verifies successfully', () => {
  const site = makeSite();
  const { token, sig } = signStaticToken(site);
  const result = verifyToken({ token, sig, site });
  expect(result.valid).toBe(true);
  expect(result.method).toBe('qr_static');
});

test('forgery: tampering with the signature is rejected', () => {
  const site = makeSite();
  const { token, sig } = signStaticToken(site);
  const tamperedSig = sig.slice(0, -2) + (sig.slice(-2) === '00' ? '11' : '00');
  const result = verifyToken({ token, sig: tamperedSig, site });
  expect(result.valid).toBe(false);
  expect(result.reason).toMatch(/invalid or has been tampered/);
});

test('forgery: tampering with the token payload (e.g. swapping the site id) invalidates the signature', () => {
  const site = makeSite();
  const { sig } = signStaticToken(site);
  const forgedToken = `some-other-site-id.${site.qr_key}`;
  const result = verifyToken({ token: forgedToken, sig, site });
  expect(result.valid).toBe(false);
});

test('forgery: a token signed for one site does not verify against a different site object', () => {
  const siteA = makeSite({ id: 'site-A' });
  const siteB = makeSite({ id: 'site-B' });
  const { token, sig } = signStaticToken(siteA);
  // siteB has a different qr_key, so even though the signature itself is
  // genuine (it was really signed by this server), the DB-current-key
  // check must still reject it.
  const result = verifyToken({ token, sig, site: siteB });
  expect(result.valid).toBe(false);
});

test('regenerated key: the OLD printed token stops verifying immediately, even though its signature is still genuine', () => {
  const site = makeSite();
  const { token, sig } = signStaticToken(site); // signed against the original key

  // HR regenerates — the site's key changes, old printed posters are now stale.
  const regeneratedSite = { ...site, qr_key: generateSiteKey() };

  const result = verifyToken({ token, sig, site: regeneratedSite });
  expect(result.valid).toBe(false);
  expect(result.reason).toMatch(/replaced/);
});

test('a static token is rejected against a site that has since switched to rotating mode', () => {
  const site = makeSite({ qr_mode: 'printed' });
  const { token, sig } = signStaticToken(site);
  const switchedSite = { ...site, qr_mode: 'rotating' };
  const result = verifyToken({ token, sig, site: switchedSite });
  expect(result.valid).toBe(false);
});

test('rotating token: the current bucket verifies successfully', () => {
  const site = makeSite({ qr_mode: 'rotating' });
  const now = Date.now();
  const { token, sig } = signRotatingToken(site, now);
  const result = verifyToken({ token, sig, site });
  expect(result.valid).toBe(true);
  expect(result.method).toBe('qr_rotating');
});

test('rotating token: the immediately-previous 30s bucket still verifies (display/scan clock skew tolerance)', () => {
  const site = makeSite({ qr_mode: 'rotating' });
  const now = Date.now();
  const { token, sig } = signRotatingToken(site, now - 30000);
  const result = verifyToken({ token, sig, site });
  expect(result.valid).toBe(true);
});

test('rotating token: expired (2+ buckets old, ~60s+) is rejected — this is the "stops a shared photo" property', () => {
  const site = makeSite({ qr_mode: 'rotating' });
  const now = Date.now();
  const { token, sig } = signRotatingToken(site, now - 90000); // 3 buckets ago
  const result = verifyToken({ token, sig, site });
  expect(result.valid).toBe(false);
  expect(result.reason).toMatch(/expired/);
});

test('rotating token: a token from the future bucket (clock skew the wrong way) is rejected, not accepted early', () => {
  const site = makeSite({ qr_mode: 'rotating' });
  const now = Date.now();
  const { token, sig } = signRotatingToken(site, now + 60000);
  const result = verifyToken({ token, sig, site });
  expect(result.valid).toBe(false);
});

test('a rotating token is rejected against a site that has since switched to printed mode', () => {
  const site = makeSite({ qr_mode: 'rotating' });
  const { token, sig } = signRotatingToken(site);
  const switchedSite = { ...site, qr_mode: 'printed' };
  const result = verifyToken({ token, sig, site: switchedSite });
  expect(result.valid).toBe(false);
});

test('malformed token (not 2 or 3 dot-separated parts) is rejected', () => {
  const site = makeSite();
  const malformed = 'just-one-segment';
  const crypto = require('crypto');
  const sig = crypto.createHmac('sha256', process.env.ATTENDANCE_QR_SECRET).update(malformed).digest('hex');
  const result = verifyToken({ token: malformed, sig, site });
  expect(result.valid).toBe(false);
});

test('missing token or signature is rejected without throwing', () => {
  const site = makeSite();
  expect(verifyToken({ token: '', sig: '', site }).valid).toBe(false);
  expect(verifyToken({ token: null, sig: null, site }).valid).toBe(false);
});
