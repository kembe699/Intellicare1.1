// Per-user per-location authority for stock transfer requests (location_access
// table, migrateStockTransfers.js). Mirrors user_branches' shape: a row grants
// one user rights at one specific stock_locations row, rather than a role-wide
// grant. can_request = may create a transfer request TO this location (i.e.
// requisitioning on this store's behalf); can_fulfill = may approve a request
// and release stock FROM this location when it's the source. admin always
// bypasses both checks, same pattern as authorize()/requireApprovalPermission.
async function getLocationAccess(sequelize, userId, locationId) {
  if (!userId || !locationId) return { can_request: false, can_fulfill: false };
  try {
    const [[row]] = await sequelize.query(
      'SELECT can_request, can_fulfill FROM location_access WHERE user_id = :userId AND location_id = :locationId',
      { replacements: { userId, locationId } }
    );
    return row || { can_request: false, can_fulfill: false };
  } catch (err) {
    console.error('getLocationAccess failed:', err.message);
    return { can_request: false, can_fulfill: false };
  }
}

async function canRequestTo(sequelize, req, locationId) {
  if (req.user?.role === 'admin') return true;
  const access = await getLocationAccess(sequelize, req.user?.id, locationId);
  return !!access.can_request;
}

async function canFulfillAt(sequelize, req, locationId) {
  if (req.user?.role === 'admin') return true;
  const access = await getLocationAccess(sequelize, req.user?.id, locationId);
  return !!access.can_fulfill;
}

module.exports = { getLocationAccess, canRequestTo, canFulfillAt };
