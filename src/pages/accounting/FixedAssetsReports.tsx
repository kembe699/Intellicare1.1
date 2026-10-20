import React, { useEffect, useState } from 'react';
import { LoadingState } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { toast } from 'sonner';
import { FileBarChart, Wallet, Download } from 'lucide-react';
import * as docTemplate from '@/utils/documentTemplate';
import { NATURE_BADGE, NATURE_LABEL, fmt } from './fixedAssetsShared';

export default function FixedAssetsReports() {
  const { user } = useAuth();
  const clinicId = Number(user?.clinic) || 1;
  const facilityInfo = useFacilityInfo();
  const [nbv, setNbv] = useState<any>(null);
  const [schedule, setSchedule] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      authFetch(`/api/fixed-assets/reports/net-book-value?clinic_id=${clinicId}`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)),
      authFetch(`/api/fixed-assets/reports/depreciation-schedule?clinic_id=${clinicId}&months=6`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])),
    ]).then(([nbvData, scheduleData]) => { setNbv(nbvData); setSchedule(scheduleData || []); }).finally(() => setLoading(false));
  }, [clinicId]);

  if (loading) return <LoadingState message="Building reports..." />;

  const scheduleByPeriod: Record<string, number> = {};
  for (const row of schedule) scheduleByPeriod[row.period] = (scheduleByPeriod[row.period] || 0) + row.amount;

  const fi = () => ({ name: facilityInfo.facilityName, type: facilityInfo.facilityType, address: facilityInfo.facilityAddress, city: facilityInfo.facilityCity, phone: facilityInfo.facilityPhone, email: facilityInfo.facilityEmail, licenseNo: facilityInfo.facilityLicenseNo });
  const bi = () => ({ name: facilityInfo.branchName, address: facilityInfo.branchAddress, phone: facilityInfo.branchPhone });

  const buildReportHtml = () => {
    const nbvRows = (nbv?.byCategory || []).map((row: any) => ({
      cells: [row.category_name, NATURE_LABEL[row.nature] || row.nature, row.asset_count, fmt(row.total_cost), fmt(row.total_accumulated_depreciation), fmt(row.total_book_value)],
    }));

    let body = `<div class="ic-section-title">Net Book Value by Category</div>`
      + docTemplate.buildTable(
        [
          { label: 'Category' }, { label: 'Nature' }, { label: 'Assets', align: 'right' },
          { label: 'Cost', align: 'right' }, { label: 'Accum. Depreciation', align: 'right' }, { label: 'Book Value', align: 'right' },
        ],
        nbvRows,
        nbv?.overall ? ['Total', '', nbv.overall.asset_count, fmt(nbv.overall.total_cost), fmt(nbv.overall.total_accumulated_depreciation), fmt(nbv.overall.total_book_value)] : undefined
      );

    const scheduleEntries = Object.entries(scheduleByPeriod);
    if (scheduleEntries.length > 0) {
      body += `<div class="ic-section-title">Projected Depreciation (next 6 months)</div>`
        + docTemplate.buildTable(
          [{ label: 'Period' }, { label: 'Projected Depreciation', align: 'right' }],
          scheduleEntries.map(([period, amount]) => ({ cells: [period, fmt(amount)] }))
        );
    }

    return docTemplate.buildDocument({
      docType: 'FIXED ASSETS REPORT',
      date: new Date(),
      bodyHTML: body,
      facilityInfo: fi(),
      branchInfo: bi(),
    });
  };

  const handleDownloadPdf = () => {
    const pw = docTemplate.openPrintWindow(buildReportHtml());
    if (pw) toast.success('PDF generated');
    else toast.error('Please allow popups');
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownloadPdf}>
          <Download className="h-3.5 w-3.5" /> Download PDF
        </Button>
      </div>

      <Card>
        <div className="px-5 py-3.5 border-b border-border bg-muted/30 flex items-center gap-2"><Wallet className="h-4 w-4" /><h4 className="font-semibold text-sm">Net Book Value by Category</h4></div>
        <CardContent className="p-0">
          <table className="w-full text-sm border-collapse">
            <thead><tr className="border-b bg-muted/30"><th className="text-left py-2.5 px-4">Category</th><th className="text-left py-2.5 px-4">Nature</th><th className="text-right py-2.5 px-4">Assets</th><th className="text-right py-2.5 px-4">Cost</th><th className="text-right py-2.5 px-4">Accum. Depreciation</th><th className="text-right py-2.5 px-4">Book Value</th></tr></thead>
            <tbody>
              {(nbv?.byCategory || []).map((row: any) => (
                <tr key={row.category_name} className="border-b border-border/50">
                  <td className="py-2 px-4">{row.category_name}</td>
                  <td className="py-2 px-4"><Badge variant={NATURE_BADGE[row.nature]}>{NATURE_LABEL[row.nature]}</Badge></td>
                  <td className="py-2 px-4 text-right">{row.asset_count}</td>
                  <td className="py-2 px-4 text-right">{fmt(row.total_cost)}</td>
                  <td className="py-2 px-4 text-right">{fmt(row.total_accumulated_depreciation)}</td>
                  <td className="py-2 px-4 text-right font-medium">{fmt(row.total_book_value)}</td>
                </tr>
              ))}
              {nbv?.overall && (
                <tr className="font-semibold border-t-2 border-foreground/20">
                  <td className="py-2 px-4" colSpan={2}>Total</td>
                  <td className="py-2 px-4 text-right">{nbv.overall.asset_count}</td>
                  <td className="py-2 px-4 text-right">{fmt(nbv.overall.total_cost)}</td>
                  <td className="py-2 px-4 text-right">{fmt(nbv.overall.total_accumulated_depreciation)}</td>
                  <td className="py-2 px-4 text-right">{fmt(nbv.overall.total_book_value)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <div className="px-5 py-3.5 border-b border-border bg-muted/30 flex items-center gap-2"><FileBarChart className="h-4 w-4" /><h4 className="font-semibold text-sm">Projected Depreciation (next 6 months)</h4></div>
        <CardContent className="p-5 grid grid-cols-3 sm:grid-cols-6 gap-4">
          {Object.entries(scheduleByPeriod).map(([period, amount]) => (
            <div key={period}>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{period}</p>
              <p className="text-lg font-semibold">{fmt(amount)}</p>
            </div>
          ))}
          {Object.keys(scheduleByPeriod).length === 0 && <p className="text-sm text-muted-foreground col-span-full">No depreciating assets due — nothing projected.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
