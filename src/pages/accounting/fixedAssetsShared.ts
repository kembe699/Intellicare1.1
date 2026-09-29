// Shared types/constants for the Fixed Assets module's pages (register list,
// register/new, register/:id detail, depreciation, reports) — split out so
// each routed page can import just what it needs instead of one monolithic
// file backing client-side tabs.

export interface Category {
  id: string; name: string; nature: 'depreciating' | 'appreciating' | 'non_depreciating';
  default_depreciation_method: string; default_useful_life_years: number | null; default_salvage_percent: string;
  asset_account_id: string; accumulated_depreciation_account_id: string | null; depreciation_expense_account_id: string | null;
  asset_account_name?: string; accumulated_depreciation_account_name?: string; depreciation_expense_account_name?: string;
  is_active: boolean;
}

export interface Asset {
  id: string; asset_code: string; name: string; category_id: string; category_name: string; category_nature: string;
  description: string | null; serial_number: string | null; location: string | null; branch_id: number | null;
  assigned_to_employee_id: string | null; assignee_first_name?: string; assignee_last_name?: string;
  nature: string; acquisition_date: string; acquisition_cost: string; acquisition_currency?: string | null;
  acquisition_cost_original?: string | null; acquisition_exchange_rate?: string | null;
  salvage_value: string; useful_life_years: number | null;
  accumulated_depreciation: string; current_value: string; status: string;
  disposal_date?: string | null; disposal_proceeds?: string | null; disposal_reason?: string | null;
  created_by?: string | null; registered_by_name?: string | null; created_at?: string;
}

export interface ChartAccount { id: string; account_code: string; account_name: string; account_type: string; }
export interface Employee { id: string; first_name: string; last_name: string; employee_number: string; }
export interface Currency { id: string; code: string; symbol: string; name: string; decimal_places: number; is_base_currency: boolean; is_active: boolean; }

export const NATURE_LABEL: Record<string, string> = { depreciating: 'Depreciating', appreciating: 'Appreciating', non_depreciating: 'Non-depreciating' };
export const NATURE_BADGE: Record<string, 'warning' | 'success' | 'neutral'> = { depreciating: 'warning', appreciating: 'success', non_depreciating: 'neutral' };
export const fmt = (v: string | number) => `${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtCur = (v: string | number, currency?: string | null) => `${currency ? `${currency} ` : ''}${fmt(v)}`;
