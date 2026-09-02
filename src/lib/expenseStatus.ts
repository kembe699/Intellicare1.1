// Expense status, worded for the printed voucher's badge.
//
// The two expense vouchers (the list page's quick print and the detail page's
// full voucher) each hardcoded a different fixed string — 'PAID' and 'APPROVED'
// — so a voucher never reflected the expense's real state: approving or paying
// it changed nothing on the document. Deriving it in one place keeps both
// vouchers honest and stops them drifting apart again, and mirrors how supplier
// bill vouchers already build their label.
export const EXPENSE_APPROVAL_LEVELS = 2;

export function expenseVoucherStatus(status: string | undefined, approvalCount: number): string {
  if (status === 'paid') return 'PAID';
  if (status === 'approved' || approvalCount >= EXPENSE_APPROVAL_LEVELS) return 'APPROVED — AWAITING PAYMENT';
  if (status === 'rejected') return 'REJECTED';
  return `PENDING APPROVAL (${approvalCount}/${EXPENSE_APPROVAL_LEVELS})`;
}
