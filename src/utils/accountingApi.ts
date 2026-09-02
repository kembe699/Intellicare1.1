import { authFetch as _authFetch } from '@/api/apiClient';
export { getStatusColor } from '@/lib/statusColors';

export const apiFetch = _authFetch;

export type CurrencyCode = string;

// Matches the live base currency (currencies.is_base_currency=1, see CurrencyContext.tsx).
// This is a static fallback for accounting pages that don't already consume useCurrency() —
// if the base currency is ever changed via /setup, update this to match.
export const BASE_CURRENCY: CurrencyCode = 'SSP';

export const formatCurrency = (amount: number, currency: CurrencyCode = '') => {
  const n = parseFloat(String(amount || 0)).toFixed(2);
  return currency ? `${currency} ${n}` : n;
};

export const formatBaseCurrency = (amount: number, baseCurrencyCode = '') =>
  formatCurrency(amount, baseCurrencyCode);

export const getAccountTypeColor = (type: string) => {
  switch (type) {
    case 'asset': return 'bg-green-100 text-green-800';
    case 'liability': return 'bg-red-100 text-red-800';
    case 'equity': return 'bg-blue-100 text-blue-800';
    case 'revenue': return 'bg-purple-100 text-purple-800';
    case 'expense': return 'bg-orange-100 text-orange-800';
    default: return 'bg-gray-100 text-gray-800';
  }
};


export interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  sub_account_type: string;
  balance_type: string;
  opening_balance: number;
  current_balance?: number;
  is_active: boolean;
  is_bank_account: boolean;
  is_customer_account: boolean;
  is_supplier_account: boolean;
  description?: string;
}

export interface ExchangeRateRecord {
  id: string;
  clinic_id: number;
  from_currency: CurrencyCode;
  to_currency: CurrencyCode;
  rate: number;
  effective_date: string;
  expiry_date?: string;
  source: string;
  is_active: boolean;
  created_by?: string;
}

export interface GLEntry {
  id: string;
  gl_number: string;
  transaction_date: string;
  transaction_type: string;
  description: string;
  transaction_currency: CurrencyCode;
  base_currency: CurrencyCode;
  exchange_rate: number;
  total_debit: number;
  total_credit: number;
  base_total_debit: number;
  base_total_credit: number;
  status: string;
  lineItems: GLLineItem[];
}

export interface GLLineItem {
  id: string;
  account_id: string;
  debit_amount: number;
  credit_amount: number;
  base_debit_amount: number;
  base_credit_amount: number;
  line_description: string;
  account: {
    account_code: string;
    account_name: string;
  };
}

export interface JournalEntry {
  id: string;
  je_number: string;
  entry_date: string;
  description: string;
  transaction_currency: CurrencyCode;
  base_currency: CurrencyCode;
  exchange_rate: number;
  total_debit: number;
  total_credit: number;
  base_total_debit: number;
  base_total_credit: number;
  status: string;
  lines: JournalEntryLine[];
}

export interface JournalEntryLine {
  id: string;
  account_id: string;
  debit_amount: number;
  credit_amount: number;
  base_debit_amount: number;
  base_credit_amount: number;
  description: string;
  account: {
    account_code: string;
    account_name: string;
  };
}

export interface TrialBalance {
  accounts: TrialBalanceAccount[];
  total_debits: number;
  total_credits: number;
  is_balanced: boolean;
}

export interface TrialBalanceAccount {
  account_code: string;
  account_name: string;
  account_type: string;
  balance_type: string;
  debit_balance: number;
  credit_balance: number;
}
