const { sequelize } = require('../models');

// Resolve revenue_account_id for a service/lab-test based on its category.
// Shared by routes/services.js and scripts/seedCommonLabTests.js so both
// pick the same chart-of-accounts revenue line for the same kind of category.
async function resolveRevenueAccount(category, clinicId) {
  const cat = (category || '').toLowerCase();
  // Order matters: the first match wins, so the more specific patterns are
  // tested before the broad ones. 4100 stays the catch-all for anything that
  // does not clearly belong to a service line, rather than a default everything
  // silently lands in.
  let code = '4100';
  if (/lab|laboratory|diagnostic|patholog|haemat|hemat/.test(cat)) code = '4110';
  else if (/pharma|drug|medic|dispens/.test(cat)) code = '4120';
  else if (/radio|imaging|xray|x-ray|scan|ultrasound|ct |mri/.test(cat)) code = '4130';
  else if (/proced|surgery|theater|theatre|operation|minor op/.test(cat)) code = '4140';
  else if (/inpatient|admission|bed|ward|nursing care/.test(cat)) code = '4150';
  else if (/consult|opd|outpatient|review|clinic visit/.test(cat)) code = '4105';
  const cid = clinicId || 1;
  const [[row]] = await sequelize.query(
    `SELECT id FROM chart_of_accounts WHERE account_code = '${code}' AND clinic_id = ${cid} AND is_active = true LIMIT 1`
  ).catch(() => [[]]);
  if (row) return row.id;
  // Fallback: any revenue account
  const [[fallback]] = await sequelize.query(
    `SELECT id FROM chart_of_accounts WHERE account_code = '4100' LIMIT 1`
  ).catch(() => [[]]);
  return fallback?.id || null;
}

module.exports = { resolveRevenueAccount };
