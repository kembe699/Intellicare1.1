/**
 * Sales tax on bills — tax added on top of the price.
 *
 * Each taxable line gets a companion tax line right after it:
 *   { isTax: true, taxFor: <the item's line_id>, taxRateId, taxRate,
 *     revenue_account_id: <the tax's liability account>, totalPrice: <tax> }
 *
 * A separate line (rather than tax folded into the item's price) keeps every
 * existing path working unchanged: the bill total is the sum of its lines, a
 * payment of the item pays its tax line too (the bill screens select both),
 * the receipt lists it, and the ledger posting credits each line's
 * revenue_account_id — so tax lands in VAT Payable, never in revenue.
 *
 * Which tax applies to a line: the item's own override (exempt, or its own
 * rate), else its category's tax, else none.
 */
const { v4: uuidv4 } = require('uuid');

/** SQL condition (alias c = chart_of_accounts) for "a revenue account, or an account a tax posts to". */
const REVENUE_OR_TAX_ACCOUNT_SQL = `(c.account_type = 'revenue' OR c.id::text IN (SELECT account_id::text FROM tax_rates WHERE account_id IS NOT NULL))`;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const CATALOGS = [
  { table: 'services', id: 'id' },
  { table: 'inventory_items', id: 'id' },
  { table: 'lab_tests', id: 'id' },
];

async function loadActiveRates(db) {
  try {
    const [rows] = await db.query(`SELECT id, name, code, rate, account_id FROM tax_rates WHERE is_active = true`);
    return new Map(rows.map((r) => [String(r.id), r]));
  } catch {
    return new Map(); // tax tables not created yet on this tenant — no tax
  }
}

/** The tax rate row that applies to a bill line, or null. */
async function resolveTaxForLine(db, line, rates, cache = new Map()) {
  if (!line || line.isTax || line.isVoided || !rates.size) return null;
  const serviceId = line.serviceId ?? line.service_id;
  if (serviceId == null || serviceId === '') return null;
  const key = String(serviceId);
  if (!cache.has(key)) {
    let found = null;
    for (const { table } of CATALOGS) {
      try {
        const [[row]] = await db.query(
          `SELECT t.tax_rate_id, t.tax_exempt, c.tax_rate_id AS category_tax_rate_id
             FROM ${table} t LEFT JOIN categories c ON c.id::text = t.category_id::text
            WHERE t.id::text = :id LIMIT 1`,
          { replacements: { id: key } }
        );
        if (row) { found = row; break; }
      } catch { /* table/column missing on this tenant — try the next catalogue */ }
    }
    cache.set(key, found);
  }
  const row = cache.get(key);
  if (!row || row.tax_exempt) return null;
  const rateId = row.tax_rate_id || row.category_tax_rate_id;
  return rateId ? rates.get(String(rateId)) || null : null;
}

/**
 * Returns the services array with a tax line after every taxable line that
 * doesn't have one yet. Idempotent: lines already taxed (a companion with
 * taxFor = their line_id exists) are left alone, so a bill can be re-run
 * through this on every write.
 */
async function addTaxLines(db, services) {
  if (!Array.isArray(services) || !services.length) return services;
  const rates = await loadActiveRates(db);
  if (!rates.size) return services;
  const taxedIds = new Set(services.filter((l) => l?.isTax && l.taxFor).map((l) => String(l.taxFor)));
  const cache = new Map();
  const out = [];
  for (const line of services) {
    out.push(line);
    if (!line || line.isTax || line.isVoided) continue;
    if (line.line_id && taxedIds.has(String(line.line_id))) continue;
    const tax = await resolveTaxForLine(db, line, rates, cache);
    if (!tax) continue;
    const base = Number(line.totalPrice ?? line.total_price ?? 0) || 0;
    const amount = round2(base * (Number(tax.rate) || 0) / 100);
    if (amount <= 0) continue;
    if (!line.line_id) line.line_id = uuidv4();
    const name = line.serviceName || line.name || line.service_name || 'item';
    out.push({
      line_id: uuidv4(),
      isTax: true,
      taxFor: line.line_id,
      taxRateId: tax.id,
      taxName: tax.name,
      taxRate: Number(tax.rate),
      serviceName: `${tax.name} ${Number(tax.rate)}% — ${name}`,
      quantity: 1,
      unitPrice: amount,
      totalPrice: amount,
      category: 'Tax',
      revenue_account_id: tax.account_id || null,
      // Same currency as the item it taxes, so the bill total converts both alike.
      ...(line.currency ? { currency: line.currency } : {}),
    });
  }
  return out;
}

/** Sum of a bill's live tax lines. */
function taxTotal(services) {
  return round2((services || []).filter((l) => l && l.isTax && !l.isVoided).reduce((s, l) => s + (Number(l.totalPrice) || 0), 0));
}

module.exports = { addTaxLines, resolveTaxForLine, loadActiveRates, taxTotal, REVENUE_OR_TAX_ACCOUNT_SQL };
