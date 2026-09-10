/**
 * Restate closed shifts whose totals ignored the cash they refunded.
 *
 * A bill refund is written as its own receipt with a negative amount and status
 * 'refunded'. Close-shift only summed 'active' receipts, so the figures frozen
 * onto the shift row were gross: the day's total counted money that had already
 * gone back over the counter, and expected cash counted it too — so a drawer that
 * was genuinely short by the refunded amount was recorded as balanced.
 *
 * New shifts close correctly now. This repairs the rows closed before that, so
 * the shift list agrees with the end-of-day report instead of each showing a
 * different total for the same day.
 *
 * Closing balance is a physical count and is not overwritten as a rule — with one
 * exception. Where it exactly equals the old, overstated expectation, the cashier
 * plainly entered the figure the system told them to expect rather than counting
 * to it, so leaving it would invent a shortfall they never had. That case is
 * restated with the corrected expectation and reported explicitly. Anywhere the
 * count differs, it is left alone and the variance is allowed to show.
 *
 *   node src/server/scripts/restateShiftRefunds.js --schema tenant_nation
 *   node src/server/scripts/restateShiftRefunds.js --schema tenant_nation --apply
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });

const { Client } = require('pg');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const si = args.indexOf('--schema');
const SCHEMA = si >= 0 ? args[si + 1] : null;

if (!SCHEMA) {
  console.error('Usage: restateShiftRefunds.js --schema <tenant_schema> [--apply]');
  process.exit(1);
}

const DB = {
  host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : (process.env.DB_HOST || '127.0.0.1'),
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  ssl: ['true', 'require'].includes(String(process.env.DB_SSL || '').toLowerCase())
    ? { rejectUnauthorized: false }
    : false,
};

const money = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);

async function main() {
  const db = new Client(DB);
  await db.connect();
  await db.query(`SET search_path TO "${SCHEMA}", public`);

  console.log(`\n  schema: ${SCHEMA}`);
  console.log(`  mode:   ${APPLY ? 'APPLY (writing)' : 'dry run (no writes)'}\n`);

  // Cash out is keyed on the negative amount, not the status: a refund recorded
  // by flipping the original receipt in place is already absent from the active
  // total, so subtracting it again would understate the drawer twice over.
  const { rows } = await db.query(`
    SELECT s.id, s.cashier_name, s.opening_balance, s.closing_balance,
           s.total_amount   AS stored_total,
           s.expected_cash  AS stored_expected,
           s.cash_transferred,
           COALESCE(g.gross, 0)        AS gross,
           COALESCE(g.gross_cash, 0)   AS gross_cash,
           COALESCE(r.refunded, 0)     AS refunded,
           COALESCE(r.refunded_cash, 0) AS refunded_cash,
           COALESCE(g.receipts, 0)     AS receipts
      FROM cashier_shifts s
      LEFT JOIN LATERAL (
        SELECT SUM(rc.payment_amount) AS gross,
               SUM(rc.payment_amount) FILTER (WHERE rc.payment_method = 'cash') AS gross_cash,
               COUNT(*) AS receipts
          FROM receipts rc
         WHERE rc.cashier_id = s.cashier_id AND rc.status = 'active'
           AND rc.created_at >= s.start_time
           AND rc.created_at <= COALESCE(s.end_time, NOW())
      ) g ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(ABS(rc.payment_amount)) AS refunded,
               SUM(ABS(rc.payment_amount)) FILTER (WHERE rc.payment_method = 'cash') AS refunded_cash
          FROM receipts rc
         WHERE rc.cashier_id = s.cashier_id AND rc.status = 'refunded'
           AND rc.payment_amount < 0
           AND rc.created_at >= s.start_time
           AND rc.created_at <= COALESCE(s.end_time, NOW())
      ) r ON TRUE
     WHERE s.status = 'closed'
       AND COALESCE(r.refunded, 0) > 0
     ORDER BY s.start_time
  `);

  if (rows.length === 0) {
    console.log('  No closed shift ignored a refund. Nothing to restate.\n');
    await db.end();
    return;
  }

  let restatedCounts = 0;
  console.log('  shift  cashier                 stored total   corrected   refunded   closing');
  console.log('  ' + '-'.repeat(80));

  for (const s of rows) {
    const transferred = Number(s.cash_transferred) || 0;
    const correctedTotal = Number(s.gross) - Number(s.refunded);
    const correctedExpected =
      Number(s.opening_balance || 0) + (Number(s.gross_cash) - Number(s.refunded_cash)) - transferred;
    const oldExpected = Number(s.stored_expected);
    const closing = s.closing_balance === null ? null : Number(s.closing_balance);

    // Only where the count simply mirrored the overstated expectation.
    const countMirroredExpectation =
      closing !== null && Math.abs(closing - oldExpected) < 0.01 && Math.abs(closing - correctedExpected) >= 0.01;
    const newClosing = countMirroredExpectation ? correctedExpected : closing;
    if (countMirroredExpectation) restatedCounts += 1;

    const variance = newClosing === null ? null : Math.round((newClosing - correctedExpected) * 100) / 100;

    console.log(
      `  ${String(s.id).padEnd(6)} ${String(s.cashier_name || '').padEnd(22)} ` +
      `${money(s.stored_total).padStart(12)} ${money(correctedTotal).padStart(11)} ` +
      `${money(s.refunded).padStart(10)} ${money(newClosing).padStart(9)}` +
      (countMirroredExpectation ? '  <- count mirrored the old expectation' : '')
    );

    if (APPLY) {
      await db.query(
        `UPDATE cashier_shifts
            SET total_amount = $1, expected_cash = $2, closing_balance = $3, cash_variance = $4
          WHERE id = $5`,
        [correctedTotal, correctedExpected, newClosing, variance, s.id]
      );
    }
  }

  console.log('');
  console.log(`  ${rows.length} shift(s) restated${restatedCounts ? `, ${restatedCounts} closing balance(s) corrected` : ''}.`);
  if (!APPLY) console.log('\n  Re-run with --apply to write.\n');
  else console.log('');

  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
