import React, { useState, useEffect, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { FlaskConical, Save, RefreshCw, Box, User, Activity, Search, History, Calendar, Filter, Loader2, ChevronRight, CheckCircle2, Circle, Printer, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { MindrayIntegration } from '@/components/lab/MindrayIntegration';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import * as docTemplate from '@/utils/documentTemplate';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

// Local (not UTC) date string, so "today" matches the user's actual calendar day.
const toLocalDateStr = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// Groups a flat specimen list into one entry per order (= per patient request),
// so the worklist shows one row per patient instead of one row per test.
const groupByOrder = (list: any[]) => {
  const groups = new Map<string, any>();
  for (const s of list) {
    if (!groups.has(s.order_id)) {
      groups.set(s.order_id, {
        order_id: s.order_id,
        first_name: s.first_name,
        last_name: s.last_name,
        participant_number: s.participant_number,
        order_time: s.order_time,
        specimens: [] as any[],
      });
    }
    groups.get(s.order_id).specimens.push(s);
  }
  // Latest orders first — most recently ordered patient sits at the top of the worklist.
  return Array.from(groups.values()).sort((a, b) => new Date(b.order_time).getTime() - new Date(a.order_time).getTime());
};

// One-click "fill common/normal results" presets for high-volume routine panels, keyed
// by test_code (see labTestsSeedData.js) and then by each component's exact name. Staff
// still review/edit every field afterward — this just saves re-typing the same normal
// findings on the many specimens that come back unremarkable, which is the overwhelming
// majority for these two panels.
const COMMON_RESULT_PRESETS: Record<string, Record<string, string>> = {
  URINEGEN: {
    'Colour': 'Yellow',
    'Reaction': 'Acidic',
    'Leucocyte': 'Nil',
    'Blood': 'Nil',
    'Ketone': 'Nil',
    'PH': '6',
    'Protein': 'Nil',
    'Urobilinogen': 'Nil',
    'Sugar': 'Nil',
    'Bilirubin': 'Nil',
    'Specific Gravity': '1.020',
    'Pus': '6 - 8',
    'RBCs': '0 - 1',
    'Epithelial Cells': '++',
    'Crystal': 'Nil',
    'Cast': 'Nil',
    'Others': 'Nil',
  },
  // Standard normal/routine stool exam findings — Motile Bacteria "Present" is the
  // normal-flora finding here (unlike the other fields, its absence is the atypical one).
  STOOLGEN: {
    'Colour': 'Brown',
    'Consistency': 'Formed',
    'Mucus': 'Nil',
    'Blood': 'Nil',
    'Worms': 'Nil',
    'Pus': '0 - 2',
    'RBCs': 'Nil',
    'Cyst': 'Nil',
    'Trophozoite': 'Nil',
    'Ova': 'Nil',
    'Undigested Food': 'Nil',
    'Motile Bacteria': 'Present',
    'Yeast Cells': 'Nil',
  },
};

export default function LISResultsEntry() {
  const { user } = useAuth();
  const facilityInfo = useFacilityInfo();
  const [printing, setPrinting] = useState(false);
  const [specimens, setSpecimens] = useState<any[]>([]);
  const [historySpecimens, setHistorySpecimens] = useState<any[]>([]);
  const [labTests, setLabTests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSpecimen, setSelectedSpecimen] = useState<any | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [searchWorklist, setSearchWorklist] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  // History defaults to today only — broaden the range to review earlier results.
  const [historyDateFrom, setHistoryDateFrom] = useState(() => toLocalDateStr(new Date()));
  const [historyDateTo, setHistoryDateTo] = useState(() => toLocalDateStr(new Date()));
  const [historyStatus, setHistoryStatus] = useState('all');

  // resultValues maps component.id to the entered value
  const [resultValues, setResultValues] = useState<Record<string, string>>({});
  // ONE free-text note for the whole test currently open (a CBC panel has 20
  // components and one comment box, not 20) — separate from getRemark's
  // auto-computed per-analyte HIGH/LOW/NORMAL flag. Only shows on the
  // printed report when it's actually filled in.
  const [testComment, setTestComment] = useState('');

  useEffect(() => {
    fetchLabTests();
  }, []);

  // Fetches on mount, and re-fetches whenever the date range changes (backend does the filtering).
  useEffect(() => {
    fetchSpecimens();
  }, [historyDateFrom, historyDateTo]);

  const fetchSpecimens = async () => {
    setLoading(true);
    try {
      const [resPending, resHistory] = await Promise.all([
        authFetch('/api/lis/specimens/pending', { credentials: 'include' }),
        authFetch(`/api/lis/specimens/history?dateFrom=${historyDateFrom}&dateTo=${historyDateTo}`, { credentials: 'include' })
      ]);
      if (resPending.ok) setSpecimens(await resPending.json());
      if (resHistory.ok) setHistorySpecimens(await resHistory.json());
    } catch (e) {
      toast.error('Failed to fetch worklist');
    } finally {
      setLoading(false);
    }
  };

  const loadSpecimen = async (s: any) => {
    setSelectedSpecimen(s);
    setResultValues({});
    setTestComment('');

    // Attempt to load existing results if this specimen was already analyzed
    try {
      const res = await authFetch(`/api/lis/specimens/${s.id}/results`, { credentials: 'include' });
      if (res.ok) {
        const existingResults = await res.json();
        if (existingResults.length > 0) {
          const loadedValues: Record<string, string> = {};
          // Map back analyte name to component ID by finding it in the test schema
          const testSchema = labTests.find(t => t.test_code === s.test_code);
          if (testSchema && testSchema.components) {
            existingResults.forEach((er: any) => {
              const comp = testSchema.components.find((c: any) => c.name === er.analyte);
              if (comp) loadedValues[comp.id] = er.value;
            });
          }
          setResultValues(loadedValues);
          // test_comment is the same on every row of this specimen (see
          // GET /specimens/:id/results' sp.comment join) — one test, one note.
          setTestComment(existingResults[0]?.test_comment || '');
        }
      }
    } catch(e) {
      console.error('Failed to load existing results', e);
    }
  };

  // Selecting a patient in the worklist opens their test list on the right and
  // jumps straight into the first test so there's no extra click needed.
  const selectOrder = (group: any) => {
    setSelectedOrderId(group.order_id);
    if (group.specimens.length > 0) {
      loadSpecimen(group.specimens[0]);
    } else {
      setSelectedSpecimen(null);
    }
  };

  const fetchLabTests = async () => {
    try {
      const res = await authFetch('/api/lab-tests', { credentials: 'include' });
      if (res.ok) setLabTests(await res.json());
    } catch (e) {
      toast.error('Failed to fetch lab tests schema');
    }
  };

  const handleSaveResults = async () => {
    if (saving) return;
    if (!selectedSpecimen) return;

    // Find the test schema to get component names and units
    const testSchema = labTests.find(t => t.test_code === selectedSpecimen.test_code);
    if (!testSchema || !testSchema.components) return toast.error('Test schema not found');

    const results = testSchema.components.map((comp: any) => ({
      analyte: comp.name,
      value: resultValues[comp.id] || '',
      unit: comp.unit || '',
    })).filter((r: any) => r.value !== '');

    if (results.length === 0) return toast.error('Enter at least one result');

    setSaving(true);
    try {
      const res = await authFetch(`/api/lis/specimens/${selectedSpecimen.id}/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ results, test_code: selectedSpecimen.test_code, comment: testComment.trim() })
      });
      if (res.ok) {
        toast.success('Results saved successfully');
        // Auto-advance to the next un-entered test in the same order, if any remain.
        const remaining = specimens.filter(sp => sp.order_id === selectedSpecimen.order_id && sp.id !== selectedSpecimen.id);
        if (remaining.length > 0) {
          loadSpecimen(remaining[0]);
          toast.info(`Moved to next test: ${remaining[0].test_name}`);
        } else {
          setSelectedSpecimen(null);
          setSelectedOrderId(null);
          setResultValues({});
          setTestComment('');
        }
        fetchSpecimens();
      } else {
        toast.error('Failed to save results');
      }
    } catch (e) {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  };

  const getRemark = (value: string, refRange: string) => {
    if (!value || !refRange) return null;
    
    // Handle standard ranges like "4.0 - 10.0"
    const parts = refRange.split('-').map(p => p.trim());
    if (parts.length === 2) {
      const min = parseFloat(parts[0]);
      const max = parseFloat(parts[1]);
      const val = parseFloat(value);
      
      if (!isNaN(min) && !isNaN(max) && !isNaN(val)) {
        if (val < min) return <span className="text-red-500 font-bold text-[10px] bg-red-50 px-2 py-0.5 rounded border border-red-100">LOW</span>;
        if (val > max) return <span className="text-red-500 font-bold text-[10px] bg-red-50 px-2 py-0.5 rounded border border-red-100">HIGH</span>;
        return <span className="text-green-600 font-bold text-[10px] bg-green-50 px-2 py-0.5 rounded border border-green-100">NORMAL</span>;
      }
    }
    
    return null;
  };

  // Plain-text version of getRemark's logic, for the printed report (no JSX there).
  const getRemarkText = (value: string, refRange: string): string => {
    if (!value || !refRange) return '—';
    const parts = refRange.split('-').map(p => p.trim());
    if (parts.length === 2) {
      const min = parseFloat(parts[0]);
      const max = parseFloat(parts[1]);
      const val = parseFloat(value);
      if (!isNaN(min) && !isNaN(max) && !isNaN(val)) {
        if (val < min) return 'LOW';
        if (val > max) return 'HIGH';
        return 'NORMAL';
      }
    }
    return '—';
  };

  // Prints every test in the currently open order together, not just the one on screen —
  // pulls each test's saved results plus the "Done By" (who recorded them) and "Approved By"
  // (the reviewing manager, if already reviewed) signatures straight from their Profile.
  // Saved results come back from the API in whatever order they were written (insertion
  // order), not the test's defined parameter order — so the printed report showed a
  // shuffled parameter list that didn't match the order staff actually entered them in on
  // the Results Entry form. /specimens/:id/results now also returns each result's own
  // lab_test_components.display_order (the same column the entry form's own component list
  // is sorted by), so re-sort to that before printing. Anything with no match (custom/
  // legacy analyte, display_order NULL) keeps its relative order at the end.
  const sortResultsByComponentOrder = (results: any[]) => {
    return [...results].sort((a, b) => {
      const ao = a.display_order, bo = b.display_order;
      if (ao == null && bo == null) return 0;
      if (ao == null) return 1;
      if (bo == null) return -1;
      return ao - bo;
    });
  };

  const handlePrintResults = async () => {
    if (printing) return;
    if (!currentGroup || currentGroup.specimens.length === 0) return;
    setPrinting(true);
    try {
      const perSpecimen = await Promise.all(currentGroup.specimens.map(async (s: any) => {
        const res = await authFetch(`/api/lis/specimens/${s.id}/results`, { credentials: 'include' });
        const results = res.ok ? await res.json() : [];
        return { specimen: s, results };
      }));

      const withResults = perSpecimen.filter(p => p.results.length > 0);
      if (withResults.length === 0) { toast.error('No saved results to print yet'); return; }

      const allResults = withResults.flatMap(p => p.results);
      const recordedResult = allResults.find((r: any) => r.recorded_by);
      const approvedResult = allResults.find((r: any) => r.manager_review_by && r.status === 'approved');

      const [doneBySignature, approvedBySignature] = await Promise.all([
        docTemplate.fetchUserSignature(recordedResult?.recorded_by),
        approvedResult ? docTemplate.fetchUserSignature(approvedResult.manager_review_by) : Promise.resolve(null),
      ]);

      const patientName = `${currentGroup.first_name} ${currentGroup.last_name}`.trim();
      const requestedByName = currentGroup.specimens.find((s: any) => s.requested_by_name)?.requested_by_name || '—';

      const testSectionsHTML = withResults.map(({ specimen, results }) => {
        const sorted = sortResultsByComponentOrder(results);
        const rows = sorted.map((r: any) => ({
          cells: [r.analyte, r.value || '—', r.unit || '—', r.reference_range || '—', getRemarkText(r.value, r.reference_range)],
        }));
        // One comment for the whole test (test_comment is the same on every
        // row — see GET /specimens/:id/results' sp.comment join) — renders
        // nothing at all here if it wasn't filled in.
        const testCommentText = sorted[0]?.test_comment;
        return [
          `<div class="ic-section-title">Test: ${specimen.test_name} <span>Barcode: ${specimen.barcode}</span></div>`,
          docTemplate.buildTable([{ label: 'Parameter' }, { label: 'Result' }, { label: 'Unit' }, { label: 'Ref Range' }, { label: 'Remark' }], rows),
          testCommentText ? docTemplate.buildNotes(`Comment (${specimen.test_name}): ${testCommentText}`) : '',
        ].join('\n');
      }).join('\n');

      const signers = [
        { label: 'Done By', name: recordedResult?.recorded_by_name || '', signature: doneBySignature || undefined },
      ];
      if (approvedResult) {
        signers.push({ label: 'Approved By', name: approvedResult.manager_review_by_name || '', signature: approvedBySignature || undefined });
      }

      const bodyHTML = [
        docTemplate.buildInfoGrid(
          { title: 'Patient Details', rows: [
            { label: 'Patient Name', value: patientName, bold: true },
            { label: 'Participant ID', value: currentGroup.participant_number },
          ]},
          { title: 'Report Details', rows: [
            { label: 'Report Date', value: docTemplate.formatDate(new Date()) },
            { label: 'Requested By', value: requestedByName },
          ]}
        ),
        testSectionsHTML,
        docTemplate.buildSignatures(signers),
      ].join('\n');

      const html = docTemplate.buildDocument({
        title: 'Laboratory Report',
        docType: 'Laboratory Report',
        docNumber: `LAB-${currentGroup.order_id.slice(-6).toUpperCase()}`,
        date: new Date(),
        bodyHTML,
        logoUrl: facilityInfo.facilityLogo || `${window.location.origin}/hjd-icon.png`,
        facilityInfo: { name: facilityInfo.facilityName, type: facilityInfo.facilityType, address: facilityInfo.facilityAddress, city: facilityInfo.facilityCity, phone: facilityInfo.facilityPhone, email: facilityInfo.facilityEmail, licenseNo: facilityInfo.facilityLicenseNo },
        branchInfo: { name: facilityInfo.branchName, address: facilityInfo.branchAddress, phone: facilityInfo.branchPhone },
      });

      docTemplate.openPrintWindow(html);
    } finally {
      setPrinting(false);
    }
  };

  // Worklist grouped one row per patient/order (not per individual test)
  const groupedPending = useMemo(() => groupByOrder(specimens.filter(s => s.status === 'routed')), [specimens]);
  const pendingGroups = groupedPending.filter(g =>
    `${g.first_name} ${g.last_name}`.toLowerCase().includes(searchWorklist.toLowerCase()) ||
    g.participant_number?.toLowerCase().includes(searchWorklist.toLowerCase()) ||
    g.specimens.some((s: any) => s.test_name?.toLowerCase().includes(searchWorklist.toLowerCase()) || s.barcode?.toLowerCase().includes(searchWorklist.toLowerCase()))
  );

  const groupedHistory = useMemo(() => {
    // Date range is already applied server-side; only status is filtered client-side.
    const filtered = historyStatus === 'all' ? historySpecimens : historySpecimens.filter(s => s.status === historyStatus);
    return groupByOrder(filtered);
  }, [historySpecimens, historyStatus]);

  const historyGroups = groupedHistory.filter(g =>
    `${g.first_name} ${g.last_name}`.toLowerCase().includes(historySearch.toLowerCase()) ||
    g.participant_number?.toLowerCase().includes(historySearch.toLowerCase()) ||
    g.specimens.some((s: any) => s.test_name?.toLowerCase().includes(historySearch.toLowerCase()) || s.barcode?.toLowerCase().includes(historySearch.toLowerCase()))
  );

  // The currently open patient's full order — derived from the unfiltered groups so
  // typing in search doesn't clear the test list you're already working through.
  const currentGroup = activeTab === 'pending'
    ? groupedPending.find(g => g.order_id === selectedOrderId)
    : groupedHistory.find(g => g.order_id === selectedOrderId);

  // Determine which components to show based on selected specimen's test code
  const selectedTestSchema = selectedSpecimen
    ? labTests.find(t => t.test_code === selectedSpecimen.test_code)
    : null;

  const commonResultsPreset = selectedTestSchema ? COMMON_RESULT_PRESETS[selectedTestSchema.test_code] : null;

  // Fills every component that has a preset value defined — anything not covered (or
  // already typed in) is left alone, so this is safe to click even after starting to
  // enter results by hand.
  const fillCommonResults = () => {
    if (!commonResultsPreset || !selectedTestSchema?.components) return;
    const newValues = { ...resultValues };
    for (const comp of selectedTestSchema.components) {
      const preset = commonResultsPreset[comp.name];
      if (preset !== undefined) newValues[comp.id] = preset;
    }
    setResultValues(newValues);
    toast.success('Filled common/normal results — review and edit any that differ');
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-[1800px] mx-auto w-full h-[calc(100vh-64px)] flex flex-col">
        <PageHeader title="Results Entry" icon={<FlaskConical />} className="mb-3" />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">

          {/* LEFT: Worklist — one row per patient/order */}
          <div className="lg:col-span-3 bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden h-full min-h-0">
            <div className="flex w-full border-b">
              <button
                className={cn("flex-1 p-3 text-sm font-medium flex items-center justify-center gap-2", activeTab === 'pending' ? "bg-primary/5 text-primary border-b-2 border-primary" : "text-muted-foreground hover:bg-muted/50")}
                onClick={() => { setActiveTab('pending'); setSelectedSpecimen(null); setSelectedOrderId(null); }}
              >
                <Box className="w-4 h-4" /> Worklist ({pendingGroups.length})
              </button>
              <button
                className={cn("flex-1 p-3 text-sm font-medium flex items-center justify-center gap-2", activeTab === 'history' ? "bg-primary/5 text-primary border-b-2 border-primary" : "text-muted-foreground hover:bg-muted/50")}
                onClick={() => { setActiveTab('history'); setSelectedSpecimen(null); setSelectedOrderId(null); }}
              >
                <History className="w-4 h-4" /> History
              </button>
            </div>

            <div className="p-3 border-b bg-card space-y-3">
              {activeTab === 'pending' ? (
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                    <Input
                      placeholder="Search patient, ID, test..."
                      className="pl-8 h-9 text-sm"
                      value={searchWorklist}
                      onChange={(e) => setSearchWorklist(e.target.value)}
                    />
                  </div>
                  <Button variant="outline" size="sm" onClick={fetchSpecimens} disabled={loading} className="h-9 w-9 p-0">
                    <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                      <Input
                        placeholder="Search patient, ID, test..."
                        className="pl-8 h-9 text-sm"
                        value={historySearch}
                        onChange={(e) => setHistorySearch(e.target.value)}
                      />
                    </div>
                    <Button variant="outline" size="sm" onClick={fetchSpecimens} disabled={loading} className="h-9 w-9 p-0">
                      <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="date"
                      className="h-9 text-xs"
                      value={historyDateFrom}
                      max={historyDateTo}
                      onChange={(e) => setHistoryDateFrom(e.target.value)}
                    />
                    <span className="text-xs text-muted-foreground flex-shrink-0">to</span>
                    <Input
                      type="date"
                      className="h-9 text-xs"
                      value={historyDateTo}
                      min={historyDateFrom}
                      onChange={(e) => setHistoryDateTo(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Combobox
                      options={[
                        { value: 'all', label: 'All' },
                        { value: 'analyzed', label: 'Analyzed' },
                        { value: 'pending_manager_review', label: 'Under Review' },
                        { value: 'approved', label: 'Approved' },
                      ]}
                      value={historyStatus}
                      onChange={(v) => setHistoryStatus(v)}
                      searchPlaceholder="Search..."
                      className="h-9 text-xs"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex-1 overflow-auto p-2 space-y-1 bg-card">
              {activeTab === 'pending' ? (
                pendingGroups.length > 0 ? pendingGroups.map(g => (
                  <button
                    key={g.order_id}
                    onClick={() => selectOrder(g)}
                    className={cn(
                      "w-full text-left p-3 rounded-md transition-colors border text-sm flex flex-col gap-1 bg-card",
                      selectedOrderId === g.order_id
                        ? "bg-primary/5 border-primary text-primary shadow-sm"
                        : "hover:border-primary/50 border-transparent shadow-sm"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium truncate">{g.first_name} {g.last_name}</span>
                      <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 ml-2">{g.specimens.length} test{g.specimens.length > 1 ? 's' : ''}</span>
                    </div>
                    <div className="text-xs font-mono text-muted-foreground">{g.participant_number}</div>
                    <div className="text-[11px] text-muted-foreground">{new Date(g.order_time).toLocaleString()}</div>
                  </button>
                )) : (
                  <div className="p-8 text-center text-muted-foreground text-sm border-2 border-dashed rounded-lg">
                    {loading ? 'Loading...' : 'No specimens in worklist.'}
                  </div>
                )
              ) : (
                historyGroups.length > 0 ? historyGroups.map(g => (
                  <button
                    key={g.order_id}
                    onClick={() => selectOrder(g)}
                    className={cn(
                      "w-full text-left p-3 rounded-md transition-colors border text-sm flex flex-col gap-1 bg-card",
                      selectedOrderId === g.order_id
                        ? "bg-primary/5 border-primary text-primary shadow-sm"
                        : "hover:border-primary/50 border-transparent shadow-sm"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium truncate">{g.first_name} {g.last_name}</span>
                      <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 ml-2">{g.specimens.length} test{g.specimens.length > 1 ? 's' : ''}</span>
                    </div>
                    <div className="text-xs font-mono text-muted-foreground">{g.participant_number}</div>
                    <div className="text-[11px] text-muted-foreground">{new Date(g.order_time).toLocaleDateString()}</div>
                  </button>
                )) : (
                  <div className="p-8 text-center text-muted-foreground text-sm border-2 border-dashed rounded-lg">
                    {loading ? 'Loading...' : 'No matching history records.'}
                  </div>
                )
              )}
            </div>
          </div>

          {/* CENTER: Patient Details + Result Entry */}
          <div className="lg:col-span-6 flex flex-col gap-6 h-full min-h-0">

            <div className="bg-card rounded-lg border shadow-sm p-4 h-fit flex-shrink-0">
              <div className="flex items-center justify-between border-b pb-2 mb-3">
                <h3 className="font-medium flex items-center gap-2">
                  <User className="w-4 h-4" /> Patient Details
                </h3>
                {currentGroup && (
                  <Button variant="outline" size="sm" onClick={handlePrintResults} disabled={printing}>
                    {printing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Printer className="w-3.5 h-3.5 mr-1.5" />}
                    {printing ? 'Preparing...' : 'Print All Results'}
                  </Button>
                )}
              </div>
              {currentGroup ? (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground font-semibold uppercase">Participant</div>
                    <div className="font-medium">{currentGroup.first_name} {currentGroup.last_name}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground font-semibold uppercase">ID</div>
                    <div className="font-mono text-primary font-medium">{currentGroup.participant_number}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground font-semibold uppercase">Ordered</div>
                    <div>{new Date(currentGroup.order_time).toLocaleString()}</div>
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground text-sm py-2">Select a patient from the worklist to view details.</div>
              )}
            </div>

            <div className="bg-card rounded-lg border shadow-sm flex-1 flex flex-col overflow-hidden min-h-0">
              <div className="p-4 border-b bg-muted/30 flex justify-between items-center">
                <h3 className="font-medium flex items-center gap-2">
                  <Activity className="w-4 h-4" /> Result Entry
                  {selectedSpecimen && <span className="text-primary ml-2 border-l pl-2 font-mono">{selectedSpecimen.test_name}</span>}
                </h3>
                <div className="flex items-center gap-2">
                  {commonResultsPreset && selectedSpecimen?.status !== 'approved' && (
                    <Button variant="outline" size="sm" onClick={fillCommonResults}>
                      <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Fill Common Results
                    </Button>
                  )}
                  {selectedSpecimen?.status === 'approved' && (
                    <span className="text-[10px] bg-green-100 text-green-800 px-2 py-1 rounded-full uppercase font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Approved — Read Only
                    </span>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-auto p-6">
                {selectedSpecimen ? (
                  selectedTestSchema ? (
                    selectedTestSchema.components && selectedTestSchema.components.length > 0 ? (
                      <div className="w-full">
                        {selectedTestSchema.machine_integration === 'mindray' && (
                          <div className="mb-4">
                            <MindrayIntegration
                              testRequestId={selectedSpecimen.order_id}
                              onResultReceived={(sampleId, results) => {
                                const machineValues = new Map();
                                results.components.forEach((c: any) => {
                                  if (c.name) machineValues.set(c.name.trim().toLowerCase(), c);
                                });

                                const newResultValues = { ...resultValues };
                                selectedTestSchema.components.forEach((comp: any) => {
                                  const compName = comp.name?.trim().toLowerCase() || '';
                                  let matched = machineValues.get(compName);

                                  // Handling aliases (like WBC, RBC)
                                  if (!matched) {
                                    const aliases: Record<string, string[]> = {
                                      'white blood cells': ['wbc'],
                                      'red blood cells': ['rbc'],
                                      'hemoglobin': ['hgb', 'hb'],
                                      'hematocrit': ['hct'],
                                      'mean corpuscular volume': ['mcv'],
                                      'mean corpuscular hemoglobin': ['mch'],
                                      'mean corpuscular hb conc': ['mchc'],
                                      'platelets': ['plt'],
                                      'lymphocytes %': ['lym%'],
                                      'monocytes %': ['mon%'],
                                      'granulocytes %': ['gra%'],
                                      'lymphocytes #': ['lym#'],
                                      'monocytes #': ['mon#'],
                                      'granulocytes #': ['gra#']
                                    };

                                    const compAliases = aliases[compName] || [];
                                    for (const alias of compAliases) {
                                      if (machineValues.has(alias)) {
                                        matched = machineValues.get(alias);
                                        break;
                                      }
                                    }
                                  }

                                  if (matched) {
                                    newResultValues[comp.id] = matched.value;
                                  }
                                });
                                setResultValues(newResultValues);
                              }}
                            />
                          </div>
                        )}

                        <AdvancedDataTable<any>
                          data={selectedTestSchema.components}
                          keyExtractor={(comp) => comp.id}
                          columns={[
                            { key: 'name', header: 'Parameter', render: (v) => <span className="font-medium">{v}</span> },
                            {
                              key: '__value', header: 'Result Value', width: '12rem',
                              render: (_v, comp) => (
                                <Input
                                  className="h-8 bg-background disabled:opacity-70 disabled:cursor-not-allowed"
                                  value={resultValues[comp.id] || ''}
                                  onChange={(e) => setResultValues({ ...resultValues, [comp.id]: e.target.value })}
                                  disabled={selectedSpecimen.status === 'approved'}
                                />
                              ),
                            },
                            { key: 'unit', header: 'Unit', width: '6rem', render: (v) => <span className="text-muted-foreground">{v || '-'}</span> },
                            { key: 'reference_range', header: 'Ref Range', render: (v) => <span className="text-xs text-muted-foreground">{v || '-'}</span> },
                            {
                              key: '__remarks', header: 'Remarks', width: '6rem',
                              render: (_v, comp) => getRemark(resultValues[comp.id], comp.reference_range),
                            },
                          ]}
                        />

                        {/* ONE comment box for the whole test, not one per analyte —
                            a CBC has 20 components and one note, not 20. */}
                        <div className="mt-4">
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">
                            Comment for this test (optional — appears on the printed report only if filled in)
                          </label>
                          <textarea
                            className="w-full min-h-[70px] text-sm border rounded-md p-2 bg-background disabled:opacity-70 disabled:cursor-not-allowed"
                            placeholder="e.g. Slight hemolysis noted, patient fasting, repeat in 1 week..."
                            value={testComment}
                            onChange={(e) => setTestComment(e.target.value)}
                            disabled={selectedSpecimen.status === 'approved'}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="text-muted-foreground">This test has no components defined in the database.</div>
                    )
                  ) : (
                    <div className="text-muted-foreground">Loading test schema...</div>
                  )
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg p-8 text-center">
                    {currentGroup ? 'Select a test from the right panel to enter results.' : 'Select a patient from the worklist to begin.'}
                  </div>
                )}
              </div>

              {selectedSpecimen && selectedTestSchema?.components?.length > 0 && selectedSpecimen.status !== 'approved' && (
                <div className="p-4 border-t bg-card flex justify-end gap-2">
                  <Button onClick={handleSaveResults} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    {saving ? 'Saving...' : 'Save & Next Test'}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Test list for the selected patient's order */}
          <div className="lg:col-span-3 bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden h-full min-h-0">
            <div className="p-4 border-b bg-muted/30">
              <h3 className="font-medium flex items-center gap-2">
                <FlaskConical className="w-4 h-4" /> Tests {currentGroup ? `(${currentGroup.specimens.length})` : ''}
              </h3>
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-1 bg-card">
              {currentGroup ? (
                currentGroup.specimens.map((s: any) => {
                  const isDone = ['analyzed', 'pending_manager_review', 'approved'].includes(s.status);
                  return (
                    <button
                      key={s.id}
                      onClick={() => loadSpecimen(s)}
                      className={cn(
                        "w-full text-left p-3 rounded-md transition-colors border text-sm flex items-start gap-2 bg-card",
                        selectedSpecimen?.id === s.id
                          ? "bg-primary/5 border-primary text-primary shadow-sm"
                          : "hover:border-primary/50 border-transparent shadow-sm"
                      )}
                    >
                      {isDone ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                      ) : (
                        <Circle className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{s.test_name}</div>
                        <div className="text-xs font-mono text-muted-foreground">{s.barcode}</div>
                        <div className="text-[11px] text-muted-foreground flex items-center justify-between">
                          <span>{s.department || 'Lab'}</span>
                          {activeTab === 'history' && s.status === 'approved' && <span className="text-[10px] bg-green-100 text-green-800 px-1.5 py-0.5 rounded uppercase font-bold">Approved</span>}
                          {activeTab === 'history' && s.status === 'analyzed' && <span className="text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded uppercase font-bold">Analyzed</span>}
                          {activeTab === 'history' && s.status === 'pending_manager_review' && <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded uppercase font-bold">Review</span>}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                    </button>
                  );
                })
              ) : (
                <div className="p-8 text-center text-muted-foreground text-sm border-2 border-dashed rounded-lg">
                  Select a patient to see their tests.
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
      </div>
    </AppLayout>
  );
}
