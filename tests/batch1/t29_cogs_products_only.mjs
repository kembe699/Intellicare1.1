// Billing posts a cost of sale for product lines only. A service or lab-test line is never costed,
// even when its name sits inside an inventory item's name ("Malaria RDT" test vs "Malaria RDT kits").
import { AFTER, call, q, done, newPatient, newBill, check, summary } from './lib.mjs';

const tag = Math.random().toString(36).slice(2, 7).toUpperCase();
const kitName = `T29 Rapid Test ${tag} kits`;
const testName = `T29 Rapid Test ${tag}`;
const [cat] = await q("SELECT id FROM categories WHERE type = 'item' AND name ILIKE 'Consumables%' LIMIT 1");
const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'inventory_items'
                        AND column_name NOT IN ('id', 'item_name', 'item_code', 'current_unit_cost', 'average_unit_cost', 'category_id', 'is_active')`)).map((r) => `"${r.column_name}"`).join(', ');
const [kit] = await q(`INSERT INTO inventory_items (id, item_name, item_code, current_unit_cost, average_unit_cost, category_id, is_active, ${cols})
  SELECT gen_random_uuid(), $1, $2, 2500, 2500, COALESCE($3, category_id), true, ${cols} FROM inventory_items WHERE is_active = true ORDER BY item_name LIMIT 1
  RETURNING id`, [kitName, `T29${tag}`, cat?.id || null]);
const svc = await call(AFTER, 'POST', '/services', { service_name: testName, category: 'Laboratory', price: 15000, is_active: true, clinic_id: 1 });
const serviceId = svc.body.id || svc.body.data?.id || (await q('SELECT id FROM services WHERE service_name = $1', [testName]))[0]?.id;

const cogs = async (billId) => Number((await q(`SELECT COALESCE(SUM(li.debit_amount),0)::float c FROM general_ledger gl JOIN gl_line_items li ON li.gl_id = gl.id
  JOIN chart_of_accounts coa ON coa.id = li.account_id WHERE gl.reference_id::text = $1 AND gl.transaction_type = 'pharmacy_bill_cogs' AND coa.account_type = 'expense'`, [String(billId)]))[0].c);
const billWith = async (line) => newBill(AFTER, await newPatient(AFTER, 'T29'), [line]);

try {
  check('setup: kit item and test service', !!kit?.id && !!serviceId, JSON.stringify({ svc: svc.status, e: svc.body?.error }));
  const b1 = await billWith({ serviceId, serviceName: testName, quantity: 1, unitPrice: 15000, totalPrice: 15000 });
  check('lab-test service line (its name is inside the kit\'s): no COGS', (await cogs(b1.id)) === 0, String(await cogs(b1.id)));
  const b2 = await billWith({ serviceName: testName, quantity: 1, unitPrice: 15000, totalPrice: 15000 });
  check('same test billed by name only: no COGS', (await cogs(b2.id)) === 0, String(await cogs(b2.id)));
  const b3 = await billWith({ serviceId: kit.id, serviceName: 'Rapid test kit (box)', quantity: 2, unitPrice: 5000, totalPrice: 10000, category: 'Pharmacy / Inventory' });
  check('product line matched by item id (different name): COGS 2 × 2,500', (await cogs(b3.id)) === 5000, String(await cogs(b3.id)));
  const b4 = await billWith({ serviceName: kitName, quantity: 1, unitPrice: 5000, totalPrice: 5000 });
  check('old free-text line naming the item: still costed, 2,500', (await cogs(b4.id)) === 2500, String(await cogs(b4.id)));
} finally {
  await q('UPDATE inventory_items SET is_active = false WHERE id = $1', [kit?.id]);
  if (serviceId) await q('UPDATE services SET is_active = false WHERE id = $1', [serviceId]);
}
await done();
process.exit(summary() ? 1 : 0);
