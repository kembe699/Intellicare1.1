import React, { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge } from '@/components/common';
import { authFetch } from '@/api/apiClient';
import { toast } from '@/lib/notify';
import { FlaskConical, MessageSquare, Image, CreditCard, Phone, Cpu, Grid, User, Key, RefreshCw, Copy, ShieldOff, CheckCircle, Clock, AlertCircle, ChevronRight, Loader2, Eye, EyeOff, Zap, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { formatDate } from '@/lib/format';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ConfigType {
  id: string;
  label: string;
  description: string;
  icon: string;
  token: {
    id: number;
    token_preview: string;
    created_by: string;
    created_at: string;
    last_used_at: string | null;
    is_active: boolean;
  } | null;
}

// ─── Icon map ─────────────────────────────────────────────────────────────────
const ICON_MAP: Record<string, React.ElementType> = {
  flask: FlaskConical,
  message: MessageSquare,
  image: Image,
  'credit-card': CreditCard,
  phone: Phone,
  cpu: Cpu,
  grid: Grid,
  'user-circle': User,
  key: Key,
};

// ─── Main Component ───────────────────────────────────────────────────────────
const ApiConfigurations: React.FC = () => {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [configs, setConfigs] = useState<ConfigType[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ConfigType | null>(null);

  // Token generation state
  const [generating, setGenerating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);

  // Revoke state
  const [revoking, setRevoking] = useState(false);

  // ─── Fetch ─────────────────────────────────────────────────────────────────
  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/configurations');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setConfigs(data.data || []);
      // Keep selected in sync
      if (selected) {
        const refreshed = (data.data || []).find((c: ConfigType) => c.id === selected.id);
        if (refreshed) setSelected(refreshed);
      }
    } catch (e) {
      toast.error('Failed to load API configurations');
    } finally {
      setLoading(false);
    }
  }, [selected?.id]);

  useEffect(() => {
    fetchConfigs();
  }, []);

  // ─── Generate Token ─────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!selected) return;
    if (!(await confirm({ description: `Generate a new token for "${selected.label}"? Any existing token will be revoked immediately.` }))) return;

    setGenerating(true);
    setNewToken(null);
    setCopied(false);

    try {
      const res = await authFetch('/api/configurations/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configType: selected.id }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Generation failed');
      }

      const data = await res.json();
      setNewToken(data.token);
      setShowToken(true);
      toast.success('New token generated! Copy it now — it won\'t be shown again.');
      fetchConfigs();
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate token');
    } finally {
      setGenerating(false);
    }
  };

  // ─── Revoke Token ───────────────────────────────────────────────────────────
  const handleRevoke = async () => {
    if (!selected?.token) return;
    if (!(await confirm({ description: `Revoke the token for "${selected.label}"? The Lab Agent will stop working until a new token is generated and pasted.` }))) return;

    setRevoking(true);
    try {
      const res = await authFetch(`/api/configurations/${selected.token.id}/revoke`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Revoke failed');

      toast.success('Token revoked successfully');
      setNewToken(null);
      fetchConfigs();
    } catch (e: any) {
      toast.error(e.message || 'Failed to revoke token');
    } finally {
      setRevoking(false);
    }
  };

  // ─── Copy to clipboard ──────────────────────────────────────────────────────
  const handleCopy = () => {
    if (!newToken) return;
    navigator.clipboard.writeText(newToken).then(() => {
      setCopied(true);
      toast.success('Token copied to clipboard!');
      setTimeout(() => setCopied(false), 3000);
    });
  };

  // ─── Select config ──────────────────────────────────────────────────────────
  const handleSelect = (cfg: ConfigType) => {
    setSelected(cfg);
    setNewToken(null);
    setCopied(false);
    setShowToken(false);
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      {confirmDialog}
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="animate-fade-in w-full flex flex-col">
        <PageHeader
          icon={<Settings />}
          title="API Configurations"
          actions={
            <Badge variant="outline" className="text-sm">
              <Key className="w-3.5 h-3.5 mr-1" />
              {configs.filter(c => c.token?.is_active).length} Active Token{configs.filter(c => c.token?.is_active).length !== 1 ? 's' : ''}
            </Badge>
          }
        />

        <div className="flex gap-6 h-[calc(100vh-200px)]">
          {/* ─── LEFT PANEL: Config list ─── */}
          <div className="w-72 bg-card rounded-lg border flex flex-col overflow-hidden shrink-0">
            <div className="px-4 py-3 border-b border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Select Configuration
              </p>
            </div>

            {loading ? (
              <div className="flex items-center justify-center flex-1 py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                {configs.map((cfg) => {
                  const Icon = ICON_MAP[cfg.icon] || Key;
                  const isActive = cfg.token?.is_active;
                  const isSelected = selected?.id === cfg.id;

                  return (
                    <button
                      key={cfg.id}
                      onClick={() => handleSelect(cfg)}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-3.5 text-left border-b border-border/50 transition-all',
                        'hover:bg-accent/50',
                        isSelected && 'bg-primary/5 border-l-2 border-l-primary'
                      )}
                    >
                      <Icon className="w-4 h-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          'text-sm font-medium truncate',
                          isSelected ? 'text-foreground' : 'text-foreground/80'
                        )}>
                          {cfg.label}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {isActive ? (
                            <span className="text-xs text-success font-medium flex items-center gap-1">
                              <CheckCircle className="w-2.5 h-2.5" /> Active
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <AlertCircle className="w-2.5 h-2.5" /> No token
                            </span>
                          )}
                        </div>
                      </div>
                      {isSelected && <ChevronRight className="w-4 h-4 text-primary shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ─── RIGHT PANEL: Detail view ─── */}
          <div className="flex-1 bg-card rounded-lg border overflow-y-auto">
            {!selected ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Key className="w-16 h-16 text-muted-foreground/20 mb-4" />
                <h3 className="text-lg font-medium text-foreground">Select a Configuration</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                  Choose an API configuration from the left to view its token and generate new credentials.
                </p>
              </div>
            ) : (
              <div className="p-6 space-y-6">
                {/* ── Header ── */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    {React.createElement(ICON_MAP[selected.icon] || Key, { className: 'w-6 h-6 text-primary' })}
                    <div>
                      <h2 className="text-xl font-semibold text-foreground">{selected.label}</h2>
                      <p className="text-sm text-muted-foreground mt-0.5">{selected.description}</p>
                    </div>
                  </div>
                  <StatusBadge
                    status={selected.token?.is_active ? 'active' : 'inactive'}
                    map={{ active: 'success', inactive: 'neutral' }}
                    label={selected.token?.is_active ? 'Token Active' : 'No Active Token'}
                  />
                </div>

                <div className="border-t border-border" />

                {/* ── Current Token Info ── */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">Access Token</h3>

                  {selected.token ? (
                    <div className="bg-muted/40 rounded-lg border border-border p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Token Preview</p>
                          <code className="text-sm font-mono text-foreground bg-background px-2 py-1 rounded border border-border">
                            {selected.token.token_preview}
                          </code>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border">
                        <div>
                          <p className="text-xs text-muted-foreground">Created By</p>
                          <p className="text-sm font-medium text-foreground mt-0.5">{selected.token.created_by}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Created</p>
                          <p className="text-sm font-medium text-foreground mt-0.5">
                            {formatDate(selected.token.created_at)} {new Date(selected.token.created_at).toLocaleTimeString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Last Used</p>
                          <p className="text-sm font-medium text-foreground mt-0.5 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-muted-foreground" />
                            {selected.token.last_used_at
                              ? new Date(selected.token.last_used_at).toLocaleString()
                              : 'Never'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Status</p>
                          <p className="text-sm font-medium text-success mt-0.5 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Active
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-muted/30 rounded-lg border border-dashed border-border p-6 text-center">
                      <AlertCircle className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No active token for this configuration.</p>
                      <p className="text-xs text-muted-foreground mt-1">Generate a token below to enable this integration.</p>
                    </div>
                  )}
                </div>

                {/* ── Newly Generated Token (one-time reveal) ── */}
                {newToken && (
                  <div className="bg-warning-bg border border-warning-border rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-warning" />
                      <p className="text-sm font-semibold text-warning">New Token Generated — Copy Now!</p>
                    </div>
                    <p className="text-xs text-warning">
                      This token will not be shown again. Copy it and paste it into the Lab Agent configuration.
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-white border border-warning-border rounded-md px-3 py-2 font-mono text-sm text-foreground overflow-x-auto">
                        {showToken ? newToken : '•'.repeat(Math.min(newToken.length, 48))}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowToken(!showToken)}
                        className="shrink-0 border-warning-border"
                      >
                        {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleCopy}
                        className={cn(
                          'shrink-0 transition-colors',
                          copied ? 'bg-success hover:bg-success' : ''
                        )}
                      >
                        {copied ? (
                          <><CheckCircle className="w-4 h-4 mr-1.5" /> Copied!</>
                        ) : (
                          <><Copy className="w-4 h-4 mr-1.5" /> Copy</>
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="border-t border-border" />

                {/* ── Actions ── */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">Actions</h3>
                  <div className="flex items-center gap-3">
                    <Button
                      onClick={handleGenerate}
                      disabled={generating}
                      className="flex items-center gap-2"
                    >
                      {generating ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
                      ) : (
                        <><RefreshCw className="w-4 h-4" /> Generate New Token</>
                      )}
                    </Button>

                    {selected.token?.is_active && (
                      <Button
                        variant="outline"
                        onClick={handleRevoke}
                        disabled={revoking}
                        className="flex items-center gap-2 text-destructive border-destructive/30 hover:bg-destructive/5"
                      >
                        {revoking ? (
                          <><Loader2 className="w-4 h-4 animate-spin" /> Revoking...</>
                        ) : (
                          <><ShieldOff className="w-4 h-4" /> Revoke Token</>
                        )}
                      </Button>
                    )}
                  </div>

                  {/* Instructions for Lab Agent */}
                  {selected.id === 'lab_machine' && (
                    <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 mt-2">
                      <h4 className="text-sm font-semibold text-primary mb-2">How to use with IntelliCare Lab Agent</h4>
                      <ol className="text-xs text-primary space-y-1.5 list-decimal list-inside">
                        <li>Generate a new token above.</li>
                        <li>Copy the full token (it looks like <code className="bg-primary/10 px-1 rounded font-mono">ic-labmachin:AbCdEf...</code>).</li>
                        <li>Open the <strong>IntelliCare Lab Agent</strong> desktop app on the lab PC.</li>
                        <li>Enter the API URL and paste the token into the <strong>Integration Token</strong> field.</li>
                        <li>Enter the MRCom port and click <strong>Start Agent</strong>.</li>
                      </ol>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
    </AppLayout>
  );
};

export default ApiConfigurations;
