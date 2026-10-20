import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Syringe, Check, Loader2, User, Clock } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { authFetch } from '@/api/apiClient';
import { toast } from '@/lib/notify';
import { useAuth } from '@/contexts/AuthContext';

const PROCEDURE_TYPE_LABEL: Record<string, string> = {
  injection: 'Injection', minor_procedure: 'Minor Procedure', dressing: 'Dressing', other: 'Other',
};

interface NursingProcedure {
  id: string;
  entry_type: 'note' | 'procedure';
  status: 'pending' | 'completed';
  procedure_type: string | null;
  description: string;
  notes: string | null;
  performed_at: string;
  created_at: string;
  nurse_name: string | null;
  ordered_by_name: string | null;
  fee_amount: string | null;
  fee_currency: string | null;
  first_name?: string;
  last_name?: string;
  participant_number?: string;
}

// Opened from the /nursing/procedures queue by clicking a patient. This is
// where a nurse does the actual work for that patient in one sitting: fulfil
// whatever is pending (an ordered injection/dressing/minor procedure), and
// log a free note — all attributed to the logged-in account, all feeding
// straight back into this patient's Visit Summary.
export default function NursingProcedureDetail() {
  const { participantId } = useParams<{ participantId: string }>();
  const navigate = useNavigate();
  const { hasPrivilege } = useAuth();
  const canFulfill = hasPrivilege('nursing.procedures.write');

  const [history, setHistory] = useState<NursingProcedure[]>([]);
  const [loading, setLoading] = useState(true);

  const [completing, setCompleting] = useState<Record<string, { description: string; notes: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!participantId) return;
    setLoading(true);
    try {
      const res = await authFetch(`/api/nursing-procedures/participant/${participantId}`, { credentials: 'include' });
      if (res.ok) setHistory(await res.json());
    } catch (e) {
      console.error('Failed to fetch nursing procedure history', e);
    } finally {
      setLoading(false);
    }
  }, [participantId]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const patient = history[0];
  const pending = history.filter(h => h.status === 'pending');
  const completed = history.filter(h => h.status === 'completed');

  const handleComplete = async (row: NursingProcedure) => {
    setSavingId(row.id);
    const form = completing[row.id] || { description: '', notes: '' };
    try {
      const res = await authFetch(`/api/nursing-procedures/${row.id}/complete`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ description: form.description.trim() || undefined, notes: form.notes.trim() || undefined }),
      });
      if (res.ok) {
        toast.success('Marked complete');
        setCompleting(prev => { const next = { ...prev }; delete next[row.id]; return next; });
        fetchHistory();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to complete');
      }
    } catch {
      toast.error('Network error completing procedure');
    } finally {
      setSavingId(null);
    }
  };

  const handleNote = async () => {
    if (!note.trim() || !participantId) return;
    setSavingNote(true);
    try {
      const res = await authFetch('/api/nursing-procedures/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ participant_id: participantId, note: note.trim() }),
      });
      if (res.ok) {
        toast.success('Note added');
        setNote('');
        fetchHistory();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to add note');
      }
    } catch {
      toast.error('Network error saving note');
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="flex items-center gap-3 mb-3">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate('/nursing/procedures')}>
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          <PageHeader title="Nursing Record" icon={<Syringe />} className="mb-0" />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...</div>
        ) : !patient ? (
          <div className="bg-card rounded-lg border shadow-sm p-8 text-center text-muted-foreground">
            No nursing procedure history yet for this patient. Place an order or log a note from the Nursing Procedures queue.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-card rounded-lg border shadow-sm p-5 flex items-center gap-3">
                <User className="w-8 h-8 text-primary shrink-0" />
                <div>
                  <h3 className="font-semibold text-lg">{patient.first_name} {patient.last_name}</h3>
                  <p className="text-xs text-muted-foreground font-mono">{patient.participant_number}</p>
                </div>
              </div>

              {canFulfill && (
                <div className="bg-card rounded-lg border shadow-sm p-5 space-y-3">
                  <h4 className="font-semibold text-sm">Add a Note</h4>
                  <Textarea placeholder="Free-form observation, no order needed" value={note} onChange={e => setNote(e.target.value)} rows={3} />
                  <div className="flex justify-end">
                    <Button size="sm" variant="outline" className="gap-1.5" disabled={savingNote || !note.trim()} onClick={handleNote}>
                      {savingNote ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save Note
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="lg:col-span-2 space-y-6">
              {canFulfill && pending.length > 0 && (
                <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-border bg-amber-50 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-700" />
                    <h4 className="font-semibold text-sm text-amber-900">Pending Orders ({pending.length})</h4>
                  </div>
                  <div className="divide-y">
                    {pending.map(row => {
                      const form = completing[row.id] || { description: '', notes: '' };
                      return (
                        <div key={row.id} className="p-4 space-y-2">
                          <div className="flex justify-between items-start gap-2">
                            <div>
                              <p className="font-medium text-sm">{row.description}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {row.procedure_type && <span className="capitalize">{PROCEDURE_TYPE_LABEL[row.procedure_type] || row.procedure_type} · </span>}
                                Ordered by {row.ordered_by_name || 'Unknown'} · {new Date(row.created_at).toLocaleString()}
                                {row.fee_amount && <> · Billed {row.fee_currency} {parseFloat(row.fee_amount).toLocaleString()}</>}
                              </p>
                              {row.notes && <p className="text-xs text-muted-foreground mt-1 italic">"{row.notes}"</p>}
                            </div>
                            <Badge variant="outline" className="whitespace-nowrap">Pending</Badge>
                          </div>
                          <Textarea
                            placeholder="What was actually done (optional — defaults to the ordered procedure)"
                            value={form.description}
                            onChange={e => setCompleting(prev => ({ ...prev, [row.id]: { ...form, description: e.target.value } }))}
                            rows={2}
                            className="text-sm"
                          />
                          <div className="flex justify-end">
                            <Button size="sm" className="gap-1.5" disabled={savingId === row.id} onClick={() => handleComplete(row)}>
                              {savingId === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Mark Complete
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-border bg-muted/30">
                  <h4 className="font-semibold text-sm text-foreground">History ({completed.length} completed{pending.length > 0 ? `, ${pending.length} pending` : ''})</h4>
                </div>
                <div className="divide-y max-h-[32rem] overflow-y-auto">
                  {history.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">Nothing recorded yet.</p>
                  ) : history.map(row => (
                    <div key={row.id} className="p-4 flex justify-between items-start gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="capitalize text-xs">{row.entry_type === 'procedure' ? 'Procedure' : 'Note'}</Badge>
                          {row.procedure_type && <span className="text-xs text-muted-foreground capitalize">{PROCEDURE_TYPE_LABEL[row.procedure_type] || row.procedure_type}</span>}
                        </div>
                        <p className="text-sm mt-1 whitespace-pre-wrap">{row.description}</p>
                        {row.notes && <p className="text-xs text-muted-foreground mt-0.5 italic">"{row.notes}"</p>}
                        <p className="text-xs text-muted-foreground mt-1">
                          {row.status === 'completed' ? `By ${row.nurse_name || 'Unknown'}` : `Ordered by ${row.ordered_by_name || 'Unknown'}`} · {new Date(row.performed_at).toLocaleString()}
                        </p>
                      </div>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${row.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {row.status === 'completed' ? 'Completed' : 'Pending'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
