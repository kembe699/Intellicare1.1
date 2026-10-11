/**
 * "Done when" criterion from the Book a Demo spec: two simultaneous bookings
 * for the same slot cannot both succeed. The free-slot check in
 * routes/publicBookDemo.js is only a fast path — the actual guarantee is the
 * partial unique index (demo_bookings_slot_unique, on (booking_date,
 * start_time) WHERE status != 'cancelled'), created in
 * models/platform/index.js's initializePlatformDatabase(). This hits that
 * real index directly via two concurrent DemoBooking.create() calls for the
 * identical slot, bypassing the pre-check so the race is actually exercised.
 *
 * Runs against the local test Postgres's own `public` schema (same instance
 * tests/setup/testDb.js uses for tenant_test — see src/server/.env /
 * .env.test, both point at 127.0.0.1:5434 on this machine), never a
 * production database. All rows this file writes are tagged with a unique
 * facility_name prefix and deleted in afterAll/afterEach, scoped by that tag
 * plus the test's own date, so a real admin's data already in that schema is
 * never touched.
 */
const { DemoBooking, ensureDemoBookingSchema } = require('../../src/server/models/platform');
const platformSequelize = require('../../src/server/config/platformDatabase');
const { jubaTodayString, addDaysToDateString } = require('../../src/server/utils/demoBookingSlots');

const TAG = `JEST-DOUBLEBOOK-${Date.now()}`;
// Tests 1 & 2 write straight to the model, bypassing settings entirely, so a
// far-future date that can never collide with real data is safest for them.
const DATE = '2099-06-15';
// Test 3 goes through the real POST handler, which checks the (possibly
// admin-configured) settings singleton — a near date is far more likely to
// fall within whatever max_advance_days is actually set.
const NEAR_DATE = addDaysToDateString(jubaTodayString(), 5);

function handlerFor(router, routePath, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

beforeAll(async () => {
  await ensureDemoBookingSchema();
});

afterAll(async () => {
  await DemoBooking.destroy({ where: { facility_name: TAG } });
  await platformSequelize.close();
});

test('two concurrent creates for the identical (date, start_time) — only one succeeds', async () => {
  const attempt = (n) => DemoBooking.create({
    booking_date: DATE,
    start_time: '09:00',
    end_time: '09:30',
    full_name: `Racer ${n}`,
    email: `racer${n}@example.com`,
    phone: '+211900000000',
    facility_name: TAG,
    facility_type: 'Hospital',
    location_city: 'Juba',
    demo_type: 'Online',
  }).then(() => ({ ok: true })).catch((err) => ({ ok: false, err }));

  const [a, b] = await Promise.all([attempt(1), attempt(2)]);
  const results = [a, b];

  expect(results.filter((r) => r.ok).length).toBe(1);
  const failure = results.find((r) => !r.ok);
  expect(failure.err.name === 'SequelizeUniqueConstraintError' || failure.err.original?.code === '23505').toBe(true);

  const rows = await DemoBooking.findAll({ where: { facility_name: TAG, booking_date: DATE, start_time: '09:00' } });
  expect(rows.length).toBe(1);
});

test('cancelling a booking frees the slot for a new one at the same date/time', async () => {
  const first = await DemoBooking.create({
    booking_date: DATE,
    start_time: '10:00',
    end_time: '10:30',
    full_name: 'First',
    email: 'first@example.com',
    phone: '+211900000001',
    facility_name: TAG,
    facility_type: 'Clinic',
    location_city: 'Juba',
    demo_type: 'In person',
  });

  // While it's still active, a second create for the same slot must fail.
  await expect(DemoBooking.create({
    booking_date: DATE,
    start_time: '10:00',
    end_time: '10:30',
    full_name: 'Blocked',
    email: 'blocked@example.com',
    phone: '+211900000002',
    facility_name: TAG,
    facility_type: 'Clinic',
    location_city: 'Juba',
    demo_type: 'In person',
  })).rejects.toThrow();

  first.status = 'cancelled';
  await first.save();

  // Now that it's cancelled, the same slot is free again.
  const second = await DemoBooking.create({
    booking_date: DATE,
    start_time: '10:00',
    end_time: '10:30',
    full_name: 'Second',
    email: 'second@example.com',
    phone: '+211900000003',
    facility_name: TAG,
    facility_type: 'Clinic',
    location_city: 'Juba',
    demo_type: 'In person',
  });
  expect(second.id).toBeTruthy();
});

test('POST /api/public/book-demo on a collision returns 409 slot_taken, not a 500', async () => {
  const router = require('../../src/server/routes/publicBookDemo');
  const postHandler = handlerFor(router, '/', 'post');

  // Pre-seed one booking for this slot so the handler's own free-slot check
  // (not just the index) also rejects it — proving the friendly 409 path,
  // not just the raw constraint violation.
  await DemoBooking.create({
    booking_date: NEAR_DATE,
    start_time: '11:00',
    end_time: '11:30',
    full_name: 'Existing',
    email: 'existing@example.com',
    phone: '+211900000004',
    facility_name: TAG,
    facility_type: 'Pharmacy',
    location_city: 'Juba',
    demo_type: 'Online',
  });

  const req = {
    body: {
      date: NEAR_DATE,
      start_time: '11:00',
      full_name: 'Latecomer',
      email: 'latecomer@example.com',
      phone: '+211900000005',
      facility_name: TAG,
      facility_type: 'Pharmacy',
      location_city: 'Juba',
      demo_type: 'Online',
    },
  };
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };

  await postHandler(req, res);

  expect(res.statusCode).toBe(409);
  expect(res.body.error).toBe('slot_taken');
});
