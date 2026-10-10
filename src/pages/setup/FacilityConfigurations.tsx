import React, { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Settings, Save, Loader2 } from 'lucide-react';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface FacilitySettings {
  queue_receipt_enabled: boolean;
  billing_redirect_after_queue_enabled: boolean;
  patient_number_prefix: string;
  patient_number_suffix: string;
}

const DEFAULTS: FacilitySettings = {
  queue_receipt_enabled: true,
  billing_redirect_after_queue_enabled: true,
  patient_number_prefix: 'PTN',
  patient_number_suffix: '',
};

export default function FacilityConfigurations() {
  const { user, hasPrivilege } = useAuth();
  const canWrite = hasPrivilege('setup.facility_settings.manage');

  const [settings, setSettings] = useState<FacilitySettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/facility-settings', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setSettings({
          queue_receipt_enabled: data.queue_receipt_enabled !== false,
          billing_redirect_after_queue_enabled: data.billing_redirect_after_queue_enabled !== false,
          patient_number_prefix: data.patient_number_prefix || 'PTN',
          patient_number_suffix: data.patient_number_suffix || '',
        });
      } else {
        toast.error('Failed to load configurations');
      }
    } catch {
      toast.error('Network error loading configurations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await authFetch('/api/facility-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ clinic_id: user?.clinic, ...settings }),
      });
      if (res.ok) {
        toast.success('Configurations saved');
        load(); // picks up the server's own cleaned-up prefix/suffix (uppercased, trimmed)
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to save configurations');
      }
    } catch {
      toast.error('Network error saving configurations');
    } finally {
      setSaving(false);
    }
  };

  const previewNumber = `${settings.patient_number_prefix || 'PTN'}-000182${settings.patient_number_suffix ? `-${settings.patient_number_suffix}` : ''}`;

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="animate-fade-in w-full flex flex-col max-w-3xl">
        <PageHeader icon={<Settings />} title="Configurations" />

        {loading ? (
          <LoadingState message="Loading configurations..." />
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Patient Registration &amp; Queue</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">Print queue receipt</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Print a thermal slip with the queue number and patient number whenever a patient is queued at LIS Registration.</p>
                  </div>
                  <Switch
                    checked={settings.queue_receipt_enabled}
                    onCheckedChange={(v) => setSettings((s) => ({ ...s, queue_receipt_enabled: v }))}
                    disabled={!canWrite}
                  />
                </div>

                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">Go straight to billing after queuing</p>
                    <p className="text-xs text-muted-foreground mt-0.5">After a patient is queued, jump straight to their bill. Turn this off if your front desk bills separately — the bill is still created either way.</p>
                  </div>
                  <Switch
                    checked={settings.billing_redirect_after_queue_enabled}
                    onCheckedChange={(v) => setSettings((s) => ({ ...s, billing_redirect_after_queue_enabled: v }))}
                    disabled={!canWrite}
                  />
                </div>

                <div className="pt-2 border-t border-border">
                  <p className="text-sm font-medium text-foreground mb-1">Patient number format</p>
                  <p className="text-xs text-muted-foreground mb-3">Choose a prefix and, optionally, a suffix for every new patient number this facility generates — the 6-digit sequential number in the middle stays the same either way.</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs">Prefix</Label>
                      <Input
                        value={settings.patient_number_prefix}
                        onChange={(e) => setSettings((s) => ({ ...s, patient_number_prefix: e.target.value.toUpperCase() }))}
                        placeholder="PTN"
                        maxLength={20}
                        disabled={!canWrite}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Suffix (optional)</Label>
                      <Input
                        value={settings.patient_number_suffix}
                        onChange={(e) => setSettings((s) => ({ ...s, patient_number_suffix: e.target.value.toUpperCase() }))}
                        placeholder="e.g. MAIN"
                        maxLength={20}
                        disabled={!canWrite}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Example: <span className="font-mono font-medium text-foreground">{previewNumber}</span>
                  </p>
                </div>
              </CardContent>
            </Card>

            {canWrite && (
              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving} className="gap-1.5">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Changes
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      </div>
    </AppLayout>
  );
}
