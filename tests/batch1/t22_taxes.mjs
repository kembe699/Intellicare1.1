// Sales tax: a category's tax is added on top of the price as its own bill line, posts to
// 2300 VAT Payable (never revenue), is voided with its item, and stays out of revenue earned.
import { AFTER, call, q, done, newPatient, newBill, serviceByName, line, ensureShift, pay, check, summary } from './lib.mjs';

const svc = await serviceByName('Consultation - General Practitioner');
const [svcRow] = await q('SELECT category_id::text cat, tax_rate_id, tax_exempt FROM services WHERE id = $1', [svc.id]);
const [cat] = await q('SELECT id::text id, tax_rate_id FROM categories WHERE id::text = $1', [svcRow.cat]);
const [vatAcct] = await q("SELECT id, is_active FROM chart_of_accounts WHERE account_code = '2300'");
const glLines = (billId, code) => q(`SELECT COALESCE(SUM(al.credit_amount - al.debit_amount),0)::float net FROM account_ledger al
  JOIN chart_of_accounts c ON c.id = al.account_id JOIN general_ledger gl ON gl.id = al.transaction_id
  WHERE gl.reference_id::text = $1 AND c.account_code = $2`, [String(billId), code]).then((r) => r[0].net);
const revenueNet = (billId) => q(`SELECT COALESCE(SUM(al.credit_amount - al.debit_amount),0)::float net FROM account_ledger al
  JOIN chart_of_accounts c ON c.id = al.account_id AND c.account_type = 'revenue' JOIN general_ledger gl ON gl.id = al.transaction_id
  WHERE gl.reference_id::text = $1`, [String(billId)]).then((r) => r[0].net);

const created = await call(AFTER, 'POST', '/tax-rates', { name: 'VAT', code: 'T22', rate: 18 });
const taxId = created.body.id;
try {
  check('tax type added; 2300 VAT Payable switched on as its account',
    created.status === 201 && (await q("SELECT is_active FROM chart_of_accounts WHERE account_code = '2300'"))[0].is_active === true, JSON.stringify(created.body));
  const asg = await call(AFTER, 'PUT', '/tax-rates/assign', { kind: 'category', id: cat.id, tax_rate_id: taxId });
  check('category given the tax', asg.ok, JSON.stringify(asg.body));

  await ensureShift(AFTER);
  const pt = await newPatient(AFTER, 'T22');
  const price = parseFloat(svc.price);
  const bill = await newBill(AFTER, pt, [line(svc)]);
  const [b] = await q('SELECT total_amount::float t, services FROM patient_bills WHERE id = $1', [bill.id]);
  const lines = typeof b.services === 'string' ? JSON.parse(b.services) : b.services;
  const taxLine = lines.find((l) => l.isTax);
  const tax = Math.round(price * 0.18 * 100) / 100;
  check('bill gets a tax line on top: total = price + 18%', !!taxLine && taxLine.totalPrice === tax && b.t === price + tax && taxLine.taxFor === lines[0].line_id,
    JSON.stringify({ total: b.t, price, tax, taxLine }));
  check('ledger: tax credited to 2300, revenue only the price', (await glLines(bill.id, '2300')) === tax && (await revenueNet(bill.id)) === price,
    JSON.stringify({ vat: await glLines(bill.id, '2300'), rev: await revenueNet(bill.id) }));

  const syncCount = async () => (await q("SELECT COUNT(*)::int n FROM general_ledger WHERE reference_id::text = $1 AND reference_module = 'bill_revenue_adjustment'", [String(bill.id)]))[0].n;
  const before = await syncCount();
  await call(AFTER, 'POST', `/patient-bills/${bill.id}/payments`, { amount: 1, payment_method: 'cash', payment_date: new Date().toISOString().slice(0, 10), received_by: 'Preview Admin', currency: 'SSP' });
  check('reconciliation sees the bill as balanced (no revenue "correction" for the tax)', (await syncCount()) === before, `${before} -> ${await syncCount()}`);

  const earned = await call(AFTER, 'GET', `/reports-v2/revenue/earned?dateFrom=2026-01-01&dateTo=2026-12-31&groupBy=bill`);
  const row = (earned.body.rows || []).find((r) => r.key === bill.id);
  check('revenue earned leaves the tax out (1 paid → net share)', row && Math.abs(row.earned - 1 * (price / (price + tax))) < 0.01, JSON.stringify(row));

  // Void a taxed item on a fresh unpaid bill: its tax line goes, 2300 nets to zero.
  const pt2 = await newPatient(AFTER, 'T22');
  const bill2 = await newBill(AFTER, pt2, [line(svc), line(svc)]);
  const [b2] = await q('SELECT services FROM patient_bills WHERE id = $1', [bill2.id]);
  const l2 = typeof b2.services === 'string' ? JSON.parse(b2.services) : b2.services;
  const target = l2.find((l) => !l.isTax);
  const refused = await call(AFTER, 'POST', `/patient-bills/${bill2.id}/void-item`, { lineId: l2.find((l) => l.isTax).line_id, reason: 't22' });
  check('a tax line cannot be voided on its own', refused.status === 400, `${refused.status} ${refused.body?.error}`);
  const v = await call(AFTER, 'POST', `/patient-bills/${bill2.id}/void-item`, { lineId: target.line_id, reason: 't22' });
  const [after2] = await q('SELECT total_amount::float t, services FROM patient_bills WHERE id = $1', [bill2.id]);
  const l2b = typeof after2.services === 'string' ? JSON.parse(after2.services) : after2.services;
  check('voiding the item removes its tax line too; 2300 left with one line of tax',
    v.ok && l2b.filter((l) => l.isTax).length === 1 && after2.t === price + tax && (await glLines(bill2.id, '2300')) === tax,
    JSON.stringify({ s: v.status, e: v.body?.error, total: after2.t, taxLines: l2b.filter((l) => l.isTax).length, vat: await glLines(bill2.id, '2300') }));

  // Item override: exempt → no tax line.
  await call(AFTER, 'PUT', '/tax-rates/assign', { kind: 'service', id: svc.id, tax_exempt: true });
  const bill3 = await newBill(AFTER, await newPatient(AFTER, 'T22'), [line(svc)]);
  const [b3] = await q('SELECT total_amount::float t, services FROM patient_bills WHERE id = $1', [bill3.id]);
  const l3 = typeof b3.services === 'string' ? JSON.parse(b3.services) : b3.services;
  check('item marked exempt overrides the category: no tax line', !l3.some((l) => l.isTax) && b3.t === price, JSON.stringify({ total: b3.t }));
} finally {
  await q('UPDATE services SET tax_rate_id = $2, tax_exempt = $3 WHERE id = $1', [svc.id, svcRow.tax_rate_id, svcRow.tax_exempt]);
  await q('UPDATE categories SET tax_rate_id = $2 WHERE id::text = $1', [cat.id, cat.tax_rate_id]);
  await q('UPDATE tax_rates SET is_active = false WHERE id = $1', [taxId]);
  await q('UPDATE chart_of_accounts SET is_active = $2 WHERE id = $1', [vatAcct.id, vatAcct.is_active]);
}
await done();
process.exit(summary() ? 1 : 0);
