const { v4: uuidv4 } = require('uuid');
const { branchCtxCache } = require('../cache');

async function loadAccessibleBranches(sequelize, userId, fallbackBranchId) {
  try {
    // Check if user_branches table exists
    const [tableCheck] = await sequelize.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'user_branches'
      ) AS exists_flag
    `);

    if (!tableCheck[0].exists_flag) {
      console.log('user_branches table does not exist yet, using fallback');
      if (fallbackBranchId) {
        return [{ id: fallbackBranchId, name: `Branch ${fallbackBranchId}`, facilityId: null, isPrimary: true }];
      }
      return [];
    }

    const [rows] = await sequelize.query(`
      SELECT b.id, b.name, b.facility_id, COALESCE(ub.is_primary, false) AS is_primary
      FROM user_branches ub
      INNER JOIN branches b ON b.id = ub.branch_id
      WHERE ub.user_id = ?
      ORDER BY ub.is_primary DESC, b.name ASC
    `, {
      replacements: [userId]
    });

    if (rows.length > 0) {
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        facilityId: row.facility_id,
        isPrimary: !!row.is_primary,
      }));
    }
  } catch (error) {
    console.log('Branch access lookup fallback:', error.message);
  }

  if (fallbackBranchId) {
    try {
      const [fallbackRows] = await sequelize.query(`
        SELECT id, name, facility_id
        FROM branches
        WHERE id = ?
        LIMIT 1
      `, {
        replacements: [fallbackBranchId]
      });

      if (fallbackRows.length > 0) {
        return [{
          id: fallbackRows[0].id,
          name: fallbackRows[0].name,
          facilityId: fallbackRows[0].facility_id,
          isPrimary: true,
        }];
      }
    } catch (error) {
      console.log('Branch access name lookup fallback:', error.message);
    }

    return [{ id: fallbackBranchId, name: `Branch ${fallbackBranchId}`, facilityId: null, isPrimary: true }];
  }

  return [];
}

async function writeBranchAuditLog(sequelize, { userId, branchId, action, resourceType, resourceId, isUnauthorized, ipAddress, userAgent }) {
  try {
    await sequelize.query(`
      INSERT INTO branch_access_audit_logs
        (id, user_id, branch_id, action, resource_type, resource_id, is_unauthorized, ip_address, user_agent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, {
      replacements: [
        uuidv4(),
        userId || null,
        branchId || null,
        action,
        resourceType || null,
        resourceId || null,
        isUnauthorized ? true : false,
        ipAddress || null,
        userAgent || null,
      ]
    });
  } catch (error) {
    console.log('Branch audit log write skipped:', error.message);
  }
}

async function branchAccessControl(req, res, next) {
  if (!req.user) return next();

  if (req.path.startsWith('/api/auth') || req.path === '/api/status' || req.path === '/health') {
    return next();
  }

  try {
    const isAdmin = req.user.role === 'admin';
    const sequelize = req.models?.sequelize;
    // Cache key includes dbName — user ids are only unique within a single
    // tenant's own database, so a key of userId alone would serve one
    // tenant's cached branch list to another tenant's same-numbered user id.
    const branchCacheKey = `${req.tenantDbName}:${req.user.id}`;

    // Use cached branch context to avoid a DB query on every request
    let accessibleBranches = branchCtxCache.get(branchCacheKey);
    if (!accessibleBranches) {
      accessibleBranches = await loadAccessibleBranches(sequelize, req.user.id, req.user.branchId);
      // Don't cache if empty - we'll add fallback below
      if (accessibleBranches.length > 0) {
        branchCtxCache.set(branchCacheKey, accessibleBranches);
      }
    }

    // If no branches in user_branches table but user has branchId in JWT, use that as accessible branch
    if (!isAdmin && accessibleBranches.length === 0 && req.user.branchId) {
      console.log(`✅ User ${req.user.email} (${req.user.role}) using JWT branch ${req.user.branchId} as fallback for ${req.originalUrl}`);
      accessibleBranches = [{
        id: req.user.branchId,
        name: `Branch ${req.user.branchId}`,
        facilityId: null,
        isPrimary: true
      }];
      // Cache the fallback branch
      branchCtxCache.set(branchCacheKey, accessibleBranches);
    }

    // Gap #2 fix: non-admin users with NO branch assignment are denied
    if (!isAdmin && accessibleBranches.length === 0) {
      console.warn(`User ${req.user.id} (${req.user.role}) has no branch assigned — blocking request to ${req.originalUrl}`);
      return res.status(403).json({
        error: 'Your account has not been assigned to a branch. Please contact your administrator.',
        code: 'NO_BRANCH_ASSIGNED',
      });
    }

    const primaryBranch = accessibleBranches.find((b) => b.isPrimary) || accessibleBranches[0] || null;

    // Support UUID or integer branch IDs from the X-Branch-ID header
    const requestedBranchIdRaw = req.headers['x-branch-id'] || req.query.branch_id || req.body?.branch_id;
    const currentBranchId = requestedBranchIdRaw || req.user.branchId || primaryBranch?.id || null;

    const hasAccess = isAdmin ||
      accessibleBranches.some((b) => String(b.id) === String(currentBranchId));

    req.user.accessibleBranches = accessibleBranches;
    req.user.primaryBranchId = primaryBranch?.id || req.user.branchId || null;
    req.user.currentBranchId = currentBranchId;
    req.branchContext = {
      branchId: currentBranchId,
      primaryBranchId: primaryBranch?.id || req.user.branchId || null,
      accessibleBranches,
      isAdmin,
      facilityId: primaryBranch?.facilityId || null,
    };

    if (!hasAccess) {
      // Fire-and-forget audit log only on unauthorized access
      writeBranchAuditLog(sequelize, {
        userId: req.user.id, branchId: currentBranchId,
        action: 'unauthorized_branch_access', resourceType: 'api',
        resourceId: req.originalUrl, isUnauthorized: true,
        ipAddress: req.ip, userAgent: req.get('user-agent'),
      }).catch(() => {});
      return res.status(403).json({ error: 'You do not have access to this branch' });
    }

    next();
  } catch (error) {
    console.error('Branch access control error:', error);
    res.status(500).json({ error: 'Failed to apply branch access control' });
  }
}

module.exports = { branchAccessControl };
