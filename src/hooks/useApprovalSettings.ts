import { useEffect, useState } from 'react';
import { authFetch } from '@/api/apiClient';

/**
 * How many approvals an expense and a supplier bill need, from Setup ›
 * Configurations (defaults 2 and 3 — the system's long-standing rule), plus
 * the label for each approval level at that count. The server enforces the
 * same numbers; this only keeps the screens in step with it.
 */
const BILL_LEVELS: Record<number, string[]> = { 1: ['Approved By'], 2: ['Checked By', 'Approved By'], 3: ['Checked By', 'Reviewed By', 'Approved By'] };
const EXPENSE_LEVELS: Record<number, string[]> = { 1: ['Authorization'], 2: ['Approval 1', 'Authorization'] };

let cache: { expReq: number; billReq: number; sameApprover: boolean } | null = null;

export function useApprovalSettings() {
  const [s, setS] = useState(cache || { expReq: 2, billReq: 3, sameApprover: false });
  useEffect(() => {
    authFetch('/api/facility-settings').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      cache = {
        expReq: Math.min(2, Math.max(1, Number(d.expense_approvals_required) || 2)),
        billReq: Math.min(3, Math.max(1, Number(d.supplier_bill_approvals_required) || 3)),
        sameApprover: !!d.approvals_allow_same_person,
      };
      setS(cache);
    }).catch(() => {});
  }, []);
  return {
    ...s,
    expLevels: EXPENSE_LEVELS[s.expReq],
    billLevels: BILL_LEVELS[s.billReq],
    /** [1..n] for mapping over levels. */
    expLevelNumbers: Array.from({ length: s.expReq }, (_, i) => i + 1),
    billLevelNumbers: Array.from({ length: s.billReq }, (_, i) => i + 1),
  };
}
