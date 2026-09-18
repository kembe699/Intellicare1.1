import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Input } from '@/components/ui/input';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { HelpCircle, Search, X, ArrowRight, ListChecks } from 'lucide-react';
import { HOW_TO_GUIDE, type GuideEntry } from '@/data/howToGuide';

// Wraps every case-insensitive occurrence of any `terms` entry in <mark> so a
// match is visible in context instead of the searcher having to re-scan the
// whole (often multi-sentence) step text themselves to find why it matched.
// Takes multiple terms so the related-guides fallback below can highlight
// each matched word, not just a literal phrase that may not appear at all.
function highlight(text: string, terms: string[]): React.ReactNode {
  const cleaned = terms.map((t) => t.trim()).filter(Boolean);
  if (cleaned.length === 0) return text;
  const escaped = [...cleaned].sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'ig'));
  if (parts.length === 1) return text;
  const lowerTerms = new Set(cleaned.map((t) => t.toLowerCase()));
  return parts.map((part, i) =>
    lowerTerms.has(part.toLowerCase())
      ? <mark key={i} className="bg-primary/20 text-foreground rounded-sm px-0.5">{part}</mark>
      : part
  );
}

function entryMatches(entry: GuideEntry, query: string): boolean {
  const q = query.toLowerCase();
  return entry.title.toLowerCase().includes(q) || entry.steps.some((s) => s.toLowerCase().includes(q));
}

// Words too common to carry meaning on their own — stripped out so a typed
// question like "how do I update stock" searches on "update" and "stock",
// not "how", "do", and "i".
const STOPWORDS = new Set([
  'how', 'to', 'a', 'an', 'the', 'do', 'does', 'did', 'can', 'i', 'you', 'we',
  'is', 'are', 'was', 'were', 'be', 'of', 'in', 'on', 'at', 'for', 'and', 'or',
  'my', 'me', 'please', 'need', 'want', 'up', 'it', 'this', 'that', 'with',
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// When nothing matches the query as a literal phrase, fall back to scoring
// every entry by how many of the query's significant words it contains — a
// title hit counts for more than a step hit — and rank by that score. This
// is what turns "how update stock" (no entry titled exactly that) into a
// ranked list of every stock-related guide instead of a dead end.
function relatedScore(entry: GuideEntry, queryTokens: string[]): number {
  const titleLower = entry.title.toLowerCase();
  const stepsLower = entry.steps.join(' ').toLowerCase();
  let score = 0;
  for (const t of queryTokens) {
    if (titleLower.includes(t)) score += 3;
    else if (stepsLower.includes(t)) score += 1;
  }
  return score;
}

// Alphabetical rather than insertion order — with ~70 flat "How to ..."
// entries and no grouping, alphabetizing is what makes the list scannable,
// and it has the nice side effect of clustering entries that start the same
// way ("How to Add a...", "How to Add an...") next to each other.
const SORTED_GUIDE = [...HOW_TO_GUIDE].sort((a, b) => a.title.localeCompare(b.title));

export default function HowTo() {
  const [search, setSearch] = useState('');
  const query = search.trim();
  const queryTokens = useMemo(() => tokenize(query), [query]);

  // Exact phrase match first — precise and predictable when the query
  // actually appears verbatim. Only when that comes up empty do we fall back
  // to related guides scored on the query's individual significant words.
  const exactEntries = useMemo<GuideEntry[]>(() => {
    if (!query) return SORTED_GUIDE;
    return SORTED_GUIDE.filter((e) => entryMatches(e, query));
  }, [query]);

  const relatedEntries = useMemo<GuideEntry[]>(() => {
    if (!query || exactEntries.length > 0 || queryTokens.length === 0) return [];
    return SORTED_GUIDE
      .map((entry) => ({ entry, score: relatedScore(entry, queryTokens) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
      .map((x) => x.entry);
  }, [query, exactEntries, queryTokens]);

  const isFallback = query.length > 0 && exactEntries.length === 0 && relatedEntries.length > 0;
  const filteredEntries = query ? (exactEntries.length > 0 ? exactEntries : relatedEntries) : SORTED_GUIDE;
  const highlightTerms = isFallback ? queryTokens : [query];

  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader
          icon={<HelpCircle />}
          title="How To / Help Guide"
          subtitle="Step-by-step instructions for everything in the system — search or browse below."
        />

        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder='Search the guide… e.g. "discharge a patient", "purchase order", "payroll"'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-9 h-11 text-sm"
            autoFocus
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              title="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <p className="text-xs text-muted-foreground mb-6 text-center">
          {query
            ? filteredEntries.length === 0
              ? `No guides match "${query}".`
              : isFallback
                ? `No exact match for "${query}" — showing ${filteredEntries.length} guide${filteredEntries.length === 1 ? '' : 's'} related to ${queryTokens.join(', ')}.`
                : `${filteredEntries.length} guide${filteredEntries.length === 1 ? '' : 's'} match "${query}".`
            : `${SORTED_GUIDE.length} guides — click any one to expand it.`}
        </p>

        {filteredEntries.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <ListChecks className="h-8 w-8 mx-auto mb-3 opacity-50" />
            <p className="text-sm">Nothing found for that search.</p>
            <p className="text-xs mt-1">Try a different word, e.g. the name of a page or an action like "add", "pay", or "approve".</p>
          </div>
        ) : (
          <Accordion type="multiple" className="space-y-4 pb-8">
            {filteredEntries.map((entry) => (
              <AccordionItem key={entry.title} value={entry.title} className="border border-border rounded-xl bg-card px-5 overflow-hidden">
                <AccordionTrigger className="hover:no-underline py-4">
                  <span className="flex items-center gap-2.5 text-left">
                    <span className="font-semibold text-sm text-foreground">{highlight(entry.title, highlightTerms)}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex items-start justify-between gap-3 pb-3 pt-1">
                    <ol className="space-y-2 list-decimal list-inside flex-1">
                      {entry.steps.map((step, i) => (
                        <li key={i} className="text-[13px] leading-relaxed text-muted-foreground">
                          {highlight(step, highlightTerms)}
                        </li>
                      ))}
                    </ol>
                    {entry.path && (
                      <Link
                        to={entry.path}
                        className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline whitespace-nowrap"
                      >
                        Go there <ArrowRight className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>
    </AppLayout>
  );
}
