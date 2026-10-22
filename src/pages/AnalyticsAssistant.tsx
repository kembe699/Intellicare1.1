import React, { useEffect, useRef, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { authFetch } from '@/api/apiClient';
import { toast } from '@/lib/notify';
import {
  Send, Plus, Trash2, MessageCircle, Sparkles, Menu, X, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  table?: { columns: string[]; rows: (string | number)[][] } | null;
  suggestions?: string[] | null;
  intent?: string | null;
  createdAt?: string;
  pending?: boolean;
}

/**
 * The Analytics Assistant — a natural-language analytics chatbot over
 * IntelliCare's own data (src/server/services/analyticsChatbot/). Answered
 * either by local keyword/date parsing and predefined, read-only queries
 * (no data ever leaves this server), or — when an environment has LLM mode
 * enabled (ANALYTICS_CHATBOT_LLM_ENABLED) — by Claude choosing and calling
 * those same read-only queries as tools; only tool arguments and aggregate
 * results are sent to Anthropic's API, never raw patient records. The
 * server always falls back to the local engine if the LLM path is
 * unavailable, surfaced here as the "Running in basic mode" banner. A full
 * page (not a modal) so it behaves like a dedicated chat app — sidebar
 * conversation history on the left, a message thread on the right —
 * reached via the floating button on every other page
 * (FloatingAssistantButton.tsx).
 */
const AnalyticsAssistant: React.FC = () => {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Shown only when LLM mode is enabled for this deployment but the most
  // recent reply fell back to the deterministic engine (API down, timed
  // out, or not configured) — the feature still answers, just without the
  // LLM's open-ended understanding, so the user should know why.
  const [basicMode, setBasicMode] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadConversations = async () => {
    try {
      const res = await authFetch('/api/analytics-chat/conversations');
      if (res.ok) setConversations(await res.json());
    } catch {
      // best-effort — the sidebar just stays empty, the chat itself still works
    } finally {
      setLoadingConversations(false);
    }
  };

  useEffect(() => {
    loadConversations();
    authFetch('/api/analytics-chat/suggestions')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.suggestions && setSuggestions(d.suggestions))
      .catch(() => {});
  }, []);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  // The input is disabled while a reply is in flight (see the `disabled={sending}`
  // below) so the user can't send a second question before the first finishes —
  // but a browser drops focus the moment a focused element becomes disabled and
  // never gives it back on its own, which left the user having to click back into
  // the field before every reply. Re-focus it ourselves once sending completes.
  useEffect(() => {
    if (!sending) inputRef.current?.focus();
  }, [sending]);

  const openConversation = async (id: string) => {
    setActiveId(id);
    setSidebarOpen(false);
    setLoadingMessages(true);
    try {
      const res = await authFetch(`/api/analytics-chat/conversations/${id}/messages`);
      if (res.ok) {
        const rows = await res.json();
        setMessages(rows.map((r: any) => ({ id: r.id, role: r.role, content: r.content, intent: r.intent, createdAt: r.createdAt })));
      }
    } catch {
      toast.error('Could not load that conversation', { description: 'Please try again.' });
    } finally {
      setLoadingMessages(false);
    }
  };

  const startNewConversation = () => {
    setActiveId(null);
    setMessages([]);
    setSidebarOpen(false);
  };

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await authFetch(`/api/analytics-chat/conversations/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) startNewConversation();
    } catch {
      toast.error('Could not delete that conversation');
    }
  };

  const sendMessage = async (text: string) => {
    const question = text.trim();
    if (!question || sending) return;

    setInput('');
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: 'user', content: question },
      { id: `pending-${Date.now()}`, role: 'assistant', content: '', pending: true },
    ]);
    setSending(true);

    try {
      const res = await authFetch('/api/analytics-chat/ask', {
        method: 'POST',
        body: JSON.stringify({ question, conversationId: activeId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'Failed to get a response');
      }
      const data = await res.json();
      const isNewConversation = !activeId;
      setActiveId(data.conversationId);
      setBasicMode(Boolean(data.llmEnabled) && data.engine !== 'llm');
      setMessages((prev) => {
        const withoutPending = prev.filter((m) => !m.pending);
        return [
          ...withoutPending,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: data.reply.text,
            table: data.reply.table,
            suggestions: data.reply.suggestions,
            intent: data.intent,
          },
        ];
      });
      if (isNewConversation) loadConversations();
      else setConversations((prev) => prev.map((c) => (c.id === data.conversationId ? { ...c, updatedAt: new Date().toISOString() } : c)));
    } catch (error: any) {
      setMessages((prev) => prev.filter((m) => !m.pending));
      toast.error("Couldn't answer that", { description: error?.message || 'Please try again.' });
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 flex h-[calc(100vh-3.5rem)] overflow-hidden bg-background">
        {/* Conversation history sidebar */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-border bg-card transition-transform lg:static lg:translate-x-0',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex items-center justify-between border-b border-border p-3">
            <button
              type="button"
              onClick={startNewConversation}
              className="flex flex-1 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Plus className="h-4 w-4" /> New conversation
            </button>
            <button type="button" className="ml-2 rounded-lg p-2 hover:bg-muted lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {loadingConversations ? (
              <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : conversations.length === 0 ? (
              <p className="px-2 py-4 text-sm text-muted-foreground">No conversations yet. Ask a question to start one.</p>
            ) : (
              <ul className="space-y-1">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => openConversation(c.id)}
                      className={cn(
                        'group flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors',
                        activeId === c.id ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted',
                      )}
                    >
                      <span className="truncate">{c.title}</span>
                      <Trash2
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                        onClick={(e) => deleteConversation(c.id, e)}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
        {sidebarOpen && <div className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

        {/* Thread */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-border p-3 shadow-sm">
            <button type="button" className="rounded-lg p-2 hover:bg-muted lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open conversation history">
              <Menu className="h-4 w-4" />
            </button>
            <Sparkles className="h-4 w-4 text-primary" />
            <h1 className="text-sm font-semibold text-foreground">Analytics Assistant</h1>
            {basicMode && (
              <span className="ml-auto flex items-center gap-1.5 rounded-full bg-warning-bg px-2.5 py-1 text-xs font-medium text-warning border border-warning-border">
                Running in basic mode
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 md:px-6">
            {loadingMessages ? (
              <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : messages.length === 0 ? (
              <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <MessageCircle className="h-6 w-6 text-primary" />
                </div>
                <h2 className="text-lg font-semibold text-foreground">Ask about your hospital's activity</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Registrations, visits, revenue, and doctor activity, in plain language.
                </p>
                {suggestions.length > 0 && (
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => sendMessage(s)}
                        className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="mx-auto flex max-w-2xl flex-col gap-4">
                {messages.map((m) => (
                  <div key={m.id} className={cn('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
                    <div
                      className={cn(
                        'max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm',
                        m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
                      )}
                    >
                      {m.pending ? (
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking...
                        </span>
                      ) : (
                        <>
                          {m.content}
                          {m.table && m.table.rows.length > 0 && (
                            <div className="mt-3 overflow-x-auto rounded-lg border border-border/60">
                              <table className="w-full text-xs">
                                <thead className="bg-background/40">
                                  <tr>
                                    {m.table.columns.map((col) => (
                                      <th key={col} className="px-2.5 py-1.5 text-left font-medium text-muted-foreground">{col}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {m.table.rows.map((row, i) => (
                                    <tr key={i} className="border-t border-border/40">
                                      {row.map((cell, j) => (
                                        <td key={j} className="px-2.5 py-1.5 text-foreground">{cell}</td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    {!m.pending && m.role === 'assistant' && m.suggestions && m.suggestions.length > 0 && (
                      <div className="mt-2 flex w-full max-w-[85%] flex-wrap gap-1.5">
                        {m.suggestions.map((s) => (
                          <button
                            key={s}
                            type="button"
                            disabled={sending}
                            onClick={() => sendMessage(s)}
                            className="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={threadEndRef} />
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="px-4 pb-6 pt-2 md:px-6">
            <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-2xl border border-border bg-card p-1.5 shadow-lg">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question, e.g. How many patients were registered today?"
                disabled={sending}
                className="h-10 flex-1 rounded-xl border-0 bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                aria-label="Send"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </form>
        </div>
      </div>
    </AppLayout>
  );
};

export default AnalyticsAssistant;
