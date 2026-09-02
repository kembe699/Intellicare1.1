const { sequelize } = require('../models');

// Resolve revenue_account_id for a service/lab-test based on its category.
// Shared by routes/services.js and scripts/seedCommonLabTests.js so both
// pick the same chart-of-accounts revenue line for the same kind of category.
async function resolveRevenueAccount(category, clinicId) {
  const cat = (category || '').toLowerCase();
  let code = '4100'; // default: Patient Services Revenue
  if (/lab|laboratory|diagnostic/.test(cat)) code = '4110';
  else if (/pharma|drug|medic/.test(cat)) code = '4120';
  else if (/radio|imaging|xray|scan/.test(cat)) code = '4130';
  else if (/proced|surgery|theater|theatre/.test(cat)) code = '4140';
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
