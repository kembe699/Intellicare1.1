import React from 'react';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { fmtDate } from '@/utils/reportUtils';
import { cn } from '@/lib/utils';

interface ReportLetterheadProps {
  /** The bold centered bar at the top — the report's own name, e.g. "Laboratory Report". */
  title: string;
  dateFrom: string;
  dateTo: string;
  generatedAt: Date | null;
  /** Show "As Of: <dateTo>" instead of "From/To" — for current-state snapshot reports. */
  asOf?: boolean;
  className?: string;
}

// The facility-branded header every report shares: a bold title bar, the
// facility's logo/name, and the period + generation timestamp. Single
// source of truth for this block — previously duplicated near-verbatim
// across AccountingReport/InventoryReport/ProcurementReport/ClinicalReport/
// RevenueReport/AuditSummaryReport, with every other report page in
// src/pages/reports/ missing it entirely, so printing or viewing one report
// looked nothing like another. Drop this in as the first child of
// ReportSubPageShell (or wherever the result body starts) to standardize it.
export function ReportLetterhead({ title, dateFrom, dateTo, generatedAt, asOf = false, className = '' }: ReportLetterheadProps) {
  const facility = useFacilityInfo();

  return (
    <div className={cn('rounded-md border border-border overflow-hidden bg-card mb-6', className)}>
      <div className="bg-info-bg dark:bg-info/40 text-center py-2 border-b border-border">
        <h2 className="text-sm font-bold tracking-wide text-foreground">{title}</h2>
      </div>
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          {facility.facilityLogo ? (
            <img src={facility.facilityLogo} alt={facility.facilityName} className="h-16 w-16 object-contain rounded border border-border flex-shrink-0" />
          ) : (
            <div className="h-16 w-16 rounded border border-border flex-shrink-0" />
          )}
          <div>
            <p className="font-semibold text-sm">{facility.facilityName || '—'}</p>
            {facility.facilityWebsite && <p className="text-xs text-muted-foreground">{facility.facilityWebsite}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-1 text-xs text-muted-foreground">
          {asOf ? (
            <span><span className="font-semibold text-foreground">As Of:</span> {fmtDate(dateTo)}</span>
          ) : (
            <>
              <span><span className="font-semibold text-foreground">From:</span> {fmtDate(dateFrom)}</span>
              <span><span className="font-semibold text-foreground">To:</span> {fmtDate(dateTo)}</span>
            </>
          )}
          <span><span className="font-semibold text-foreground">Report DateTime:</span> {generatedAt ? generatedAt.toLocaleString() : '—'}</span>
        </div>
      </div>
    </div>
  );
}

export default ReportLetterhead;
