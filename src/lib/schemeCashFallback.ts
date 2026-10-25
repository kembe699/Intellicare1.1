import { authFetch } from '@/api/apiClient';
import { toast } from '@/lib/notify';

/**
 * Items a patient's scheme doesn't price can still be billed — at the normal
 * cash price, on the patient's CASH bill, kept apart from the insurance bill
 * so neither record is mixed. The server rejects such a line with
 * code NOT_PRICED_UNDER_SCHEME (+ unpriced_items, scheme_name); this asks the
 * user and, on yes, bills those items as cash (POST /patient-bills with
 * bill_as_cash: an open cash bill for the visit is reused, else one is made).
 */
export type ConfirmFn = (opts: { title?: string; description: string; confirmLabel?: string; cancelLabel?: string }) => Promise<boolean>;

const lineName = (l: any) => String(l?.serviceName ?? l?.name ?? l?.service_name ?? '').trim();

/** True when an error body is the "not priced under the scheme" rejection. */
export const isSchemeRejection = (body: any) => body?.code === 'NOT_PRICED_UNDER_SCHEME' && Array.isArray(body?.unpriced_items);

/**
 * Handles a NOT_PRICED_UNDER_SCHEME rejection for `lines`.
 * - asks whether to bill the uncovered items at the cash price;
 * - yes: bills them on the cash bill, then (if any) retries the covered lines
 *   through `retryCovered` on the scheme bill;
 * - no: nothing is billed.
 * Returns null when `body` isn't that rejection (the caller shows its own error),
 * otherwise whether anything was billed.
 */
export async function offerCashBilling(opts: {
  body: any;
  lines: any[];
  confirm: ConfirmFn;
  patientId: string;
  patientName: string;
  clinicId: number | string;
  createdBy?: string;
  notes?: string;
  retryCovered?: (coveredLines: any[]) => Promise<boolean>;
}): Promise<{ billed: boolean; cashBillNumber?: string } | null> {
  const { body, lines, confirm } = opts;
  if (!isSchemeRejection(body)) return null;
  const names: string[] = body.unpriced_items;
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const uncovered = lines.filter((l) => wanted.has(lineName(l).toLowerCase()));
  const covered = lines.filter((l) => !wanted.has(lineName(l).toLowerCase()));
  const list = names.join(', ');
  const scheme = body.scheme_name || 'the patient\'s scheme';

  const yes = await confirm({
    title: `Not covered by ${scheme}`,
    description: `${list} ${names.length > 1 ? 'are' : 'is'} not priced under ${scheme}. Bill ${names.length > 1 ? 'them' : 'it'} at the normal cash price instead? `
      + `${names.length > 1 ? 'They go' : 'It goes'} on the patient's cash bill, kept separate from the insurance bill.`,
    confirmLabel: 'Bill at cash price',
    cancelLabel: 'Don\'t bill',
  });
  if (!yes) {
    toast.info(`${list} not billed`);
    return { billed: false };
  }

  const cashLines = (uncovered.length ? uncovered : lines).map(({ schemePrice, schemeCurrency, scheme_name, ...l }: any) => l);
  const total = cashLines.reduce((s, l) => s + (Number(l.totalPrice) || 0), 0);
  const res = await authFetch('/api/patient-bills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      bill_number: `BILL-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`,
      patient_id: opts.patientId, patient_name: opts.patientName,
      clinic_id: parseInt(String(opts.clinicId)) || 1,
      total_amount: total, paid_amount: 0, balance_amount: total, status: 'pending',
      bill_date: new Date().toISOString(), due_date: null,
      services: cashLines, notes: opts.notes, created_by: opts.createdBy || 'System',
      bill_as_cash: true,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    toast.error(`Could not bill ${list} as cash: ${json.error || 'unknown error'}`);
    return { billed: false };
  }
  toast.success(`${list} billed at cash price on ${json.bill_number || 'the cash bill'}`);

  if (covered.length && uncovered.length && opts.retryCovered) {
    await opts.retryCovered(covered);
  }
  return { billed: true, cashBillNumber: json.bill_number };
}
