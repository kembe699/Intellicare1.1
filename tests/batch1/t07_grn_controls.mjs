// #7 GRN: approved/authorized POs only, no over-receipt, PO quantities move on acceptance,
// safe GRN numbering, and acceptance's ledger posting is atomic with the stock update.
import { BEFORE, AFTER, call, q, done, today, check, summary } from './lib.mjs';

const [supplier] = await q("SELECT id FROM suppliers WHERE name = 'Juba Medical Supplies Ltd' LIMIT 1");
const [itemA] = await q("SELECT id, item_code, item_name FROM inventory_items WHERE item_code = 'DRG-PCM500'");
const [itemB] = await q("SELECT id, item_code, item_name FROM inventory_items WHERE item_code = 'CON-SYR5'");

async function newPO(base, { authorize = true } = {}) {
  const r = await call(base, 'POST', '/procurement/purchase-orders', {
    supplier_id: supplier.id, po_type: 'standard', order_date: today, notes: 'T07', created_by: 1,
    items: [{ item_name: itemA.item_name, quantity: 10, unit_price: 100 }, { item_name: itemB.item_name, quantity: 5, unit_price: 200 }],
  });
  if (!r.ok) throw new Error('PO ' + JSON.stringify(r.body));
  if (authorize) for (const action of ['check', 'approve', 'authorize']) await call(base, 'POST', `/procurement/purchase-orders/${r.body.id}/status`, { action, user_id: 1, user_name: 'Preview Admin' });
  const lines = await q('SELECT id, item_name FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY id', [r.body.id]);
  return { id: r.body.id, lineA: lines.find((l) => l.item_name === itemA.item_name).id, lineB: lines.find((l) => l.item_name === itemB.item_name).id };
}
const grn = (base, poId, lines) => call(base, 'POST', '/procurement/goods-receipt-notes', {
  po_id: poId, received_by: 1, received_location: 'Main Store', received_condition: 'good',
  lines: lines.map(([lineId, item, qty]) => ({ po_line_item_id: lineId, item_code: item.item_code, item_description: item.item_name, quantity_received: qty, batch_number: `T07-${Date.now()}-${qty}` })),
});
const accept = (base, id) => call(base, 'POST', `/procurement/goods-receipt-notes/${id}/accept`, { accepted_by: 1 });
const poLineReceived = async (lineId) => (await q('SELECT COALESCE(quantity_received,0)::float r FROM purchase_order_items WHERE id = $1', [lineId]))[0].r;
const stockA = async () => (await q('SELECT quantity_on_hand::float q FROM inventory_items WHERE id = $1', [itemA.id]))[0].q;
const grnStatus = async (id) => (await q('SELECT status FROM goods_receipt_notes WHERE id = $1', [id]))[0]?.status;
const apLedger = async (grnId) => (await q(`SELECT COALESCE(SUM(al.credit_amount - al.debit_amount),0)::float v FROM account_ledger al
   JOIN chart_of_accounts c ON c.id = al.account_id AND c.account_code = '2100' JOIN general_ledger gl ON gl.id::text = al.transaction_id::text
   WHERE gl.reference_id::text = $1`, [grnId]))[0].v;

