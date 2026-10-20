import React, { useEffect, useRef, useState } from 'react';
import { platformFetch } from '@/api/platformApiClient';
import { PlatformAppLayout } from '@/components/layout/PlatformAppLayout';
import { PageHeader } from '@/components/common/PageHeader/PageHeader';
import { LoadingState } from '@/components/common/LoadingState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Building2, Loader2, Save, Stamp, Upload, X } from 'lucide-react';
import { toast } from 'sonner';

interface CompanyProfileForm {
  company_name: string; address: string; city: string; phone: string; email: string; website: string; logo: string; stamp: string;
  bank_name: string; bank_account_name: string; bank_account_number: string; bank_swift: string;
}

const empty: CompanyProfileForm = {
  company_name: '', address: '', city: '', phone: '', email: '', website: '', logo: '', stamp: '',
  bank_name: '', bank_account_name: '', bank_account_number: '', bank_swift: '',
};

const PlatformCompanyProfile: React.FC = () => {
  const [form, setForm] = useState<CompanyProfileForm>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const stampInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await platformFetch('/company-profile');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load company profile');
      setForm({
        company_name: data.company_name || '', address: data.address || '', city: data.city || '',
        phone: data.phone || '', email: data.email || '', website: data.website || '', logo: data.logo || '', stamp: data.stamp || '',
        bank_name: data.bank_name || '', bank_account_name: data.bank_account_name || '',
        bank_account_number: data.bank_account_number || '', bank_swift: data.bank_swift || '',
      });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Same shrink-to-fit-under-a-size-ceiling conversion as the tenant side's
  // Facility logo upload (src/pages/setup/FacilitySetup.tsx) — a print
  // window carries no auth, so an image has to be embedded as a data URI
  // rather than served from a protected endpoint. Shared by both the logo
  // and the electronic stamp, which only differ in which form field they
  // land in and what the success toast calls them.
  const IMG_MAX_PX = 512;
  const IMG_MAX_BYTES = 5 * 1024 * 1024;
  const IMG_TARGET_BYTES = 250 * 1024;

  const handleImageUpload = (field: 'logo' | 'stamp', label: string) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please choose an image file'); return; }
    if (file.size > IMG_MAX_BYTES) { toast.error('Image is too large — please use one under 5MB'); return; }

    const reader = new FileReader();
    reader.onerror = () => toast.error('Could not read that file');
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => toast.error('That file is not a readable image');
      img.onload = () => {
        const render = (maxPx: number): string | null => {
          const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return null;
          ctx.drawImage(img, 0, 0, w, h);
          return canvas.toDataURL('image/png');
        };
        let out: string | null = null;
        for (const px of [IMG_MAX_PX, 384, 256, 192, 128]) {
          out = render(px);
          if (!out) { toast.error('Could not process the image'); return; }
          if (out.length <= IMG_TARGET_BYTES) break;
        }
        if (!out || out.length > IMG_TARGET_BYTES) { toast.error(`That image is too detailed to use as a ${label.toLowerCase()} — try a simpler or smaller one`); return; }
        setForm((f) => ({ ...f, [field]: out as string }));
        toast.success(`${label} ready (${Math.round(out.length / 1024)}KB) — save to apply it`);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleLogoUpload = handleImageUpload('logo', 'Logo');
  const handleStampUpload = handleImageUpload('stamp', 'Stamp');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await platformFetch('/company-profile', { method: 'PUT', body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save company profile');
      toast.success('Company profile saved');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PlatformAppLayout><LoadingState message="Loading company profile..." /></PlatformAppLayout>;

  return (
    <PlatformAppLayout>
      <PageHeader
        icon={<Building2 />}
        title="Company Profile"
        subtitle="Your letterhead details — shown on every quotation this panel generates"
      />

      <form onSubmit={handleSave} className="max-w-2xl">
        <Card>
          <CardContent className="p-5 space-y-5">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-lg border border-border bg-muted/30 flex items-center justify-center overflow-hidden shrink-0">
                {form.logo ? <img src={form.logo} alt="Company logo" className="h-full w-full object-contain" /> : <Building2 className="h-6 w-6 text-muted-foreground" />}
              </div>
              <div className="flex gap-2">
                <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                <Button type="button" variant="outline" size="sm" onClick={() => logoInputRef.current?.click()} className="gap-1.5">
                  <Upload className="h-3.5 w-3.5" /> {form.logo ? 'Replace logo' : 'Upload logo'}
                </Button>
                {form.logo && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, logo: '' })} className="gap-1.5 text-muted-foreground">
                    <X className="h-3.5 w-3.5" /> Remove
                  </Button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-lg border border-border bg-muted/30 flex items-center justify-center overflow-hidden shrink-0">
                {form.stamp ? <img src={form.stamp} alt="Company stamp" className="h-full w-full object-contain" /> : <Stamp className="h-6 w-6 text-muted-foreground" />}
              </div>
              <div>
                <input ref={stampInputRef} type="file" accept="image/*" onChange={handleStampUpload} className="hidden" />
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => stampInputRef.current?.click()} className="gap-1.5">
                    <Upload className="h-3.5 w-3.5" /> {form.stamp ? 'Replace stamp' : 'Upload electronic stamp'}
                  </Button>
                  {form.stamp && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, stamp: '' })} className="gap-1.5 text-muted-foreground">
                      <X className="h-3.5 w-3.5" /> Remove
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">A transparent PNG of your company seal — stamped onto every generated quotation.</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Company Name *</Label>
              <Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Address</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Website</Label>
              <Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://..." />
            </div>

            <div className="pt-4 border-t border-border">
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Bank Details (optional — shown on quotations if set)</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Bank Name</Label>
                  <Input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Account Name</Label>
                  <Input value={form.bank_account_name} onChange={(e) => setForm({ ...form, bank_account_name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Account Number</Label>
                  <Input value={form.bank_account_number} onChange={(e) => setForm({ ...form, bank_account_number: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>SWIFT</Label>
                  <Input value={form.bank_swift} onChange={(e) => setForm({ ...form, bank_swift: e.target.value })} />
                </div>
              </div>
            </div>

            <Button type="submit" disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4" /> Save Changes</>}
            </Button>
          </CardContent>
        </Card>
      </form>
    </PlatformAppLayout>
  );
};

export default PlatformCompanyProfile;
