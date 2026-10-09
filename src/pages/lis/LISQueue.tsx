import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Clock, ArrowRight, Volume2, VolumeX, MonitorPlay, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { authFetch } from '@/api/apiClient';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';

// Custom format timer
const formatWaitTime = (createdAt: string) => {
  const diff = Date.now() - new Date(createdAt).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export default function LISQueue() {
  const navigate = useNavigate();
  const facilityInfo = useFacilityInfo();
  const [queue, setQueue] = useState<any[]>([]);
  const [now, setNow] = useState(Date.now());
  const [audioEnabled, setAudioEnabled] = useState(true);
  const calledOrdersRef = useRef<Map<string, string>>(new Map());
  const isFirstLoadRef = useRef(true);
  const announcerRef = useRef<HTMLAudioElement | null>(null);
  // Serializes announcements so two patients called back-to-back don't cut
  // each other off on the shared <audio> element — each one's full
  // (double) announcement finishes before the next one starts.
  const announcementChainRef = useRef<Promise<void>>(Promise.resolve());

  // Natural-sounding neural voice (see POST /api/lis/queue/announce) instead of
  // the browser's own speechSynthesis, which is universally synthetic-sounding.
  // One shared <audio> element, reused across calls, rather than a new Audio()
  // per announcement — keeps a single, predictable "is something unlocked yet"
  // state for the browser's autoplay-gesture requirement (see toggleAudio).
  //
  // Falls back to the old robotic browser voice on any failure (network,
  // the TTS service being down, etc.) rather than going silent — a patient
  // waiting on an audio cue to know they're being called is a real-world
  // consequence of "no sound at all", worse than a less-natural voice.
  //
  // Resolves only once playback actually finishes (not just once it starts),
  // so callers can chain a second play after the first one is really done.
  const playAnnouncementOnce = (text: string): Promise<void> => new Promise((resolve) => {
    (async () => {
      try {
        const res = await authFetch('/api/lis/queue/announce', {
          method: 'POST',
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error(`TTS request failed: ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (!announcerRef.current) announcerRef.current = new Audio();
        const audio = announcerRef.current;
        audio.pause();
        audio.src = url;
        audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        await audio.play();
      } catch (e) {
        console.error('Natural voice announcement failed, falling back to the browser voice:', e);
        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          window.speechSynthesis.speak(utterance);
        } catch (fallbackError) {
          console.error('Fallback browser voice also failed', fallbackError);
          resolve();
        }
      }
    })();
  });

  // A patient call is announced TWICE back-to-back, then stays silent until
  // the doctor calls again (a fresh updated_at — see handleNewCalls' dedup) —
  // once is easy to miss in a noisy waiting room, continuous repetition is
  // just noise, so twice-and-stop is the balance asked for.
  const announceCalled = (text: string) => {
    announcementChainRef.current = announcementChainRef.current
      .then(() => playAnnouncementOnce(text))
      .then(() => new Promise<void>((r) => setTimeout(r, 400)))
      .then(() => playAnnouncementOnce(text))
      .catch(() => {});
  };

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

          // Trigger announcement if audio is enabled and it's not the initial page load.
          // Queue number + destination only — no patient or doctor name read aloud
          // over the waiting-room speaker.
          if (audioEnabled && !isFirstLoadRef.current) {
            const destination = p.room_number || p.clinic_name || 'the next available room';
            // Spaced-out digits ("0 0 0 0 1") so the TTS voice reads the actual
            // padded ticket number digit-by-digit ("zero zero zero zero one"),
            // matching the printed receipt, instead of collapsing "00001" down
            // to just "one".
            const announcement = p.queue_number != null
              ? `Queue number ${String(p.queue_number).padStart(5, '0').split('').join(' ')}, please proceed to ${destination}.`
              : `Please proceed to ${destination}.`;
            announceCalled(announcement);
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

    if (nextState) {
      // Also serves as the browser's required user-gesture "unlock" for the
      // shared <audio> element — this click is what makes .play() allowed.
      // Single play, not the double-call announcement — it's a UI confirmation, not a call.
      playAnnouncementOnce('Audio enabled');
    } else {
      announcerRef.current?.pause();
    }
  };

  // Backend returns oldest-first (o.created_at ASC) — re-sort latest-first just for this
  // waiting-list table.
  const waiting = queue
    .filter(q => q.status === 'waiting')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const called = queue.filter(q => q.status === 'called').slice(0, 5); // Only show last 5 called

  // Deliberately NOT wrapped in AppLayout — this page is a waiting-room TV
  // display, not a staff admin screen, so the sidebar/topbar chrome would
  // only waste space and distract from what matters at a glance: who's
  // being called and how long the line is. Stays on the app's normal light
  // theme (not `.dark`) — every shared component below (Card,
  // AdvancedDataTable, badges) already uses the same design-system tokens,
  // so this is still the same look as the rest of the app, just without the
  // nav chrome.
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="flex items-center justify-between gap-4 px-6 lg:px-10 py-4 border-b border-border bg-card/60 backdrop-blur shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
            <MonitorPlay className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg lg:text-xl font-bold tracking-tight truncate">
              {facilityInfo.facilityName ? `${facilityInfo.facilityName} — ` : ''}Laboratory Queue
            </h1>
            <p className="text-xs text-muted-foreground">Live waiting-room display</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 lg:gap-4 shrink-0">
          <div className="hidden sm:block text-xl lg:text-2xl font-mono font-semibold tabular-nums tracking-tight">
            {new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
          <button
            onClick={toggleAudio}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${audioEnabled ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'}`}
            title="Toggle voice announcements (click required for auto-play)"
          >
            {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            <span className="hidden sm:inline">{audioEnabled ? 'Audio On' : 'Audio Off'}</span>
          </button>
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
            title="Exit display and return to the dashboard"
          >
            <X className="w-4 h-4" />
            <span className="hidden sm:inline">Exit</span>
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-5 gap-6 p-6 lg:p-8">
        {/* NOW CALLING */}
        <section className="lg:col-span-2 flex flex-col min-h-0">
          <div className="flex items-center gap-2 mb-4 shrink-0">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
            </span>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Now Calling</h2>
          </div>

          {called.length > 0 ? (
            <div className="flex flex-col gap-4 overflow-y-auto pr-1">
              {called.map((p, idx) => (
                <Card
                  key={p.order_id}
                  className={idx === 0
                    ? 'p-7 border-2 border-primary bg-primary/10 shadow-lg shadow-primary/10 relative overflow-hidden'
                    : 'p-5 border border-border bg-card/60'}
                >
                  {idx === 0 && <div className="absolute inset-0 bg-primary/5 animate-pulse pointer-events-none" />}
                  <div className="relative z-10">
                    <div className={`text-xs uppercase tracking-widest font-bold mb-1.5 ${idx === 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                      Queue No. {p.participant_number}
                    </div>
                    <div className={idx === 0 ? 'text-4xl lg:text-5xl font-extrabold tracking-tight mb-4' : 'text-xl font-bold mb-2'}>
                      {p.first_name} {p.last_name}
                    </div>
                    <div className={`flex items-center gap-2 flex-wrap ${idx === 0 ? 'pt-4 border-t border-primary/20' : 'pt-2 border-t border-border'}`}>
                      <ArrowRight className={idx === 0 ? 'w-5 h-5 text-primary shrink-0' : 'w-4 h-4 text-muted-foreground shrink-0'} />
                      <span className={idx === 0 ? 'text-2xl font-bold text-primary' : 'text-sm font-semibold'}>
                        {p.room_number || (p.doctor_name ? `Dr. ${p.doctor_name}` : 'General Lab')}
                      </span>
                      {idx === 0 && p.room_number && p.doctor_name && (
                        <span className="text-muted-foreground text-sm">· Dr. {p.doctor_name}</span>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="flex-1 min-h-[16rem] flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed bg-transparent">
              <Users className="w-12 h-12 mb-3 opacity-20" />
              <p className="text-sm font-medium">No one is currently called</p>
            </Card>
          )}
        </section>

        {/* WAITING LIST */}
        <section className="lg:col-span-3 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Waiting List</h2>
            <span className="bg-secondary text-secondary-foreground text-xs font-semibold px-2.5 py-1 rounded-full">
              {waiting.length} waiting
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-border bg-card/40">
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
                    <div className="inline-flex items-center gap-1.5 font-mono text-sm text-amber-600 font-medium">
                      <Clock className="w-3.5 h-3.5 opacity-70" />
                      {formatWaitTime(v)}
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