async function scenario(base) {
  const o = {};
  const draft = await newPO(base, { authorize: false });
  o.draftGrn = (await grn(base, draft.id, [[draft.lineA, itemA, 1]])).status;

  const po = await newPO(base);
  const over = await grn(base, po.id, [[po.lineA, itemA, 12]]);
  o.overStatus = over.status; o.overError = over.body.error;

  const g1 = await grn(base, po.id, [[po.lineA, itemA, 6]]);
  o.g1 = g1.status;
  o.lineAAfterCreate = await poLineReceived(po.lineA);
  const g2 = await grn(base, po.id, [[po.lineA, itemA, 5]]);
  o.pendingOverStatus = g2.status; o.pendingOverError = g2.body.error;

  const stock0 = await stockA();
  const acc = await accept(base, g1.body.id);
  o.accept = acc.status;
  o.lineAAfterAccept = await poLineReceived(po.lineA);
  o.stockDelta = (await stockA()) - stock0;
  o.apPosted = await apLedger(g1.body.id);

  const parallel = await Promise.all([1, 1, 1, 1, 1].map(() => grn(base, po.id, [[po.lineB, itemB, 1]])));
  o.parallelStatuses = parallel.map((r) => r.status);
  o.parallelNumbers = parallel.filter((r) => r.ok).map((r) => r.body.grn_number);

  // Atomic posting: with 2100 unavailable, acceptance must not receive stock without the liability.
  const g3 = await grn(base, po.id, [[po.lineA, itemA, 2]]);
  await q("UPDATE chart_of_accounts SET is_active = FALSE WHERE account_code = '2100'");
  try {
    const s0 = await stockA();
    const a3 = await accept(base, g3.body.id);
    o.noApAccept = a3.status; o.noApError = a3.body.error;
    o.noApStockDelta = (await stockA()) - s0;
    o.noApGrnStatus = await grnStatus(g3.body.id);
    o.noApLiability = await apLedger(g3.body.id);
  } finally {
    await q("UPDATE chart_of_accounts SET is_active = TRUE WHERE account_code = '2100'");
  }
  return o;
}

const before = await scenario(BEFORE);
console.log('BEFORE', JSON.stringify(before));
check('before: GRN accepted against a draft PO', before.draftGrn === 201);
check('before: receiving 12 of 10 ordered is accepted', before.overStatus === 201);
check('before: PO quantity moves at GRN creation, before any acceptance', before.lineAAfterCreate > 0, `received ${before.lineAAfterCreate} with nothing accepted`);
check('before: simultaneous GRNs collide on the COUNT(*) number (some fail)', before.parallelStatuses.some((st) => st >= 500), JSON.stringify(before.parallelStatuses));
check('before: with 2100 missing, stock is received but no liability is booked',
  before.noApAccept === 200 && before.noApStockDelta === 2 && before.noApLiability === 0,
  `accept ${before.noApAccept}, stock +${before.noApStockDelta}, 2100 ${before.noApLiability}`);

const after = await scenario(AFTER);
console.log('AFTER ', JSON.stringify(after));
check('after: GRN against a draft PO refused (400)', after.draftGrn === 400);
check('after: 12 of 10 ordered refused with a clear message', after.overStatus === 400 && /Over-receipt: 12 of .* would exceed the 10 ordered/.test(after.overError), after.overError);
check('after: valid GRN for 6 created; PO quantity unchanged until accepted', after.g1 === 201 && after.lineAAfterCreate === 0);
check('after: 5 more refused while 6 are awaiting acceptance (6 + 5 > 10)', after.pendingOverStatus === 400 && /awaiting acceptance/.test(after.pendingOverError), after.pendingOverError);
check('after: acceptance moves PO quantity to 6 and stock +6', after.accept === 200 && after.lineAAfterAccept === 6 && after.stockDelta === 6, `accept ${after.accept}, line ${after.lineAAfterAccept}, stock +${after.stockDelta}`);
check('after: acceptance books the supplier liability (2100 credit 600)', after.apPosted === 600, String(after.apPosted));
check('after: 5 simultaneous GRNs all created with 5 distinct numbers',
  after.parallelStatuses.every((st) => st === 201) && new Set(after.parallelNumbers).size === 5, JSON.stringify({ s: after.parallelStatuses, n: after.parallelNumbers }));
check('after: with 2100 missing, acceptance refused, no stock received, GRN still pending',
  after.noApAccept === 422 && after.noApStockDelta === 0 && after.noApGrnStatus === 'pending_inspection' && after.noApLiability === 0,
  `${after.noApAccept}: ${after.noApError}`);

await done();
process.exit(summary() ? 1 : 0);
