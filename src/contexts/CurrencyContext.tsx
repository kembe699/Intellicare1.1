import React, { createContext, useContext, useState, useEffect } from 'react';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { setCurrentBaseCurrencyCode } from '@/utils/reportUtils';
import { setCurrentBaseCurrency } from '@/utils/accountingApi';
import { setCurrentBaseCurrencyCode as setFormatBaseCurrencyCode } from '@/lib/format';

interface CurrencyData {
  code: string;
  symbol: string;
  name: string;
  decimal_places: number;
}

interface CurrencyContextValue {
  currency: CurrencyData;
  fmt: (amount: number | string) => string;
  /** The tenant's other configured currency (first active non-base one), or null if there isn't one / no rate is set. Display-only — see fmtDual. */
  secondaryCurrency: CurrencyData | null;
  /** Secondary-currency units per 1 base-currency unit (secondaryAmount = baseAmount * secondaryRate), or null if unavailable. */
  secondaryRate: number | null;
  /** Formats a base-currency amount, plus a "(≈ <secondary>)" suffix when a secondary currency + rate are configured — for display only; everything still posts in the base currency. */
  fmtDual: (amount: number | string) => string;
}

const DEFAULT_CURRENCY: CurrencyData = {
  code: '',
  symbol: '',
  name: '',
  decimal_places: 2,
};

const CurrencyContext = createContext<CurrencyContextValue>({
  currency: DEFAULT_CURRENCY,
  fmt: (amount) => parseFloat(String(amount || 0)).toFixed(2),
  secondaryCurrency: null,
  secondaryRate: null,
  fmtDual: (amount) => parseFloat(String(amount || 0)).toFixed(2),
});

export const CurrencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currency, setCurrency] = useState<CurrencyData>(DEFAULT_CURRENCY);
  const [secondaryCurrency, setSecondaryCurrency] = useState<CurrencyData | null>(null);
  const [secondaryRate, setSecondaryRate] = useState<number | null>(null);
  // /api/currencies/base requires auth (it's tenant-scoped — see server/index.js),
  // and this provider wraps the whole app including the public /login route. An
  // unconditional fetch here 401'd on first paint before any token existed, and
  // authFetch hard-redirects to /login on any 401 — which re-mounted this same
  // effect and 401'd again, an infinite reload loop. Gate on token, and reset to
  // defaults on logout so a previous session's currency doesn't linger into the
  // next login before its own fetch completes.
  const { token } = useAuth();

  useEffect(() => {
    if (!token) {
      setCurrency(DEFAULT_CURRENCY);
      setSecondaryCurrency(null);
      setSecondaryRate(null);
      return;
    }
    const load = async () => {
      try {
        const res = await authFetch('/api/currencies/base');
        if (res.ok) {
          const data = await res.json();
          if (data?.code) {
            setCurrency({
              code: data.code,
              symbol: data.symbol || data.code,
              name: data.name || data.code,
              decimal_places: data.decimal_places ?? 2,
            });
            // Keeps reportUtils.ts's fmtCurrency(), accountingApi.ts's
            // BASE_CURRENCY, and format.ts's formatMoney() — all used in
            // places that don't already consume useCurrency() — in sync
            // with the tenant's real base currency.
            setCurrentBaseCurrencyCode(data.code);
            setCurrentBaseCurrency(data.code);
            setFormatBaseCurrencyCode(data.code);
          }
        }
      } catch {
        // leave defaults — will show no currency prefix until loaded
      }
      try {
        const res = await authFetch('/api/currencies/secondary-rate');
        if (res.ok) {
          const data = await res.json();
          if (data?.secondary?.code && data?.rate != null) {
            setSecondaryCurrency({
              code: data.secondary.code,
              symbol: data.secondary.symbol || data.secondary.code,
              name: data.secondary.name || data.secondary.code,
              decimal_places: data.secondary.decimal_places ?? 2,
            });
            setSecondaryRate(parseFloat(data.rate));
          } else {
            setSecondaryCurrency(null);
            setSecondaryRate(null);
          }
        }
      } catch {
        // No secondary currency/rate configured — fmtDual just behaves like fmt.
      }
    };
    load();
  }, [token]);

  const fmt = (amount: number | string): string => {
    const n = parseFloat(String(amount || 0)).toFixed(currency.decimal_places);
    const label = currency.symbol || currency.code;
    return label ? `${label} ${n}` : n;
  };

  const fmtDual = (amount: number | string): string => {
    const base = fmt(amount);
    if (!secondaryCurrency || secondaryRate == null) return base;
    const converted = (parseFloat(String(amount || 0)) * secondaryRate).toFixed(secondaryCurrency.decimal_places);
    const label = secondaryCurrency.symbol || secondaryCurrency.code;
    return `${base} (≈ ${label} ${converted})`;
  };

  return (
    <CurrencyContext.Provider value={{ currency, fmt, secondaryCurrency, secondaryRate, fmtDual }}>
      {children}
    </CurrencyContext.Provider>
  );
};

export const useCurrency = () => useContext(CurrencyContext);
