import { useState, useEffect } from 'react';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';

export interface FacilityInfo {
  facilityName: string;
  /** Facility logo as a data URI; empty when none has been uploaded. */
  facilityLogo: string;
  facilityType: string;
  facilityAddress: string;
  facilityCity: string;
  facilityPhone: string;
  facilityEmail: string;
  facilityLicenseNo: string;
  branchName: string;
  branchAddress: string;
  branchPhone: string;
}

const DEFAULTS: FacilityInfo = {
  // Deliberately blank, not a product name. Anything reading this before the
  // fetch lands shows nothing rather than branding a document, a report or a
  // receipt with the wrong hospital.
  facilityName: '',
  facilityLogo: '',
  facilityType: '',
  facilityAddress: '',
  facilityCity: '',
  facilityPhone: '',
  facilityEmail: '',
  facilityLicenseNo: '',
  branchName: '',
  branchAddress: '',
  branchPhone: '',
};

/**
 * One shared copy of the facility's identity, fetched once.
 *
 * Every component that printed a document used to fetch this for itself, each
 * starting from the IntelliCare defaults above and filling them in a few
 * hundred milliseconds later. Printing before that landed produced a document
 * branded IntelliCare instead of the facility — the same screen giving a
 * different letterhead depending on how quickly the button was clicked. Thirteen
 * components also meant thirteen duplicate fetch chains.
 *
 * The result is cached here and shared, so after the first load the correct
 * identity is available synchronously, and `getFacilityInfo()` lets a print
 * handler wait for it rather than racing it.
 */
let cached: FacilityInfo | null = null;
let inFlight: Promise<FacilityInfo> | null = null;
const subscribers = new Set<(info: FacilityInfo) => void>();

async function loadFacilityInfo(branchId?: number | null): Promise<FacilityInfo> {
  const update: Partial<FacilityInfo> = {};

  const facRes = await authFetch('/api/facilities');
  if (facRes.ok) {
    const facData = await facRes.json();
    const d = facData.data;
    if (d) {
      if (d.name)            update.facilityName      = d.name;
      if (d.type)            update.facilityType      = d.type;
      if (d.address)         update.facilityAddress   = d.address;
      if (d.city)            update.facilityCity      = d.city;
      if (d.phone)           update.facilityPhone     = d.phone;
      if (d.email)           update.facilityEmail     = d.email;
      if (d.license_number)  update.facilityLicenseNo = d.license_number;
      if (d.logo)            update.facilityLogo      = d.logo;
    }
  }

  let branchData: any = null;
  if (branchId) {
    const branchRes = await authFetch(`/api/facilities/branches/${branchId}`);
    if (branchRes.ok) {
      const bd = await branchRes.json();
      if (bd.success && bd.data?.name) branchData = bd.data;
    }
  }
  if (!branchData) {
    const branchesRes = await authFetch('/api/facilities/branches/all');
    if (branchesRes.ok) {
      const bd = await branchesRes.json();
      if (bd.success && bd.data?.length > 0) {
        branchData = bd.data.find((b: any) => b.is_main_branch) || bd.data[0];
      }
    }
  }
  if (branchData) {
    if (branchData.name)    update.branchName    = branchData.name;
    if (branchData.address) update.branchAddress = branchData.address;
    if (branchData.phone)   update.branchPhone   = branchData.phone;
  }

  return { ...DEFAULTS, ...update };
}

/**
 * The facility's identity, waiting for the first load if it has not happened.
 *
 * Print and PDF handlers should await this instead of reading the hook's
 * current value, so a document is never branded with the placeholder simply
 * because it was requested early.
 */
export async function getFacilityInfo(branchId?: number | null): Promise<FacilityInfo> {
  if (cached) return cached;
  if (!inFlight) {
    inFlight = loadFacilityInfo(branchId)
      .then((info) => {
        cached = info;
        subscribers.forEach((fn) => fn(info));
        return info;
      })
      .catch((error) => {
        console.error('Error fetching facility info:', error);
        // Not cached: a failure here must not pin the placeholder identity for
        // the rest of the session, so the next caller retries.
        return DEFAULTS;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

/**
 * The loaded identity if there is one, without waiting.
 *
 * For synchronous consumers — chiefly the document template, which builds HTML
 * in one pass. A component that rendered before the fetch landed still holds the
 * blank starting values; reading the shared cache here means the document gets
 * the real facility even when the caller's own copy is stale.
 */
export function peekFacilityInfo(): FacilityInfo | null {
  return cached;
}

/** Drop the cache after the facility is edited, so changes show immediately. */
export function refreshFacilityInfo(branchId?: number | null): Promise<FacilityInfo> {
  cached = null;
  inFlight = null;
  return getFacilityInfo(branchId);
}

export const useFacilityInfo = (): FacilityInfo => {
  const { user } = useAuth();
  // Starts from the cache when there is one, so a screen opened after the first
  // load has the real identity on its very first render.
  const [info, setInfo] = useState<FacilityInfo>(() => cached || DEFAULTS);

  useEffect(() => {
    let alive = true;
    const onUpdate = (next: FacilityInfo) => { if (alive) setInfo(next); };
    subscribers.add(onUpdate);
    getFacilityInfo(user?.branchId || user?.primaryBranchId).then(onUpdate);
    return () => { alive = false; subscribers.delete(onUpdate); };
  }, [user?.branchId, user?.primaryBranchId]);

  return info;
};
