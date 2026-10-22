import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { authFetch } from '@/api/apiClient';
import { toast } from '@/lib/notify';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { MapPin, Plus, Loader2, QrCode, RefreshCw, Crosshair, Search } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Circle, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Default Leaflet marker icons reference image files via a bundler-relative
// path that Vite doesn't resolve the same way webpack did — without this,
// the pin renders as a broken image. Pulling the marker PNGs from the
// installed package's own dist folder via Vite's `?url` import keeps this
// working without needing a public/ copy.
import markerIconUrl from 'leaflet/dist/images/marker-icon.png?url';
import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png?url';
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png?url';
L.Icon.Default.mergeOptions({ iconUrl: markerIconUrl, iconRetinaUrl: markerIcon2xUrl, shadowUrl: markerShadowUrl });

interface AttendanceSite {
  id: string;
  name: string;
  branch_id: number;
  latitude: string;
  longitude: string;
  radius_m: number;
  is_active: boolean;
  qr_mode: 'printed' | 'rotating';
  qr_key_created_at: string | null;
}

const DEFAULT_CENTER: [number, number] = [4.85, 31.58]; // Juba, South Sudan — a reasonable fallback, not a guess at any real site

function ClickToPlace({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPlace(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Imperatively pans the map when a search result or "use my location" sets
// a new position — MapContainer's `center` prop only applies on first
// mount, so without this the marker/circle would jump to the new spot
// while the visible map stayed put. Only fires when `panTo` itself
// changes (a new search/geolocation result), never on every render, so it
// doesn't fight the user's own click-to-place or manual drag/zoom.
function PanTo({ panTo }: { panTo: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (panTo) map.setView(panTo, map.getZoom());
  }, [panTo, map]);
  return null;
}

function SiteFormDialog({
  open, onOpenChange, site, onSaved,
}: { open: boolean; onOpenChange: (v: boolean) => void; site: AttendanceSite | null; onSaved: () => void }) {
  const isEdit = !!site;
  const [name, setName] = useState('');
  const [lat, setLat] = useState(DEFAULT_CENTER[0]);
  const [lng, setLng] = useState(DEFAULT_CENTER[1]);
  const [radius, setRadius] = useState(100);
  const [qrMode, setQrMode] = useState<'printed' | 'rotating'>('printed');
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{ display_name: string; lat: string; lon: string }>>([]);
  const [panTo, setPanTo] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (open) {
      if (site) {
        setName(site.name);
        setLat(parseFloat(site.latitude));
        setLng(parseFloat(site.longitude));
        setRadius(site.radius_m);
        setQrMode(site.qr_mode);
      } else {
        setName('');
        setLat(DEFAULT_CENTER[0]);
        setLng(DEFAULT_CENTER[1]);
        setRadius(100);
        setQrMode('printed');
      }
      setSearchQuery('');
      setSearchResults([]);
      setPanTo(null);
    }
  }, [open, site]);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Location is not available on this device/browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(pos.coords.latitude); setLng(pos.coords.longitude); setPanTo([pos.coords.latitude, pos.coords.longitude]); },
      () => toast.error('Could not get your current location. Check location permissions.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const runSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      // OpenStreetMap's free Nominatim search — no API key, per spec. Only
      // called on explicit button press (never per-keystroke) to stay a
      // reasonable citizen of a free shared service.
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      setSearchResults(data || []);
    } catch (e) {
      toast.error('Search failed. You can still place the pin manually.');
    } finally {
      setSearching(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Site name is required.'); return; }
    if (radius < 30 || radius > 2000) { toast.error('Radius must be between 30 and 2000 meters.'); return; }
    setSaving(true);
    try {
      const body = { name: name.trim(), latitude: lat, longitude: lng, radius_m: radius, qr_mode: qrMode };
      const res = await authFetch(isEdit ? `/api/attendance/sites/${site!.id}` : '/api/attendance/sites', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to save attendance site.');
        return;
      }
      toast.success(isEdit ? 'Attendance site updated.' : 'Attendance site created.');
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error('Failed to save attendance site.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Attendance Site' : 'New Attendance Site'}</DialogTitle>
          <DialogDescription>Click the map to place the site's centre, or search / use your current location.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="site-name">Site name</Label>
            <Input id="site-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Gate" />
          </div>

          <div className="flex gap-2">
            <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search for a place..."
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } }} />
            <Button type="button" variant="outline" onClick={runSearch} disabled={searching}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
            <Button type="button" variant="outline" onClick={useMyLocation} title="Use my current location">
              <Crosshair className="h-4 w-4" />
            </Button>
          </div>
          {searchResults.length > 0 && (
            <div className="border rounded-md divide-y max-h-32 overflow-y-auto">
              {searchResults.map((r, i) => (
                <button key={i} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                  onClick={() => { const la = parseFloat(r.lat); const lo = parseFloat(r.lon); setLat(la); setLng(lo); setPanTo([la, lo]); setSearchResults([]); }}>
                  {r.display_name}
                </button>
              ))}
            </div>
          )}

          <div className="h-64 rounded-md overflow-hidden border">
            <MapContainer center={[lat, lng]} zoom={16} style={{ height: '100%', width: '100%' }} key={open ? 'open' : 'closed'}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap contributors' />
              <PanTo panTo={panTo} />
              <ClickToPlace onPlace={(a, b) => { setLat(a); setLng(b); }} />
              <Marker position={[lat, lng]} />
              <Circle center={[lat, lng]} radius={radius} pathOptions={{ color: '#077A84', fillColor: '#0A96A1', fillOpacity: 0.15 }} />
            </MapContainer>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="site-lat">Latitude</Label>
              <Input id="site-lat" type="number" step="0.000001" value={lat} onChange={(e) => setLat(parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <Label htmlFor="site-lng">Longitude</Label>
              <Input id="site-lng" type="number" step="0.000001" value={lng} onChange={(e) => setLng(parseFloat(e.target.value) || 0)} />
            </div>
          </div>

          <div>
            <Label htmlFor="site-radius">Radius (meters) — 30 to 2000</Label>
            <Input id="site-radius" type="number" min={30} max={2000} value={radius} onChange={(e) => setRadius(parseInt(e.target.value, 10) || 100)} />
          </div>

          <div>
            <Label>QR code type</Label>
            <Select value={qrMode} onValueChange={(v) => setQrMode(v as 'printed' | 'rotating')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="printed">Printed poster (static code, regenerate to invalidate)</SelectItem>
                <SelectItem value="rotating">Rotating display (tablet/monitor, refreshes every 30s)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {isEdit ? 'Save changes' : 'Create site'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function QrDialog({ open, onOpenChange, site }: { open: boolean; onOpenChange: (v: boolean) => void; site: AttendanceSite | null }) {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!site) return;
    setLoading(true);
    try {
      const res = await authFetch(`/api/attendance/sites/${site.id}/qr?origin=${encodeURIComponent(window.location.origin)}`);
      if (res.ok) {
        const data = await res.json();
        setQrDataUrl(data.qr_data_url);
      } else {
        toast.error('Could not generate QR code.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open && site?.qr_mode === 'printed') load(); }, [open, site]);

  const regenerate = async () => {
    if (!site) return;
    if (!(await confirm({ title: 'Regenerate QR code?', description: 'The old printed poster will stop working immediately. You will need to print and distribute the new one.', destructive: true }))) return;
    const res = await authFetch(`/api/attendance/sites/${site.id}/regenerate-key`, { method: 'POST' });
    if (res.ok) { toast.success('QR key regenerated.'); load(); } else { toast.error('Failed to regenerate QR key.'); }
  };

  if (!site) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {confirmDialog}
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{site.name} — QR code</DialogTitle>
          <DialogDescription>
            {site.qr_mode === 'printed'
              ? 'Print this poster and display it at the site. Scanning it with a phone camera opens the clock-in page.'
              : 'This site uses a rotating display. Open the display screen on a tablet or monitor at the site.'}
          </DialogDescription>
        </DialogHeader>
        {site.qr_mode === 'printed' ? (
          <div className="flex flex-col items-center gap-4 py-2" id="qr-poster-print-area">
            {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : qrDataUrl ? (
              <>
                <img src={qrDataUrl} alt="Attendance QR code" className="w-56 h-56" />
                <p className="text-center text-sm text-muted-foreground">Scan with your phone camera to clock in or out — {site.name}</p>
              </>
            ) : null}
            <div className="flex gap-2 print:hidden">
              <Button variant="outline" onClick={() => window.print()}>Print poster</Button>
              <Button variant="outline" onClick={regenerate}><RefreshCw className="h-4 w-4 mr-1" /> Regenerate</Button>
            </div>
          </div>
        ) : (
          <div className="py-4 text-center">
            <Button onClick={() => window.open(`/attendance/display/${site.id}`, '_blank')}>
              Open rotating display
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function AttendanceSites() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [sites, setSites] = useState<AttendanceSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<AttendanceSite | null>(null);
  const [qrSite, setQrSite] = useState<AttendanceSite | null>(null);

  const fetchSites = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/attendance/sites');
      if (res.ok) setSites(await res.json());
      else toast.error('Failed to load attendance sites.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSites(); }, []);

  const toggleActive = async (s: AttendanceSite) => {
    const verb = s.is_active ? 'deactivate' : 'activate';
    if (!(await confirm({ title: `${verb === 'deactivate' ? 'Deactivate' : 'Activate'} this site?`, description: `Employees will ${s.is_active ? 'no longer' : 'again'} be able to clock in/out at ${s.name}.` }))) return;
    const res = await authFetch(`/api/attendance/sites/${s.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !s.is_active }),
    });
    if (res.ok) { toast.success(`Site ${verb}d.`); fetchSites(); } else { toast.error(`Failed to ${verb} site.`); }
  };

  return (
    <AppLayout>
      {confirmDialog}
      <PageHeader
        title="Attendance Sites"
        subtitle="Geofenced locations employees can clock in/out from"
        icon={<MapPin />}
        actions={<Button onClick={() => { setEditingSite(null); setFormOpen(true); }}><Plus className="h-4 w-4 mr-1" /> New Site</Button>}
      />

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : sites.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No attendance sites yet. Create one to start generating QR codes for geofenced clock-in.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sites.map((s) => (
            <div key={s.id} className="bg-card rounded-lg border shadow-sm p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{s.name}</h3>
                <Switch checked={s.is_active} onCheckedChange={() => toggleActive(s)} />
              </div>
              <p className="text-sm text-muted-foreground">Radius: {s.radius_m}m · {s.qr_mode === 'printed' ? 'Printed QR' : 'Rotating display'}</p>
              <div className="flex gap-2 pt-2">
                <Button size="sm" variant="outline" onClick={() => { setEditingSite(s); setFormOpen(true); }}>Edit</Button>
                <Button size="sm" variant="outline" onClick={() => setQrSite(s)}><QrCode className="h-4 w-4 mr-1" /> QR</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SiteFormDialog open={formOpen} onOpenChange={setFormOpen} site={editingSite} onSaved={fetchSites} />
      <QrDialog open={!!qrSite} onOpenChange={(v) => !v && setQrSite(null)} site={qrSite} />
    </AppLayout>
  );
}
