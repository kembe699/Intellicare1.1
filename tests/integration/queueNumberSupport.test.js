/**
 * getNextQueueNumber — the counter behind the LIS Registration queue
 * receipt's "Queue Number". Same INSERT ... ON CONFLICT DO UPDATE ...
 * RETURNING technique DocumentNumberService.js uses for GL/JE numbers, so
 * this proves the same guarantee holds here: concurrent allocations for the
 * same clinic+branch+day never collide, and different branches/clinics never
 * share a sequence.
 */
const { getSequelize, query, closeConnection } = require('../setup/testDb');
const { ensureQueueNumberSupport, getNextQueueNumber } = require('../../src/server/config/ensureQueueNumberSupport');

const CLINIC_A = 1;
const BRANCH_A = 900101;
const BRANCH_B = 900102;

let sequelize;

beforeAll(async () => {
  sequelize = getSequelize();
  await ensureQueueNumberSupport(sequelize);
});

afterEach(async () => {
  await query(`DELETE FROM queue_number_counters WHERE clinic_id = :clinicId AND branch_id IN (:a, :b)`, { clinicId: CLINIC_A, a: BRANCH_A, b: BRANCH_B });
});

afterAll(async () => {
  await closeConnection();
});

test('allocates 1, 2, 3... sequentially for the same clinic+branch', async () => {
  const n1 = await sequelize.transaction((t) => getNextQueueNumber(sequelize, { clinicId: CLINIC_A, branchId: BRANCH_A, transaction: t }));
  const n2 = await sequelize.transaction((t) => getNextQueueNumber(sequelize, { clinicId: CLINIC_A, branchId: BRANCH_A, transaction: t }));
  const n3 = await sequelize.transaction((t) => getNextQueueNumber(sequelize, { clinicId: CLINIC_A, branchId: BRANCH_A, transaction: t }));
  expect([n1, n2, n3]).toEqual([1, 2, 3]);
});

test('two branches never share a sequence, even on the same day', async () => {
  const a1 = await sequelize.transaction((t) => getNextQueueNumber(sequelize, { clinicId: CLINIC_A, branchId: BRANCH_A, transaction: t }));
  const b1 = await sequelize.transaction((t) => getNextQueueNumber(sequelize, { clinicId: CLINIC_A, branchId: BRANCH_B, transaction: t }));
  const a2 = await sequelize.transaction((t) => getNextQueueNumber(sequelize, { clinicId: CLINIC_A, branchId: BRANCH_A, transaction: t }));
  expect(a1).toBe(1);
  expect(b1).toBe(1); // branch B's own sequence, independent of branch A's
  expect(a2).toBe(2);
});

test('concurrent allocations for the same clinic+branch never collide', async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      sequelize.transaction((t) => getNextQueueNumber(sequelize, { clinicId: CLINIC_A, branchId: BRANCH_A, transaction: t }))
    )
  );
  const unique = new Set(results);
  expect(unique.size).toBe(10); // every one of the 10 concurrent calls got a distinct number
  expect(Math.max(...results)).toBe(10);
});

test('a branchless caller (branchId falsy) still allocates safely, defaulted to 0', async () => {
  const n1 = await sequelize.transaction((t) => getNextQueueNumber(sequelize, { clinicId: CLINIC_A, branchId: null, transaction: t }));
  const n2 = await sequelize.transaction((t) => getNextQueueNumber(sequelize, { clinicId: CLINIC_A, branchId: null, transaction: t }));
  expect([n1, n2]).toEqual([1, 2]);
  await query(`DELETE FROM queue_number_counters WHERE clinic_id = :clinicId AND branch_id = 0`, { clinicId: CLINIC_A });
});
