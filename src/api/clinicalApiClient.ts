/**
 * Shared clinical API layer used by Clinical.tsx and VisitDetails.tsx.
 * Consolidates what used to be a class duplicated in Clinical.tsx (ClinicalApiClient)
 * and a parallel set of bare authFetch calls in VisitDetails.tsx.
 */

import { clinicalApi, labRequestsApi, patientBillApi, labTestApi } from './apiClient';
import { toast } from 'sonner';

// ── Core clinical CRUD ───────────────────────────────────────────────────────

export const getPatients = (clinicId: string) => clinicalApi.get(`/patients/${clinicId}`);

export const getQueue = (clinicId: string, startDate?: string, endDate?: string) => {
  const params = new URLSearchParams();
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return clinicalApi.get(`/queue/${clinicId}${qs}`);
};

export const getVisits = (clinicId: string, doctorId: string, startDate?: string, endDate?: string) => {
  const params = new URLSearchParams();
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return clinicalApi.get(`/visits/${clinicId}/${doctorId}${qs}`);
};

export const createVisit = (visitData: Record<string, unknown>) => clinicalApi.post('/visits', visitData);

export const getLabTests = () => clinicalApi.get('/lab-tests');

export const getVisitDetails = (visitId: string) => clinicalApi.get(`/visit-details/${visitId}`);

export const getLabRequestsForVisit = (visitId: string) => clinicalApi.get(`/lab-requests/visit/${visitId}`);

export const getMedicines = (clinicId: string) => clinicalApi.get(`/medicines/${clinicId}`);

export const updateVisitDetails = (visitId: string, payload: Record<string, unknown>) =>
  clinicalApi.put(`/visits/${visitId}/details`, payload);

export const closeVisit = (visitId: string, closedBy: string) =>
  clinicalApi.put(`/visits/${visitId}/close`, { closedBy });

export const getPrescriptionsForVisit = (visitId: string) => clinicalApi.get(`/prescriptions/visit/${visitId}`);

export const createPrescription = (data: Record<string, unknown>) => clinicalApi.post('/prescriptions', data);

// ── Lab test requests + billing (single canonical implementation) ───────────

export interface LabTestRequestContext {
  visitId: string;
  patientId: string;
  patientName: string;
  clinicId: string | number;
  requestedBy: string;
  notes?: string;
}

export interface PatientBillContext {
  patientId: string;
  patientName: string;
  clinicId: string | number;
  createdBy: string;
}

async function findLabTestByName(testName: string): Promise<any | null> {
  try {
    const results = await labTestApi.search(testName);
    return results.find((t: any) => t.test_name?.toLowerCase() === testName.toLowerCase()) || null;
  } catch {
    return null;
  }
}

/** Creates one lab-request record per test name. Does not create a bill — see createPatientBillForLabTests. */
export async function createLabRequests(labTests: string[], ctx: LabTestRequestContext): Promise<void> {
  const clinicId = typeof ctx.clinicId === 'string' ? parseInt(ctx.clinicId) : ctx.clinicId;
  await Promise.all(labTests.map(async (testName) => {
    const testDetails = await findLabTestByName(testName);
    await labRequestsApi.post('', {
      patient_id: ctx.patientId,
      patient_name: ctx.patientName,
      clinic_id: clinicId,
      test_id: testDetails?.id || null,
      test_name: testName,
      test_code: testDetails?.test_code || (testName.toLowerCase().includes('blood count') ? 'CBC' : testName.substring(0, 3).toUpperCase()),
      requested_by: ctx.requestedBy,
      priority: 'normal',
      notes: ctx.notes || 'Lab test requested during clinical visit',
      visit_id: ctx.visitId,
    });
  }));
}

/**
 * Creates a new patient bill for the given lab tests, or adds them to an existing
 * active bill for that patient. Best-effort: a billing failure is logged but never
 * thrown, since it must not block the lab request (or visit) that triggered it.
 */
export async function createPatientBillForLabTests(labTests: string[], ctx: PatientBillContext): Promise<void> {
  try {
    const labTestsWithPrices = await Promise.all(
      labTests.map(async (testName) => {
        const match = await findLabTestByName(testName);
        const price = parseFloat(match?.price) || 0;
        return { serviceName: testName, quantity: 1, unitPrice: price, totalPrice: price };
      })
    );
    const totalAmount = labTestsWithPrices.reduce((sum, t) => sum + t.totalPrice, 0);
    const clinicId = typeof ctx.clinicId === 'string' ? ctx.clinicId : String(ctx.clinicId);

    try {
      const existingBill = await patientBillApi.get(`/active/${ctx.patientId}/${clinicId}`);
      await patientBillApi.put(`/${existingBill.id}/add-services`, { services: labTestsWithPrices });
      toast.success(`Lab tests added to existing bill ${existingBill.bill_number}`);
    } catch {
      // No existing active bill (or lookup failed) — create a new one.
      const billNumber = `BILL-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
      await patientBillApi.post('', {
        bill_number: billNumber,
        patient_id: ctx.patientId,
        patient_name: ctx.patientName,
        clinic_id: parseInt(clinicId),
        total_amount: totalAmount,
        paid_amount: 0,
        balance_amount: totalAmount,
        status: 'pending',
        bill_date: new Date().toISOString(),
        due_date: null,
        services: JSON.stringify(labTestsWithPrices),
        notes: `Lab tests requested during clinical visit on ${new Date().toLocaleDateString()}`,
        created_by: ctx.createdBy,
      });
      toast.success(`New patient bill ${billNumber} created for lab tests`);
    }
  } catch (error) {
    console.error('Error creating patient bill for lab tests:', error);
  }
}
