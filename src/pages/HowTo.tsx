import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Input } from '@/components/ui/input';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { HelpCircle, Search, X, Stethoscope, Wallet, Truck, Users, BarChart3, ArrowRight, ListChecks } from 'lucide-react';
import { HOW_TO_GUIDE, type GuideEntry, type GuideSection } from '@/data/howToGuide';

const SECTION_ICON: Record<string, React.ElementType> = {
  'clinical-workflow': Stethoscope,
  'billing-finance': Wallet,
  'supply-chain': Truck,
  'human-resources': Users,
  'analytics-admin': BarChart3,
};

// Wraps every case-insensitive occurrence of `query` in <mark> so a match is
// visible in context instead of the searcher having to re-scan the whole
// (often multi-sentence) step text themselves to find why it matched.
function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'));
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    part.toLowerCase() === query.trim().toLowerCase()
      ? <mark key={i} className="bg-primary/20 text-foreground rounded-sm px-0.5">{part}</mark>
      : part
  );
}

function entryMatches(entry: GuideEntry, query: string): boolean {
  const q = query.toLowerCase();
  return (
    entry.title.toLowerCase().includes(q) ||
    entry.steps.some((s) => s.toLowerCase().includes(q)) ||
    (entry.note?.toLowerCase().includes(q) ?? false)
  );
}

export default function HowTo() {
  const [search, setSearch] = useState('');
  const query = search.trim();

  const filteredSections = useMemo<GuideSection[]>(() => {
    if (!query) return HOW_TO_GUIDE;
    return HOW_TO_GUIDE
      .map((section) => ({ ...section, entries: section.entries.filter((e) => entryMatches(e, query)) }))
      .filter((section) => section.entries.length > 0);
  }, [query]);

  const totalMatches = useMemo(
    () => filteredSections.reduce((sum, s) => sum + s.entries.length, 0),
    [filteredSections]
  );

  // Searching should surface results immediately rather than making the user
  // also click open the section that happens to contain them — so every
  // section with at least one match auto-expands while a query is active.
  // With no query, only the first section opens by default (a flat wall of
  // ~35 open guides on load would defeat the point of an accordion).
  const accordionValue = query ? filteredSections.map((s) => s.id) : undefined;

  return (
    <AppLayout>
      <PageHeader
        icon={<HelpCircle />}
        title="How To / Help Guide"
        subtitle="Step-by-step instructions for everything in the system, grouped the same way as the sidebar."
      />

      <div className="max-w-4xl">
        <div className="relative mb-2">
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

        {query && (
          <p className="text-xs text-muted-foreground mb-4">
            {totalMatches === 0
              ? `No guides match "${query}".`
              : `${totalMatches} guide${totalMatches === 1 ? '' : 's'} match "${query}".`}
          </p>
        )}

        {filteredSections.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <ListChecks className="h-8 w-8 mx-auto mb-3 opacity-50" />
            <p className="text-sm">Nothing found for that search.</p>
            <p className="text-xs mt-1">Try a different word, e.g. the name of a page or an action like "add", "pay", or "approve".</p>
          </div>
        ) : (
          <Accordion type="multiple" defaultValue={[HOW_TO_GUIDE[0]?.id]} value={accordionValue} className="space-y-2">
            {filteredSections.map((section) => {
              const Icon = SECTION_ICON[section.id] || ListChecks;
              return (
                <AccordionItem key={section.id} value={section.id} className="border border-border rounded-xl bg-card px-4 overflow-hidden">
                  <AccordionTrigger className="hover:no-underline py-3.5">
                    <span className="flex items-center gap-2.5">
                      <Icon className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-semibold text-sm text-foreground">{section.title}</span>
                      <Badge variant="neutral" className="ml-1 text-[10px] px-1.5 py-0">{section.entries.length}</Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-4 pt-1">
                      {section.entries.map((entry) => (
                        <div key={entry.title} className="rounded-lg border border-border/70 bg-muted/30 p-4">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <h3 className="text-sm font-semibold text-foreground">{highlight(entry.title, query)}</h3>
                            {entry.path && (
                              <Link
                                to={entry.path}
                                className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline whitespace-nowrap"
                              >
                                Go there <ArrowRight className="h-3 w-3" />
                              </Link>
                            )}
                          </div>
                          <ol className="space-y-1.5 list-decimal list-inside">
                            {entry.steps.map((step, i) => (
                              <li key={i} className="text-[13px] leading-relaxed text-muted-foreground">
                                {highlight(step, query)}
                              </li>
                            ))}
                          </ol>
                          {entry.note && (
                            <p className="mt-2.5 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                              {highlight(entry.note, query)}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </div>
    </AppLayout>
  );
}
