/**
 * SQL for a patient bill's booked exchange rate to base currency — what every
 * report multiplies a bill's own-currency amounts by before adding them to
 * other bills. A scheme bill in USD (CIC: USD 23.55) added as-is to SSP bills
 * turned 183,690 SSP into "23.55".
 *
 * Same rule as AccountingService.getBillBookedRate: 1 for a bill in the base
 * currency; otherwise the rate stamped on the bill (exchange_rate, set with
 * base_currency_total), else the rate of its first billing ledger entry, else the
 * exchange rate in force on its bill date (or the inverse rate), else 1.
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
       (SELECT er.rate FROM exchange_rates er
         WHERE er.from_currency = ${alias}.bill_currency AND er.to_currency = ${base} AND er.is_active = true AND er.rate > 0
           AND er.effective_date <= COALESCE(${alias}.bill_date, NOW())::date
         ORDER BY er.effective_date DESC LIMIT 1),
       (SELECT 1 / er.rate FROM exchange_rates er
         WHERE er.from_currency = ${base} AND er.to_currency = ${alias}.bill_currency AND er.is_active = true AND er.rate > 0
           AND er.effective_date <= COALESCE(${alias}.bill_date, NOW())::date
         ORDER BY er.effective_date DESC LIMIT 1),
       1) END)::float`;
}

module.exports = { bookedRateSql };
