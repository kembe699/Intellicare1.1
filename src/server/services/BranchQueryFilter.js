class BranchQueryFilter {
  static applyBranchFilter(queryOptions = {}, branchContext) {
    if (!branchContext || branchContext.isAdmin) {
      return queryOptions;
    }

    const where = queryOptions.where || {};
    where.branch_id = branchContext.branchId;

    return {
      ...queryOptions,
      where,
      subQuery: false,
    };
  }

  static ensureBranchContext(data = {}, branchContext) {
    if (!branchContext) {
      return data;
    }

    if (branchContext.isAdmin && data.branch_id) {
      return data;
    }

    return {
      ...data,
      branch_id: branchContext.branchId,
    };
  }

  static canAccessRecord(record, branchContext) {
    if (!record) return false;
    if (!branchContext || branchContext.isAdmin) return true;
    // branchAccessControl now blocks unassigned users before they reach routes,
    // so branchId should always be set for non-admin users here.
    if (!branchContext.branchId) return true;
    // Record has no branch_id stamped (old pre-branch data) — treat as admin-only
    // to avoid leaking untagged records across branches.
    // Run the audit/migration script to stamp these records.
    if (!record.branch_id) return branchContext.isAdmin;
    return String(record.branch_id) === String(branchContext.branchId);
  }

  static buildBranchWhere(branchContext) {
    if (!branchContext || branchContext.isAdmin) {
      return {};
    }

    return { branch_id: branchContext.branchId };
  }

  // Many tables (procurement, inventory, pharmacy, inpatient, accounting) only carry
  // clinic_id — no branch_id — so canAccessRecord() above doesn't apply to them (it would
  // treat every one of their records as branch-less and lock out all non-admins). This is
  // the clinic-level equivalent: does this record belong to the requesting user's clinic?
  static canAccessClinicRecord(record, req) {
    if (!record) return false;
    if (req.user?.role === 'admin') return true;
    if (record.clinic_id == null) return true;
    return String(record.clinic_id) === String(req.user?.clinicId);
  }

  // req.query.clinic_id was widely trusted ahead of the logged-in user's own clinic
  // (`req.query.clinic_id || req.user?.clinicId || 1`) — letting any authenticated user
  // view another clinic's data by editing the query string. This is the safe replacement:
  // a non-admin's own clinic always wins; only an admin may explicitly query a different
  // clinic (e.g. for cross-clinic/consolidated views), and only when they actually pass one.
  static resolveClinicId(req, fallback = 1) {
    const own = req.user?.clinicId;
    if (req.user?.role === 'admin') {
      const requested = req.query?.clinic_id ?? req.body?.clinic_id;
      return parseInt(requested) || parseInt(own) || fallback;
    }
    return parseInt(own) || fallback;
  }
}

module.exports = BranchQueryFilter;
