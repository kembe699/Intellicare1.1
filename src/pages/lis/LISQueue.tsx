import React, { useState, useEffect, useRef } from 'react';
import { Users, Clock, ArrowRight, Volume2, VolumeX, MonitorPlay } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { authFetch } from '@/api/apiClient';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

// Custom format timer
const formatWaitTime = (createdAt: string) => {
  const diff = Date.now() - new Date(createdAt).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export default function LISQueue() {
  const [queue, setQueue] = useState<any[]>([]);
  const [now, setNow] = useState(Date.now());
  const [audioEnabled, setAudioEnabled] = useState(true);
  const calledOrdersRef = useRef<Map<string, string>>(new Map());
  const isFirstLoadRef = useRef(true);

  // A single pooled queue — lis_test_orders has no per-terminal/facility scoping column,
  // and clinic_id on the order itself means "which destination clinic/department" (e.g.
  // GP Consultation), not "which facility", so it can't be used to scope this per-terminal.
  const fetchQueue = async () => {
    try {
      const res = await authFetch('/api/lis/queue', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setQueue(data);
        handleNewCalls(data);
      }
    } catch (e) {
      console.error('Failed to fetch queue', e);
    }
  };

  const handleNewCalls = (currentQueue: any[]) => {
    currentQueue.forEach(p => {
      if (p.status === 'called') {
        const lastUpdated = calledOrdersRef.current.get(p.order_id);
        if (lastUpdated !== p.updated_at) {
          calledOrdersRef.current.set(p.order_id, p.updated_at);
          
          // Trigger announcement if audio is enabled and it's not the initial page load
        if (audioEnabled && !isFirstLoadRef.current) {
          window.speechSynthesis.cancel(); // Clear any stuck utterances
          const doctorStr = p.doctor_name ? `Doctor ${p.doctor_name}` : 'the General Laboratory';
          let announcement = '';
          if (p.room_number && p.doctor_name) {
            announcement = `Patient ${p.first_name} ${p.last_name}, please proceed to ${p.room_number} to see Doctor ${p.doctor_name}.`;
          } else if (p.room_number) {
            announcement = `Patient ${p.first_name} ${p.last_name}, please proceed to ${p.room_number}.`;
          } else {
            announcement = `Patient ${p.first_name} ${p.last_name}, please proceed to ${doctorStr}.`;
          }
          const utterance = new SpeechSynthesisUtterance(announcement);
          utterance.rate = 0.85;
          utterance.pitch = 1;
          window.speechSynthesis.speak(utterance);
        }
        }
      }
    });
    
    // Mark first load as complete after the first pass
    if (isFirstLoadRef.current) {
      isFirstLoadRef.current = false;
    }
  };

  useEffect(() => {
    fetchQueue();
    const fetchInterval = setInterval(fetchQueue, 3000);
    const tickInterval = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(fetchInterval);
      clearInterval(tickInterval);
    };
  }, [audioEnabled]);

  const toggleAudio = () => {
    const nextState = !audioEnabled;
    setAudioEnabled(nextState);
    
    // Unlock and clear speech synthesis on user interaction
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    
    if (nextState) {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance('Audio enabled'));
    }
  };

  // Backend returns oldest-first (o.created_at ASC) — re-sort latest-first just for this
  // waiting-list table.
  const waiting = queue
    .filter(q => q.status === 'waiting')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const called = queue.filter(q => q.status === 'called').slice(0, 5); // Only show last 5 called

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <PageHeader
        title="Laboratory Queue"
        icon={<MonitorPlay />}
        className="mb-3"
        actions={
          <button
            onClick={toggleAudio}
            className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${audioEnabled ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}
            title="Toggle Voice Announcements (Click required for auto-play)"
          >
            {audioEnabled ? <><Volume2 className="w-4 h-4" /> Audio On</> : <><VolumeX className="w-4 h-4" /> Audio Off</>}
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* CURRENTLY CALLED (Highlights) */}
        <div className="lg:col-span-1 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Now Calling</h2>
            <div className="text-sm text-muted-foreground font-mono">{new Date(now).toLocaleTimeString()}</div>
          </div>
          
          {called.length > 0 ? (
            <div className="space-y-4">
              {called.map((p, idx) => (
                <Card key={p.order_id} className={`p-6 border-2 relative overflow-hidden transition-all ${idx === 0 ? 'bg-card border-primary shadow-md' : 'bg-card border-border opacity-70'}`}>
                  {idx === 0 && <div className="absolute inset-0 bg-primary/10 animate-pulse opacity-50"></div>}
                  <div className="relative z-10">
                    <div className="text-xs uppercase tracking-widest font-bold text-muted-foreground mb-1">Queue No: {p.participant_number}</div>
                    <div className={`text-3xl font-extrabold mb-4 ${idx === 0 ? 'text-primary' : 'text-card-foreground'}`}>
                      {p.first_name} {p.last_name}
                    </div>
                    <div className="flex flex-col gap-1 border-t pt-3">
                      <div className="font-mono text-sm text-muted-foreground">
                        Proceed To:
                      </div>
                      <div className="text-xl font-bold truncate text-muted-foreground flex flex-col">
                        {p.room_number && <span className="text-primary">{p.room_number}</span>}
                        <span>{p.doctor_name ? `Dr. ${p.doctor_name}` : 'General Lab'}</span>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="h-48 flex flex-col items-center justify-center text-muted-foreground border-dashed">
              <Users className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm font-medium">No one is currently called</p>
            </Card>
          )}
        </div>

        {/* WAITING LIST */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Waiting List</h2>
            <span className="bg-muted text-muted-foreground text-xs px-2 py-1 rounded-md font-medium">
              {waiting.length} Waiting
            </span>
          </div>
          
          <AdvancedDataTable<any>
            data={waiting}
            keyExtractor={(p) => p.order_id}
            emptyMessage="The waiting list is currently empty."
            columns={[
              { key: 'participant_number', header: 'Queue ID', render: (v) => <span className="font-mono text-sm text-muted-foreground">{v}</span> },
              { key: 'first_name', header: 'Patient Name', render: (_v, p) => <span className="font-semibold">{p.first_name} {p.last_name}</span> },
              {
                key: 'doctor_name', header: 'Assigned To',
                render: (v) => (
                  <div className="inline-flex items-center gap-1.5 bg-secondary px-2.5 py-0.5 rounded-full text-xs font-medium">
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                    {v ? `Dr. ${v}` : 'General'}
                  </div>
                ),
              },
              {
                key: 'created_at', header: 'Wait Time', align: 'right',
                render: (v) => (
                  <div className="inline-flex items-center gap-1.5 font-mono text-sm text-amber-600 dark:text-amber-500 font-medium">
                    <Clock className="w-3.5 h-3.5 opacity-70" />
                    {formatWaitTime(v)}
                  </div>
                ),
              },
            ]}
          />
        </div>

      </div>
      </div>
    </AppLayout>
  );
}
