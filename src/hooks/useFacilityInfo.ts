import { useState, useEffect } from 'react';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';

export interface FacilityInfo {
  facilityName: string;
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

export const useFacilityInfo = (): FacilityInfo => {
  const { user } = useAuth();
  const [info, setInfo] = useState<FacilityInfo>({
    facilityName: 'IntelliCare HMIS',
    facilityType: '',
    facilityAddress: '',
    facilityCity: '',
    facilityPhone: '',
    facilityEmail: '',
    facilityLicenseNo: '',
    branchName: '',
    branchAddress: '',
    branchPhone: '',
  });

  useEffect(() => {
    const fetchInfo = async () => {
      try {
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
          }
        }

        const branchId = user?.branchId || user?.primaryBranchId;
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

        setInfo(prev => ({ ...prev, ...update }));
      } catch (error) {
        console.error('Error fetching facility info:', error);
      }
    };

    fetchInfo();
  }, [user?.branchId, user?.primaryBranchId]);

  return info;
};
