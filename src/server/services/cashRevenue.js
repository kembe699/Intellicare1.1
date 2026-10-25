/**
 * Cash-basis revenue: every amount of money received against patient bills in
 * a period, and how much of it is revenue versus tax collected.
 *
 * Money arrives three ways, and all three count:
 *   - patient receipts at the counter (receipts; refunds count against them),
 *   - invoice payments on credit invoices (invoice_payments),
 *   - insurer claim payments (the claim's ledger entry, shared over the
 *     claim's bills in proportion to each bill's claimed amount).
 * Reading receipts alone left an insurer's payment out of cash revenue
 * entirely. Every amount is in base currency: a bill in another currency is
 * converted at its booked rate (utils/bookedRate.js).
 *
 * Tax is not revenue. Each payment carries the bill's tax in proportion —
 * tax lines ÷ bill total — and that share is reported as tax collected (a
 * liability); only the rest is spread over revenue. Spreading the whole
 * payment over revenue lines put a drug bill's VAT into consultation revenue.
 *
 * Every grouping (scheme, branch, payment mode, item, department, account)
 * starts from the same per-payment revenue amounts, so they all add up to
 * the same total.
 */
const { bookedRateSql } = require('../utils/bookedRate');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const parseLines = (s) => { try { const v = typeof s === 'string' ? JSON.parse(s) : s; return Array.isArray(v) ? v : []; } catch { return []; } };
const isTaxLine = (l) => l?.isTax === true || String(l?.category || '').toLowerCase() === 'tax';

/**
 * Money received in [dateFrom, dateTo] against bills, one row per movement:
 * { billId, source, method, branchId, clinicId, day, amount (base) }.
 */
async function cashMovements(sequelize, { clinicId = null, dateFrom, dateTo, branchId = null }) {
  const rate = bookedRateSql('pb');
  const r = { dateFrom, dateTo, clinicId, branchId };
  const clinic = (col) => (clinicId ? ` AND ${col} = :clinicId` : '');
  const branch = (col) => (branchId ? ` AND ${col} = :branchId` : '');
  const [rows] = await sequelize.query(`
    SELECT rc.bill_id::text AS bill_id, 'receipt' AS source, COALESCE(rc.payment_method::text, 'unknown') AS method, rc.branch_id,
           COALESCE(NULLIF(rc.base_currency_amount, 0), rc.payment_amount * ${rate}) AS amount, rc.payment_date::date AS day, pb.clinic_id
      FROM receipts rc JOIN patient_bills pb ON pb.id::text = rc.bill_id::text
     WHERE rc.status = 'active' AND rc.payment_date::date BETWEEN :dateFrom AND :dateTo${clinic('rc.clinic_id')}${branch('rc.branch_id')}
    UNION ALL
    SELECT rc.bill_id::text, 'refund', 'refund'::text, rc.branch_id, -COALESCE(rc.refund_amount, 0) * ${rate}, rc.refund_date::date, pb.clinic_id
      FROM receipts rc JOIN patient_bills pb ON pb.id::text = rc.bill_id::text
     WHERE COALESCE(rc.refund_amount, 0) > 0 AND rc.refund_date::date BETWEEN :dateFrom AND :dateTo${clinic('rc.clinic_id')}${branch('rc.branch_id')}
    UNION ALL
    SELECT pb.id::text, 'invoice_payment', COALESCE(ip.payment_method::text, 'unknown'), pb.branch_id, ip.amount * ${rate}, ip.payment_date::date, pb.clinic_id
      FROM invoice_payments ip JOIN invoices i ON i.id::text = ip.invoice_id::text JOIN patient_bills pb ON pb.id::text = i.bill_id::text
     WHERE ip.payment_date::date BETWEEN :dateFrom AND :dateTo${clinic('pb.clinic_id')}${branch('pb.branch_id')}
    UNION ALL
    SELECT pb.id::text, 'claim_payment', 'insurance'::text, pb.branch_id,
           cp.amount * COALESCE(ci.amount, pb.total_amount) / NULLIF(SUM(COALESCE(ci.amount, pb.total_amount)) OVER (PARTITION BY cp.claim_id), 0),
           cp.day, pb.clinic_id
      FROM (SELECT gl.reference_id AS claim_id, SUM(gl.base_total_debit) AS amount, MIN(gl.transaction_date::date) AS day
              FROM general_ledger gl
             WHERE gl.reference_module = 'insurance_claims' AND gl.transaction_date::date BETWEEN :dateFrom AND :dateTo
             GROUP BY 1) cp
      JOIN insurance_batch_claim_items ci ON ci.claim_id::text = cp.claim_id
      LEFT JOIN invoices ciinv ON ciinv.id::text = ci.invoice_id::text
      -- an item names its bill, or reaches it through its invoice
      JOIN patient_bills pb ON pb.id::text = COALESCE(ci.bill_id::text, ciinv.bill_id::text)
     WHERE TRUE${clinic('pb.clinic_id')}${branch('pb.branch_id')}`,
    { replacements: r });
  const dayOf = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d || '').slice(0, 10));
  return rows.map((m) => ({ billId: m.bill_id, source: m.source, method: m.method, branchId: m.branch_id, clinicId: m.clinic_id, day: dayOf(m.day), amount: round2(m.amount) }))
    .filter((m) => m.amount !== 0);
}

