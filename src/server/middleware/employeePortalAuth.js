/**
 * Verifies the employee-portal JWT (routes/employeePortal.js). Deliberately
 * separate from middleware/auth.js's authenticateToken, mirroring
 * platformAuth.js's shape: a discriminator claim (isEmployeePortal) is
 * checked before anything else in the payload is trusted, so a normal
 * tenant-user token can never pass this check, and this token — scoped to
 * exactly one employee's own portal data — can never be handed to
 * authenticateToken and reach any other HMIS API (that middleware looks
 * for decoded.userId/role, which this payload never carries).
 *
 * Unlike platformAuth.js, this DOES carry schemaName — the portal is still
 * per-tenant — so it resolves a real tenant connection, same as
 * authenticateToken. But it never trusts the JWT's own claims about the
 * employee's status: employment_status/is_active/portal_access_enabled are
 * re-read from the DB on every request, because an employee who is
 * suspended or has portal access revoked mid-session must be locked out
 * immediately, not just at next token expiry (30 days).
 */
const jwt = require('jsonwebtoken');
const { getTenantConnection } = require('../tenantDb');
const tenantContext = require('../tenantContext');

const JWT_SECRET = process.env.JWT_SECRET;

function authenticateEmployeePortal(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err || !decoded.isEmployeePortal || !decoded.schemaName || !decoded.employeeId) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    let tenantConnection;
    try {
      tenantConnection = await getTenantConnection(decoded.schemaName);
    } catch (connErr) {
      console.error('Employee portal tenant connection error:', connErr);
      return res.status(503).json({ error: 'Could not connect to your instance, please try again shortly' });
    }

    try {
      const [[employee]] = await tenantConnection.sequelize.query(
        `SELECT id, clinic_id, branch_id, employee_number, first_name, last_name, department,
                employment_status, is_active, portal_access_enabled, portal_pin_hash
         FROM employees WHERE id = ? LIMIT 1`,
        { replacements: [decoded.employeeId] }
      );
      if (!employee || !employee.is_active || employee.employment_status !== 'active' || !employee.portal_access_enabled) {
        return res.status(401).json({ error: 'Portal access is no longer available for this account. Contact HR.' });
      }
      req.employee = {
        id: employee.id,
        clinicId: employee.clinic_id,
        branchId: employee.branch_id,
        employeeNumber: employee.employee_number,
        firstName: employee.first_name,
        lastName: employee.last_name,
        department: employee.department,
        schemaName: decoded.schemaName,
        mustSetPin: !employee.portal_pin_hash,
      };
    } catch (dbErr) {
      console.error('Employee portal auth DB error:', dbErr);
      return res.status(500).json({ error: 'Could not verify your session. Please try again.' });
    }

    tenantContext.run(tenantConnection, () => next());
  });
}

/**
 * Blocks every portal route except the PIN-setup one itself until a
 * first-login employee has set their own PIN (see routes/employeePortal.js
 * POST /auth/set-pin) — the HR-issued one-time code must never become a
 * standing credential.
 */
function requirePortalPinSet(req, res, next) {
  if (req.employee?.mustSetPin) {
    return res.status(403).json({ error: 'set_pin_required', message: 'Please set your PIN to continue.' });
  }
  next();
}

module.exports = { authenticateEmployeePortal, requirePortalPinSet };
