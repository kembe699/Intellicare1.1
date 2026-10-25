import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { authFetch } from '@/api/apiClient';
import { toast } from '@/lib/notify';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface PayableClaim {
  id: string;
  claim_number: string;
  claim_amount: string | number;
  paid_amount?: string | number | null;
  currency?: string | null;
}

interface DepositAccount {
  id: string;
  account_code: string;
  account_name: string;
  is_bank_account?: boolean;
}

const MAIN_BANK_CODE = '1110';

/**
 * Records an insurer's payment against a claim: how much was received and
 * which cash/bank account it landed in. The server debits that account and
 * credits the scheme's receivable, so the money can be traced on the
 * account's own statement.
 */
export function ClaimPaymentDialog({
  claim,
  open,
  onOpenChange,
  onPaid,
}: {
  claim: PayableClaim | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaid: () => void;
}) {
  const [accounts, setAccounts] = useState<DepositAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const outstanding = claim
    ? Math.max(0, (Number(claim.claim_amount) || 0) - (Number(claim.paid_amount) || 0))
    : 0;
  const currency = claim?.currency || '';

  useEffect(() => {
    if (!open || !claim) return;
    setAmount(outstanding ? String(Number(outstanding.toFixed(2))) : '');
    setNotes('');
    setAccountId('');
    setLoadingAccounts(true);
    authFetch(`/api/insurance-claims/${claim.id}/deposit-accounts`)
      .then(async (r) => {
        const json = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(json.error || 'Could not load accounts');
        const list: DepositAccount[] = json.data || [];
        setAccounts(list);
        const main = list.find((a) => a.account_code === MAIN_BANK_CODE);
        if (main) setAccountId(String(main.id));
      })
      .catch((e) => toast.error(e.message || 'Could not load accounts'))
      .finally(() => setLoadingAccounts(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, claim?.id]);

  const amountNum = parseFloat(amount);
  const amountValid = amountNum > 0;
  const selected = accounts.find((a) => String(a.id) === accountId);

  const submit = async () => {
    if (!claim || saving || !amountValid || !accountId) return;
    setSaving(true);
    try {
      const res = await authFetch(`/api/insurance-claims/${claim.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'paid',
          paid_amount: amountNum,
          deposit_account_id: accountId,
          notes: notes || `Payment received into ${selected?.account_name ?? 'account'}`,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not record the payment');
      toast.success(
        json.data?.status === 'partially_paid'
          ? `Part payment recorded for ${claim.claim_number}`
          : `${claim.claim_number} marked paid`,
      );
      onOpenChange(false);
      onPaid();
    } catch (e: any) {
      toast.error(e.message || 'Could not record the payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          <DialogDescription>
            {claim ? `${claim.claim_number} · outstanding ${currency} ${outstanding.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="px-5 py-4 space-y-4">
          <div>
            <Label>Amount received{currency ? ` (${currency})` : ''} *</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount received"
              className="mt-1"
            />
            {amountValid && amountNum < outstanding - 0.01 && (
              <p className="mt-1 text-xs text-muted-foreground">Less than outstanding — the claim will be marked partially paid.</p>
            )}
          </div>
          <div>
            <Label>Received into *</Label>
            <Combobox
              options={accounts.map((a) => ({ value: String(a.id), label: `${a.account_code} · ${a.account_name}` }))}
              value={accountId}
              onChange={setAccountId}
              placeholder={loadingAccounts ? 'Loading accounts…' : 'Choose cash or bank account'}
              searchPlaceholder="Search accounts..."
              emptyText="No active cash or bank accounts"
              disabled={loadingAccounts}
              className="ic-select mt-1"
            />
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Cheque / transfer reference, remittance advice…"
              rows={2}
              className="mt-1"
            />
          </div>
          {selected && amountValid && (
            <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1">
              <div className="flex justify-between gap-3"><span>Debit · {selected.account_name}</span><span className="tabular-nums font-medium">{currency} {amountNum.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between gap-3 text-muted-foreground"><span>Credit · Insurance receivable</span><span className="tabular-nums">{currency} {amountNum.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !amountValid || !accountId}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Recording...</> : 'Record Payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