/** The bills those movements belong to, with their lines in base currency. */
async function billsFor(sequelize, billIds) {
  if (!billIds.length) return new Map();
  const [rows] = await sequelize.query(`
    SELECT pb.id::text AS id, pb.scheme_id, ps.scheme_name, pb.total_amount, pb.services, pb.branch_id, b.name AS branch_name,
           ${bookedRateSql('pb')} AS rate
      FROM patient_bills pb
      LEFT JOIN patient_schemes ps ON ps.id::text = pb.scheme_id::text
      LEFT JOIN branches b ON b.id = pb.branch_id
     WHERE pb.id::text IN (:ids)`, { replacements: { ids: billIds } });
  const out = new Map();
  for (const b of rows) {
    const lines = parseLines(b.services).filter((l) => l && !l.isVoided)
      .map((l) => ({ line: l, amount: num(l.totalPrice ?? l.total_price ?? num(l.unitPrice ?? l.price) * (num(l.quantity) || 1)) }));
    const total = lines.reduce((s, x) => s + x.amount, 0) || num(b.total_amount);
    const tax = lines.filter((x) => isTaxLine(x.line)).reduce((s, x) => s + x.amount, 0);
    out.set(b.id, { ...b, lines, taxRatio: total > 0 ? Math.min(Math.max(tax / total, 0), 1) : 0 });
  }
  return out;
}

/**
 * Movements split into revenue and tax: each movement gets `revenue` and `tax`
 * (base currency), using its bill's tax ratio. Returns { movements, bills }.
 */
async function cashReceived(sequelize, opts) {
  const movements = await cashMovements(sequelize, opts);
  const bills = await billsFor(sequelize, [...new Set(movements.map((m) => m.billId))]);
  for (const m of movements) {
    const ratio = bills.get(m.billId)?.taxRatio || 0;
    m.tax = round2(m.amount * ratio);
    m.revenue = round2(m.amount - m.tax);
  }
  return { movements, bills };
}

/**
 * Revenue spread over a bill's non-tax lines in proportion to their amounts
 * (what the payment paid for). Returns [{ line, amount }].
 */
function spreadOverLines(bill, revenue) {
  const lines = (bill?.lines || []).filter((x) => !isTaxLine(x.line) && x.amount !== 0);
  const total = lines.reduce((s, x) => s + x.amount, 0);
  if (!lines.length || total === 0) return [{ line: { serviceName: 'Unclassified' }, amount: revenue }];
  let left = round2(revenue);
  return lines.map((x, i) => {
    const amount = i === lines.length - 1 ? left : round2(revenue * (x.amount / total));
    left = round2(left - amount);
    return { line: x.line, amount };
  });
}

/** Revenue account → department, the same rule as the income statement by department. */
async function accountDepartments(sequelize, clinicId) {
  try {
    const [rows] = await sequelize.query(`
      WITH cat_use AS (
        SELECT c.revenue_account_id, d.department_name,
               1 + COALESCE((SELECT COUNT(*) FROM inventory_items i WHERE i.category_id = c.id), 0)
                 + COALESCE((SELECT COUNT(*) FROM services sv WHERE sv.category_id = c.id), 0) AS weight
          FROM categories c JOIN departments d ON d.id::text = c.department_id::text
         WHERE c.clinic_id = :clinicId AND c.is_active AND c.revenue_account_id IS NOT NULL
      )
      SELECT DISTINCT ON (revenue_account_id) revenue_account_id::text AS acct, department_name AS dept
        FROM (SELECT revenue_account_id, department_name, SUM(weight) AS w FROM cat_use GROUP BY 1, 2) t
       ORDER BY revenue_account_id, w DESC, department_name`, { replacements: { clinicId } });
    return new Map(rows.map((r) => [r.acct, r.dept]));
  } catch {
    return new Map();
  }
}

module.exports = { cashReceived, spreadOverLines, accountDepartments, isTaxLine, round2 };
