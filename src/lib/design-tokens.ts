/**
 * IntelliCare Design Tokens
 * Single source of truth for all brand values.
 * Use Tailwind utilities (bg-primary, text-primary, etc.) wherever possible.
 * These constants are for the rare cases that REQUIRE inline styles (e.g. dynamic SVG, canvas, print).
 */

export const BRAND = {
  primary:      '#1A7A75',  // logo dark teal — CSS: hsl(var(--primary))
  primaryDark:  '#155E5A',  // teal hover/active
  primaryLight: '#4ECDC4',  // logo light teal — for light-tone tints
  primaryLight10: 'rgba(26,122,117,0.10)', // teal/10 bg tint
  primaryMid:   'rgba(26,122,117,0.06)',   // teal/6 subtle tint (table headers, card headers)
  navy:         '#0F172A',  // deep navy — headings/body text
  gray:         '#64748B',  // slate-500 — secondary text, labels
  grayLight:    '#94A3B8',  // slate-400 — placeholder, muted icons
  border:       '#E2E8F0',  // slate-200 — card/panel borders
  borderLight:  '#F1F5F9',  // slate-100 — dividers inside cards
  bgPage:       '#F8FAFC',  // slate-50 — page background
  bgCard:       '#FFFFFF',  // white — card/panel background
  success:      '#16A34A',  // green-600
  warning:      '#D97706',  // amber-600
  danger:       '#DC2626',  // red-600
  info:         '#1A7A75',  // same as primary
} as const;

export const RADIUS = {
  xs:  '4px',
  sm:  '6px',
  md:  '8px',
  lg:  '12px',
  xl:  '16px',
  pill:'9999px',
} as const;

export const SHADOW = {
  sm:  '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)',
  md:  '0 4px 6px rgba(15,23,42,0.07), 0 2px 4px rgba(15,23,42,0.05)',
  lg:  '0 10px 15px rgba(15,23,42,0.08), 0 4px 6px rgba(15,23,42,0.05)',
} as const;

export const FONT = {
  sizeXs:   '10px',
  sizeSm:   '11px',
  sizeBase: '13px',
  sizeMd:   '14px',
  sizeLg:   '16px',
  sizeXl:   '18px',
  size2xl:  '20px',
  weightNormal:   '400',
  weightMedium:   '500',
  weightSemibold: '600',
  weightBold:     '700',
} as const;

export const SPACING = {
  pageGap:    '12px',   // gap between major page sections (space-y-3)
  cardPadH:   '16px',   // card horizontal padding (px-4)
  cardPadV:   '10px',   // card vertical padding (py-2.5)
  formGap:    '16px',   // gap between form fields
} as const;

/** Status badge color map — use with IcBadge or Badge component */
export const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  active:     { bg: '#F0FDF4', text: '#16A34A', border: '#BBF7D0' },
  completed:  { bg: '#F0FDFA', text: '#0D9488', border: '#99F6E4' },
  inactive:   { bg: '#F8FAFC', text: '#64748B', border: '#E2E8F0' },
  closed:     { bg: '#F8FAFC', text: '#64748B', border: '#E2E8F0' },
  pending:    { bg: '#FFFBEB', text: '#D97706', border: '#FDE68A' },
  waiting:    { bg: '#FFFBEB', text: '#D97706', border: '#FDE68A' },
  cancelled:  { bg: '#FEF2F2', text: '#DC2626', border: '#FECACA' },
  paid:       { bg: '#F0FDF4', text: '#16A34A', border: '#BBF7D0' },
  unpaid:     { bg: '#FEF2F2', text: '#DC2626', border: '#FECACA' },
  partial:    { bg: '#FFFBEB', text: '#D97706', border: '#FDE68A' },
  normal:     { bg: '#F0FDFA', text: '#0D9488', border: '#99F6E4' },
  high:       { bg: '#FEF2F2', text: '#DC2626', border: '#FECACA' },
  low:        { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE' },
  critical:   { bg: '#FEF2F2', text: '#DC2626', border: '#FECACA' },
};
