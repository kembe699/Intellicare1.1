// Shared helpers for batch-1 before/after tests against the local preview DB.
// Run from the repo root: node tests/batch1/<file>.mjs
// BEFORE = a backend started from the baseline commit, AFTER = one started from this branch,
// both pointed at the local preview DB (see README.md in this folder).
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/server');
const require = createRequire(path.join(SERVER_DIR, 'package.json'));
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

const SECRET = dotenv.parse(readFileSync(path.join(SERVER_DIR, '.env'))).JWT_SECRET;
export const BEFORE = process.env.BEFORE_API || 'http://localhost:3002/api';
export const AFTER = process.env.AFTER_API || 'http://localhost:3013/api';

export function tokenFor({ userId = 1, role = 'admin', email = 'admin@preview.local' } = {}) {
  return jwt.sign({ userId, email, role, clinicId: 1, branchId: 1, schemaName: 'tenant_preview', clientCode: 'preview' }, SECRET, { expiresIn: '2h' });
}
const ADMIN = tokenFor();

export async function call(base, method, path, body, token = ADMIN) {
  const r = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, ok: r.ok, body: json };
}

let db;
export async function q(sql, params = []) {
  if (!db) {
    db = new Client({ host: process.env.PGHOST || 'localhost', port: +(process.env.PGPORT || 5435), database: process.env.PGDATABASE || 'intellicare_preview', user: process.env.PGUSER || 'preview', password: process.env.PGPASSWORD || 'preview_pass' });
    await db.connect();
    await db.query('SET search_path TO tenant_preview');
  }
  return (await db.query(sql, params)).rows;
}
export async function done() { if (db) await db.end(); }

export const today = new Date().toISOString().split('T')[0];
const uniq = () => Math.random().toString(36).slice(2, 7);

export async function newPatient(base, label = 'Test') {
  const r = await call(base, 'POST', '/patients', {
    first_name: label, last_name: `Case-${uniq()}`, date_of_birth: '1990-01-01', gender: 'male', clinic_id: 1,
  });
  if (!r.ok) throw new Error('patient: ' + JSON.stringify(r.body));
  return r.body;
}

export async function serviceByName(name) {
  const [s] = await q('SELECT id, service_name, price FROM services WHERE service_name = $1', [name]);
  return s;
}

export async function newBill(base, patient, lines) {
  const total = lines.reduce((s, l) => s + l.totalPrice, 0);
  // Bill numbers come from the clock (last 6 ms digits) and can collide when tests
  // create bills back to back — a known, separate defect; retry that case only.
  for (let attempt = 0; ; attempt++) {
    const r = await call(base, 'POST', '/patient-bills', {
      patient_id: patient.id, patient_name: `${patient.first_name} ${patient.last_name}`, clinic_id: 1,
      created_by: 'Preview Admin', bill_date: today, services: lines, total_amount: total, paid_amount: 0, status: 'pending',
    });
    if (r.ok) return r.body;
    const collided = JSON.stringify(r.body).includes('bill_number must be unique');
    if (!collided || attempt >= 4) throw new Error('bill: ' + JSON.stringify(r.body));
    await new Promise((res) => setTimeout(res, 25));
  }
}

export function line(svc, qty = 1, price) {
  const p = price ?? parseFloat(svc.price);
  return { serviceId: svc.id, serviceName: svc.service_name, quantity: qty, unitPrice: p, totalPrice: p * qty };
}

export async function ensureShift(base, token = ADMIN) {
  await call(base, 'POST', '/cashier/start-shift', { opening_balance: 0 }, token);
}

export async function pay(base, billId, amount, method = 'cash') {
  return call(base, 'POST', `/patient-bills/${billId}/payments`, { amount, payment_method: method, payment_date: today, received_by: 'Preview Admin', currency: 'SSP' });
}

// Net ledger balance (debit - credit) per account code for entries referencing an id.
export async function ledgerFor(referenceIds) {
  return q(`
    SELECT c.account_code AS code, ROUND(SUM(al.debit_amount - al.credit_amount)::numeric, 2)::float AS net
      FROM account_ledger al
      JOIN chart_of_accounts c ON c.id = al.account_id
      LEFT JOIN general_ledger gl ON gl.id::text = al.transaction_id::text
      LEFT JOIN journal_entries je ON je.je_number = al.reference_number
     WHERE gl.reference_id::text = ANY($1) OR je.reference::text = ANY($1) OR je.reference::text LIKE ANY($2)
        OR je.description LIKE ANY($2) OR gl.description LIKE ANY($2)
     GROUP BY 1 ORDER BY 1`, [referenceIds, referenceIds.map(r => `%${r}%`)]);
}

const results = [];
export function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
export function summary() {
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  return failed;
}
