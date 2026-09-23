const fs = require('fs');
const path = require('path');
const { query, getSequelize, closeConnection, uuid } = require('../setup/testDb');
const { ensureClinicalInsightsTable } = require('../../src/server/config/ensureClinicalInsightsTable');
const { ensureBranchIsolationColumns } = require('../../src/server/config/ensureBranchIsolationColumns');
const ClinicalInsightsService = require('../../src/server/services/ClinicalInsightsService');
const { DEFAULT_ROLE_PRIVILEGES } = require('../../src/server/config/permissionsCatalog');

// Same 't-' prefixed, 36-char id scheme as tests/setup/testData.js — see its
// own comment for why the length must be exact for a CHAR(36)/VARCHAR(36) column.
function testId() {
  const raw = (uuid() + uuid()).replace(/-/g, '');
  return 't-' + raw.slice(0, 34);
}

const PATIENT_FIRST_NAME = 'Nyibol';
const PATIENT_LAST_NAME = 'Deng';
const PATIENT_PHONE = '0912345678';
const PATIENT_DOB = '1998-05-01';

let participantId;
let orderId;
let specimenId;

beforeAll(async () => {
  const sequelize = getSequelize();
  await ensureClinicalInsightsTable(sequelize);
  // buildDeidentifiedPayload reads lis_test_orders.branch_id — present on
  // every real tenant (the ongoing branch-isolation work), but this test
  // schema predates that migration, so ensure it here the same way tenantDb.js
  // does per-tenant in production.
  await ensureBranchIsolationColumns(sequelize, 'tenant_test');

  participantId = testId();
  orderId = testId();
  specimenId = testId();

  await query(
    `INSERT INTO lis_participants (id, participant_number, first_name, last_name, gender, date_of_birth, phone)
     VALUES (:id, :pn, :fn, :ln, :gender, :dob, :phone)`,
    { id: participantId, pn: `TESTPTN-${testId().slice(-8)}`, fn: PATIENT_FIRST_NAME, ln: PATIENT_LAST_NAME, gender: 'female', dob: PATIENT_DOB, phone: PATIENT_PHONE }
  );

  await query(
    `INSERT INTO lis_test_orders (id, participant_id, status, clinical_notes, vitals, clinic_id)
     VALUES (:id, :pid, 'ordered', :notes, :vitals, :clinicId)`,
    {
      id: orderId,
      pid: participantId,
      // Free-text fields carrying an identifier the way real handwritten notes sometimes do —
      // exactly what redaction in buildDeidentifiedPayload needs to strip.
      notes: `Patient ${PATIENT_FIRST_NAME} ${PATIENT_LAST_NAME} called on ${PATIENT_PHONE} about ongoing fever.`,
      vitals: JSON.stringify({
        chief_complaints: ['Fever for 3 days'],
        medical_history: `No known chronic conditions. Reachable on ${PATIENT_PHONE.replace('091', '099')} if needed.`,
        pulse: 130, respiratory_rate: 26, temperature: 39.2, spo2: 96, blood_pressure: '110/70',
      }),
      clinicId: '1',
    }
  );

  await query(
    `INSERT INTO lis_specimens (id, order_id, test_code, test_name, barcode, status)
     VALUES (:id, :orderId, 'MAL-RDT', 'Malaria RDT', :barcode, 'approved')`,
    { id: specimenId, orderId, barcode: `BC${testId().slice(-10)}` }
  );

  await query(
    `INSERT INTO lis_results (id, specimen_id, test_code, analyte, value, unit, flag, status)
     VALUES (:id, :specimenId, 'MAL-RDT', 'Malaria Antigen', 'Positive', '', 'high', 'approved')`,
    { id: testId(), specimenId }
  );
});

afterAll(async () => {
  await query(`DELETE FROM clinical_insights WHERE order_id = :orderId`, { orderId });
  await query(`DELETE FROM lis_results WHERE specimen_id = :specimenId`, { specimenId });
  await query(`DELETE FROM lis_specimens WHERE id = :specimenId`, { specimenId });
  await query(`DELETE FROM lis_test_orders WHERE id = :orderId`, { orderId });
  await query(`DELETE FROM lis_participants WHERE id = :participantId`, { participantId });
  await closeConnection();
});

