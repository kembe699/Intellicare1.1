import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Printer, Download, RefreshCw, Calendar } from 'lucide-react';
import { getDatePresets, triggerPrint, CsvColumn, exportCSV } from '@/utils/reportUtils';

interface ReportShellProps {
  title: string;
  description: string;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onRefresh: () => void;
  loading?: boolean;
  csvData?: any[];
  csvColumns?: CsvColumn[];
  csvFilename?: string;
  hideDateRange?: boolean;
  /** Skip the whole built-in controls row (date range, quick range, Refresh/CSV/Print) — for a page that builds its own toolbar instead. */
  hideControls?: boolean;
  children: React.ReactNode;
}

export function ReportSubPageShell({
  title, description,
  dateFrom, dateTo,
  onDateFromChange, onDateToChange,
  onRefresh, loading = false,
  csvData, csvColumns, csvFilename,
  hideDateRange = false,
  hideControls = false,
  children,
}: ReportShellProps) {
  const presets = getDatePresets();

  const handlePreset = (label: string) => {
    const p = presets.find(x => x.label === label);
    if (!p) return;
    onDateFromChange(p.from);
    onDateToChange(p.to);
  };

  const handleExportCSV = () => {
    if (csvData && csvColumns && csvFilename) {
      exportCSV(csvData, csvColumns, csvFilename);
    }
  };

  const handlePrint = () => {
    triggerPrint();
  };

  return (
    <div className="space-y-0">
      {/* ── Controls bar (hidden on print) ── */}
      {!hideControls && <div className="print:hidden flex flex-wrap items-end gap-3 pb-5">
        {!hideDateRange && (
          <>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <div className="flex items-center gap-1">
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={e => onDateFromChange(e.target.value)}
                  className="w-[140px] h-8 text-sm"
                />
                <span className="text-muted-foreground text-sm">—</span>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={e => onDateToChange(e.target.value)}
                  className="w-[140px] h-8 text-sm"
                />
              </div>
            </div>
            <Combobox
              options={presets.map(p => ({ value: p.label, label: p.label }))}
              value=""
              onChange={handlePreset}
              placeholder="Quick range"
              searchPlaceholder="Search..."
              className="w-[130px] h-8 text-sm"
            />
          </>
        )}

        <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading} className="h-8 gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>

        <div className="ml-auto flex items-center gap-2">
          {csvData && csvColumns && (
            <Button size="sm" variant="outline" onClick={handleExportCSV} className="h-8 gap-1.5">
              <Download className="w-3.5 h-3.5" />
              CSV
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={handlePrint} className="h-8 gap-1.5">
            <Printer className="w-3.5 h-3.5" />
            Print
          </Button>
        </div>
      </div>}

      {/* ── Print header (visible only on print) ── */}
      <div className="hidden print:block mb-6 border-b pb-4">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sm text-gray-500">{description}</p>
        <p className="text-xs text-gray-400 mt-1">
          Period: {dateFrom} — {dateTo} &nbsp;|&nbsp; Printed: {new Date().toLocaleString()}
        </p>
      </div>

      {/* ── Report content ── */}
      {children}
    </div>
  );
}

export default ReportSubPageShell;
