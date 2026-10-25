/**
 * SQL for a patient bill's booked exchange rate to base currency — what every
 * report multiplies a bill's own-currency amounts by before adding them to
 * other bills. A scheme bill in USD (CIC: USD 23.55) added as-is to SSP bills
 * turned 183,690 SSP into "23.55".
 *
 * Same rule as AccountingService.getBillBookedRate: 1 for a bill in the base
 * currency; otherwise the rate stamped on the bill (exchange_rate, set with
 * base_currency_total), else the rate of its first billing ledger entry, else 1.
 *
 * @param {string} alias - the patient_bills alias (or table name) in the query
 */
function bookedRateSql(alias = 'pb') {
  const base = `(SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1)`;
  return `(CASE WHEN ${alias}.bill_currency IS NULL OR ${alias}.bill_currency = ${base} THEN 1
     ELSE COALESCE(
       CASE WHEN ${alias}.base_currency_total > 0 THEN NULLIF(${alias}.exchange_rate, 0) END,
       (SELECT gl.exchange_rate FROM general_ledger gl
         WHERE gl.reference_id = ${alias}.id::text AND gl.reference_module = 'patient_billing' AND gl.exchange_rate > 0
         ORDER BY gl.created_at LIMIT 1),
       1) END)::float`;
}

module.exports = { bookedRateSql };