describe('Clinical Insights', () => {
  describe('De-identification', () => {
    test('the built payload contains no name, patient ID, phone, or exact date of birth', async () => {
      const sequelize = getSequelize();
      const payload = await ClinicalInsightsService.buildDeidentifiedPayload(sequelize, orderId);
      const json = JSON.stringify(payload);

      expect(json).not.toMatch(new RegExp(PATIENT_FIRST_NAME, 'i'));
      expect(json).not.toMatch(new RegExp(PATIENT_LAST_NAME, 'i'));
      expect(json).not.toContain(PATIENT_PHONE);
      expect(json).not.toContain(participantId);
      expect(json).not.toContain(PATIENT_DOB);

      // What SHOULD be there — de-identified doesn't mean empty.
      expect(payload.age).toBeGreaterThan(0);
      expect(payload.sex).toBe('female');
      expect(payload.vitals.length).toBeGreaterThan(0);
      expect(payload.lab_results.length).toBeGreaterThan(0);
    });

    test('redactFreeText strips a name (whole-word) and a phone-shaped number', () => {
      const redacted = ClinicalInsightsService.redactFreeText(
        `Called ${PATIENT_FIRST_NAME} ${PATIENT_LAST_NAME} on ${PATIENT_PHONE} today`,
        PATIENT_FIRST_NAME,
        PATIENT_LAST_NAME
      );
      expect(redacted).not.toMatch(new RegExp(PATIENT_FIRST_NAME));
      expect(redacted).not.toMatch(new RegExp(PATIENT_LAST_NAME));
      expect(redacted).not.toContain(PATIENT_PHONE);
      expect(redacted).toContain('[redacted]');
    });

    test('redactFreeText does not mangle unrelated text with no identifiers', () => {
      const text = 'Mild abdominal tenderness on palpation, no rebound.';
      expect(ClinicalInsightsService.redactFreeText(text, 'Nyibol', 'Deng')).toBe(text);
    });
  });

  describe('JSON schema validation', () => {
    test('accepts the mock response as valid', () => {
      const { data, error } = ClinicalInsightsService.parseAndValidate(JSON.stringify(ClinicalInsightsService.MOCK_RESPONSE));
      expect(error).toBeUndefined();
      expect(Array.isArray(data.urgent_flags)).toBe(true);
      expect(Array.isArray(data.differentials)).toBe(true);
    });

    test('rejects malformed JSON rather than showing broken output', () => {
      const { data, error } = ClinicalInsightsService.parseAndValidate('not valid json {{{');
      expect(data).toBeUndefined();
      expect(error).toBe('Model did not return valid JSON');
    });

    test('rejects more than 5 differentials', () => {
      const bad = { ...ClinicalInsightsService.MOCK_RESPONSE, differentials: Array(6).fill(ClinicalInsightsService.MOCK_RESPONSE.differentials[0]) };
      const { error } = ClinicalInsightsService.parseAndValidate(JSON.stringify(bad));
      expect(error).toMatch(/must not exceed 5/);
    });

    test('rejects an invalid confidence value', () => {
      const bad = JSON.parse(JSON.stringify(ClinicalInsightsService.MOCK_RESPONSE));
      bad.differentials[0].confidence = 'certain';
      const { error } = ClinicalInsightsService.parseAndValidate(JSON.stringify(bad));
      expect(error).toMatch(/confidence/);
    });

    test('rejects a response missing data_limitations', () => {
      const bad = { urgent_flags: [], differentials: [] };
      const { error } = ClinicalInsightsService.parseAndValidate(JSON.stringify(bad));
      expect(error).toMatch(/data_limitations/);
    });

    test('accepts a response wrapped in a ```json fence — a real, common model quirk', () => {
      const fenced = '```json\n' + JSON.stringify(ClinicalInsightsService.MOCK_RESPONSE) + '\n```';
      const { data, error } = ClinicalInsightsService.parseAndValidate(fenced);
      expect(error).toBeUndefined();
      expect(data.differentials.length).toBeGreaterThan(0);
    });

    test('accepts a response with a stray sentence before/after the JSON', () => {
      const wrapped = 'Here is my assessment:\n' + JSON.stringify(ClinicalInsightsService.MOCK_RESPONSE) + '\nLet me know if you need more detail.';
      const { data, error } = ClinicalInsightsService.parseAndValidate(wrapped);
      expect(error).toBeUndefined();
      expect(data.urgent_flags.length).toBeGreaterThan(0);
    });
  });

  describe('Permissions', () => {
    test('lis.clinical.insights.write is granted only to admin and doctor by default', () => {
      expect(DEFAULT_ROLE_PRIVILEGES['lis.clinical.insights.write']).toEqual(['admin', 'doctor']);
    });

    test('both routes are gated behind lis.clinical.insights.write', () => {
      const src = fs.readFileSync(path.join(__dirname, '../../src/server/routes/clinicalInsights.js'), 'utf8');
      expect(src).toMatch(/router\.post\(\s*'\/:orderId\/clinical-insights',\s*authorize\('lis\.clinical\.insights\.write'\)/);
      expect(src).toMatch(/router\.get\(\s*'\/:orderId\/clinical-insights',\s*authorize\('lis\.clinical\.insights\.write'\)/);
    });

    test('both routes check branch/clinic ownership before returning data', () => {
      const src = fs.readFileSync(path.join(__dirname, '../../src/server/routes/clinicalInsights.js'), 'utf8');
      const matches = src.match(/BranchQueryFilter\.canAccessRecord\(order, req\.branchContext\)/g) || [];
      expect(matches.length).toBe(2);
    });
  });

  describe('Caching / regenerate (mock mode)', () => {
    const originalMock = process.env.CLINICAL_INSIGHTS_MOCK;
    const originalNodeEnv = process.env.NODE_ENV;

    beforeAll(() => {
      process.env.CLINICAL_INSIGHTS_MOCK = 'true';
      process.env.NODE_ENV = 'test';
    });

    afterAll(() => {
      process.env.CLINICAL_INSIGHTS_MOCK = originalMock;
      process.env.NODE_ENV = originalNodeEnv;
    });

    test('generateInsights completes in mock mode and is readable back as one cached row', async () => {
      const sequelize = getSequelize();
      const first = await ClinicalInsightsService.generateInsights(sequelize, {
        orderId, requestedBy: 1, clinicId: '1', branchId: null,
      });
      expect(first.status).toBe('pending');

      // The generation itself runs fire-and-forget; give it a moment to settle
      // (mock mode has no real network call, so this is fast).
      await new Promise((r) => setTimeout(r, 300));

      const [[row]] = await sequelize.query(`SELECT * FROM clinical_insights WHERE id = ?`, { replacements: [first.id] });
      expect(row.status).toBe('completed');
      expect(row.model).toContain('mock');

      const [[latest]] = await sequelize.query(
        `SELECT id, status FROM clinical_insights WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`,
        { replacements: [orderId] }
      );
      expect(latest.id).toBe(first.id);
      expect(latest.status).toBe('completed');
    });

    test('regenerate inserts a new row rather than overwriting the previous one', async () => {
      const sequelize = getSequelize();
      const [[{ count: countBefore }]] = await sequelize.query(
        `SELECT COUNT(*) as count FROM clinical_insights WHERE order_id = ?`,
        { replacements: [orderId] }
      );

      const second = await ClinicalInsightsService.generateInsights(sequelize, {
        orderId, requestedBy: 1, clinicId: '1', branchId: null,
      });
      await new Promise((r) => setTimeout(r, 300));

      const [[{ count: countAfter }]] = await sequelize.query(
        `SELECT COUNT(*) as count FROM clinical_insights WHERE order_id = ?`,
        { replacements: [orderId] }
      );
      expect(parseInt(countAfter, 10)).toBe(parseInt(countBefore, 10) + 1);

      const [[secondRow]] = await sequelize.query(`SELECT status FROM clinical_insights WHERE id = ?`, { replacements: [second.id] });
      expect(secondRow.status).toBe('completed');
    });
  });
});
