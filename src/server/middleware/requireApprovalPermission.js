/**
 * Per-user approval-authority enforcement.
 *
 * Rules (mirrors branchFilter.js's admin-bypass convention):
 *  - Admin users (role === 'admin') may always perform any approval action.
 *  - Everyone else must hold an explicit grant in `approval_permissions` for
 *    the specific (clinic_id, user_id, approval_type) combination.
 *  - A denied request gets a 403 with a useful body: which action was denied
 *    (human label) plus the list of actions this user IS allowed to perform.
 *
 * The catalog below is the single source of truth for approval types and is
 * re-exported for use by src/server/routes/approvals.js (the CRUD API / GET
 * /api/approvals/types endpoint) so the two never drift apart.
 */
const { sequelize } = require('../models');

// ─── Approval-type catalog ──────────────────────────────────────────────
// key -> { label, module, description }
const APPROVAL_TYPES = {
  po_check: {
    label: 'PO Check',
    module: 'Procurement',
    description: 'First-level review of a draft purchase order.',
  },
  po_approve: {
    label: 'PO Approval',
    module: 'Procurement',
    description: 'Approve a checked purchase order.',
  },
  po_authorize: {
    label: 'PO Authorization',
    module: 'Procurement',
    description: 'Final sign-off of an approved purchase order.',
  },
  pr_approve: {
    label: 'Purchase Requisition Approval',
    module: 'Procurement',
    description: 'Approve a submitted purchase requisition.',
  },
  grn_inspect: {
    label: 'Goods Receipt Inspection',
    module: 'Procurement',
    description: 'Record inspection results for a goods receipt note.',
  },
  grn_accept: {
    label: 'Goods Receipt Acceptance',
    module: 'Procurement',
    description: 'Accept a goods receipt note — creates inventory batches and stock transactions.',
  },
  expense_approve: {
    label: 'Daily Expense Approval',
    module: 'Expenses',
    description: 'Approve a daily expense (2-level approval chain).',
  },
  supplier_bill_approve: {
    label: 'Supplier Bill Approval / Authorization',
    module: 'Expenses',
    description: 'Approve / authorize a supplier bill (3-level approval chain).',
  },
  deposit_refund_approve: {
    label: 'Patient Deposit Refund',
    module: 'Billing',
    description: 'Refund an unused patient deposit balance back to the patient.',
  },
  receipt_void_approve: {
    label: 'Receipt Void/Refund Approval',
    module: 'Billing',
    description: 'Approve or reject a cashier\'s request to void or refund a receipt.',
  },
  journal_entry_approve: {
    label: 'Journal Entry Approval',
    module: 'Financial',
    description: 'Approve or reject a submitted journal entry before it can be posted.',
  },
  payroll_run_approve: {
    label: 'Payroll Run Approval',
    module: 'Payroll',
    description: 'Approve a draft payroll run before it can be paid.',
  },
  leave_request_approve: {
    label: 'Leave Request Approval',
    module: 'HR',
    description: 'Approve or reject a submitted leave request.',
  },
  salary_advance_approve: {
    label: 'Salary Advance Approval',
    module: 'HR',
    description: 'Approve a requested salary advance before it can be disbursed.',
  },
};

function resolveClinicId(req) {
  return req.user?.clinicId || req.user?.clinic_id || 1;
}

/**
 * Returns true if the current user may perform the given approval action.
 */
async function userHasApprovalPermission(req, approvalType) {
  if (req.user?.role === 'admin') return true;
  const userId = req.user?.id;
  if (!userId) return false;
  const clinicId = resolveClinicId(req);
  const [rows] = await sequelize.query(
    'SELECT id FROM approval_permissions WHERE user_id = :userId AND approval_type = :approvalType AND clinic_id = :clinicId LIMIT 1',
    { replacements: { userId, approvalType, clinicId } }
  );
  return rows.length > 0;
}

/**
 * Returns the current user's own grants, each with a human-readable label —
 * used to make 403 responses actually useful ("here's what you CAN do").
 */
async function getUserAllowedActions(req) {
  const userId = req.user?.id;
  if (!userId) return [];
  const clinicId = resolveClinicId(req);
  const [rows] = await sequelize.query(
    'SELECT DISTINCT approval_type FROM approval_permissions WHERE user_id = :userId AND clinic_id = :clinicId',
    { replacements: { userId, clinicId } }
  );
  return rows.map(r => ({
    approval_type: r.approval_type,
    label: APPROVAL_TYPES[r.approval_type]?.label || r.approval_type,
  }));
}

/**
 * Express middleware factory. Usage:
 *   router.post('/foo/:id/approve', requireApprovalPermission('expense_approve'), async (req, res) => { ... });
 *
 * For shared endpoints that handle several actions via req.body.action (e.g.
 * the PO status endpoint), don't use this as route middleware — call
 * userHasApprovalPermission()/getUserAllowedActions() inline instead, after
 * resolving which approval_type applies to the requested action.
 */
function requireApprovalPermission(approvalType) {
  return async function (req, res, next) {
    try {
      if (req.user?.role === 'admin') return next();
      const allowed = await userHasApprovalPermission(req, approvalType);
      if (allowed) return next();
      const allowedActions = await getUserAllowedActions(req);
      const label = APPROVAL_TYPES[approvalType]?.label || approvalType;
      return res.status(403).json({
        error: `You are not authorized to perform this action (${label}).`,
        allowedActions,
      });
    } catch (error) {
      console.error('Error checking approval permission:', error);
      return res.status(500).json({ error: 'Failed to verify approval permission' });
    }
  };
}

module.exports = {
  requireApprovalPermission,
  userHasApprovalPermission,
  getUserAllowedActions,
  APPROVAL_TYPES,
};
