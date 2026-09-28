// Backfills visit_diagnoses rows (source: 'custom', icd_code: null) for
// "Diagnosis: X" entries already embedded in lis_test_orders.clinical_notes
// from before this feature existed. Dry-run by default — pass { apply: true }
// (or --apply on the CLI) to actually write. Never rewrites clinical_notes
// itself: that text is the historical record and stays exactly as written.
//
// Idempotent: an order/description pair that already has a (non-deleted)
// visit_diagnoses row is skipped, so running this again after new visits
// have already started using the real picker is harmless.
const { sequelize: defaultSequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { diagnosisNoteLine } = require('../services/visitDiagnosesService');

// Mirrors getDiagnosesFromNotes in LISTestOrders.tsx exactly (same split/trim/
// case-insensitive-dedupe rules) so the backfilled rows are the same set the
// UI has always shown as "the diagnoses for this visit".
function extractDiagnosisSegments(notes) {
  if (!notes) return [];
  const all = String(notes).split('Diagnosis:').slice(1).map((s) => s.trim()).filter(Boolean);
  const seen = new Set();
  return all.filter((d) => {
    const key = d.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function backfillVisitDiagnoses(db = defaultSequelize, { apply = false } = {}) {
  const [orders] = await db.query(
    `SELECT id, participant_id, branch_id, clinical_notes, created_at
     FROM lis_test_orders WHERE clinical_notes LIKE '%Diagnosis:%'`
  );

  let toInsert = 0;
  let alreadyPresent = 0;
  let ordersTouched = 0;

  for (const order of orders) {
    const segments = extractDiagnosisSegments(order.clinical_notes);
    if (segments.length === 0) continue;

    // Compare against the exact text each existing row would itself produce
    // as a clinical_notes line — a coded row's own description ("Unspecified
    // malaria") never matches its clinical_notes segment ("B54 - Unspecified
    // malaria") verbatim, so comparing raw descriptions would wrongly treat
    // an already-coded diagnosis as new and insert a duplicate custom row.
    const [existingRows] = await db.query(
      `SELECT description, source, icd_code FROM visit_diagnoses WHERE order_id = :orderId AND deleted_at IS NULL`,
      { replacements: { orderId: order.id } }
    );
    const existingLower = new Set(existingRows.map((r) => diagnosisNoteLine(r).toLowerCase()));
    const [[{ count: existingCount }]] = await db.query(
      `SELECT COUNT(*)::int AS count FROM visit_diagnoses WHERE order_id = :orderId AND deleted_at IS NULL`,
      { replacements: { orderId: order.id } }
    );
    let hasPrimary = existingCount > 0;

    let touchedThisOrder = false;
    for (const seg of segments) {
      if (existingLower.has(seg.toLowerCase())) { alreadyPresent++; continue; }
      toInsert++;
      touchedThisOrder = true;
      if (apply) {
        await db.query(
          `INSERT INTO visit_diagnoses (id, order_id, participant_id, branch_id, description, is_primary, source, created_at)
           VALUES (:id, :orderId, :participantId, :branchId, :description, :isPrimary, 'custom', :createdAt)`,
          {
            replacements: {
              id: uuidv4(), orderId: order.id, participantId: order.participant_id, branchId: order.branch_id || null,
              description: seg, isPrimary: !hasPrimary, createdAt: order.created_at,
            },
          }
        );
        hasPrimary = true;
      }
    }
    if (touchedThisOrder) ordersTouched++;
  }

  console.log(`Backfill ${apply ? '(applied)' : '(DRY RUN — pass { apply: true } / --apply to write)'}:`);
  console.log(`  Orders with a "Diagnosis:" entry: ${orders.length}`);
  console.log(`  Orders that gained a row: ${ordersTouched}`);
  console.log(`  Diagnosis rows ${apply ? 'inserted' : 'that would be inserted'}: ${toInsert}`);
  console.log(`  Already present (skipped): ${alreadyPresent}`);

  return { ordersScanned: orders.length, ordersTouched, inserted: apply ? toInsert : 0, wouldInsert: toInsert, alreadyPresent };
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  backfillVisitDiagnoses(defaultSequelize, { apply })
    .then(() => process.exit(0))
    .catch((err) => { console.error('Backfill failed:', err); process.exit(1); });
}

module.exports = { backfillVisitDiagnoses, extractDiagnosisSegments };
