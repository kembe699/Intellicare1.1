import { authFetch } from '@/api/apiClient';

/**
 * The people a clinical or billing screen can act on.
 *
 * Someone can be registered in either of two places — the main patient registry
 * (/api/patients) or the LIS participant registry (/api/lis/participants) — and
 * which one holds them depends on how the facility works, not on who is asking.
 * Some tenants keep everybody in the LIS registry and have no rows in the main
 * one at all, so a picker that reads only one source is empty for them.
 *
 * This lived as four byte-identical copies (dispensing, prescriptions, billing,
 * proforma). They each requested both halves and skipped whichever one failed,
 * which meant a 403 on the participant list rendered as "no patients found"
 * rather than a permission error — the pharmacy role was missing from that
 * endpoint's allow-list and the screens simply showed an empty picker. Merging
 * is now written once, and a half that fails is reported rather than dropped.
 */
export interface DirectoryPerson {
  id: string;
  label: string;
  code?: string;
  /** Name parts kept separate for callers that render them individually. */
  firstName?: string;
  lastName?: string;
  source: 'patients' | 'lis';
}

export interface PatientDirectoryResult {
  people: DirectoryPerson[];
  /** Sources that could not be read; the list is incomplete when non-empty. */
  failed: string[];
}

async function readList(
  url: string,
  label: string,
  map: (row: any) => DirectoryPerson,
  into: DirectoryPerson[],
  failed: string[],
) {
  try {
    const res = await authFetch(url, { credentials: 'include' });
    if (!res.ok) {
      failed.push(res.status === 403 ? `${label} (not permitted for your role)` : label);
      return;
    }
    const data = await res.json();
    (Array.isArray(data) ? data : []).forEach((row: any) => into.push(map(row)));
  } catch {
    failed.push(label);
  }
}

export async function fetchPatientDirectory(): Promise<PatientDirectoryResult> {
  const people: DirectoryPerson[] = [];
  const failed: string[] = [];

  // Deliberately not filtered by clinic: clinic_id is the department someone was
  // registered under, not an access boundary. The tenant schema is the boundary,
  // and the server still scopes both lists to the caller's branch.
  await Promise.all([
    readList('/api/patients', 'Patient registry', (p) => ({
      id: p.id,
      label: `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.full_name,
      code: p.patient_id,
      firstName: p.first_name,
      lastName: p.last_name,
      source: 'patients',
    }), people, failed),
    readList('/api/lis/participants', 'LIS registry', (p) => ({
      id: p.id,
      label: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
      code: p.participant_number,
      firstName: p.first_name,
      lastName: p.last_name,
      source: 'lis',
    }), people, failed),
  ]);

  return { people, failed };
}
