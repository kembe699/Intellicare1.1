/**
 * IntelliCare Design Tokens
 * Single source of truth for all brand values.
 * Use Tailwind utilities (bg-primary, text-primary, etc.) wherever possible.
 * These constants are for the rare cases that REQUIRE inline styles (e.g. dynamic SVG, canvas, print).
 */

export const BRAND = {
  brandTeal:    '#0A96A1',  // logo, accents
  primary:      '#077A84',  // buttons, links, focus ring — CSS: hsl(var(--primary))
  primaryHover: '#06656D',  // teal hover/active
  primarySoft:  '#E3F3F4',  // selected chip / info badge background
  primaryLight10: 'rgba(7,122,132,0.10)', // primary/10 bg tint
  primaryMid:   'rgba(7,122,132,0.06)',   // primary/6 subtle tint (table headers, card headers)
  heading:      '#14363C',  // heading ink — page/card titles
  body:         '#1B2A2F',  // body text
  label:        '#34484E',  // label text
  gray:         '#50646A',  // muted text — passes 4.5:1 on white
  grayLight:    '#94A3B8',  // placeholder, muted icons
  border:       '#D3DFE0',  // card/panel borders, table header line
  inputBorder:  '#BFCFD1',  // input borders
  borderLight:  '#EEF1F2',  // row dividers inside cards
  bgPage:       '#F8FAFC',  // page background (kept as-is)
  bgCard:       '#FFFFFF',  // white — card/panel background
  tableHeaderBg:'#F6F9F9',  // table header background
  disabledBg:   '#F1F5F5',  // disabled field background
  skeleton:     '#E3EBEC',  // loading skeleton
  success:      '#1D7A46',
  successBg:    '#E5F4EC',
  successBorder:'#A9DFC0',
  warning:      '#8A5300',
  warningBg:    '#FDF1DC',
  warningBorder:'#F2D49B',
  danger:       '#B42318',
  dangerBg:     '#FDE8E6',
  dangerBorder: '#F4C7C2',
  info:         '#06656D',
  infoBg:       '#E3F3F4',
  infoBorder:   '#BFE0E2',
  neutral:      '#50646A',
  neutralBg:    '#EEF1F2',
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
  sizeCaption: '12px', // minimum — nothing below this
  sizeLabel:   '13px',
  sizeBase:    '15px', // body
  sizeSection: '18px', // section/card title
  sizeTitle:   '24px', // page title (h1)
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

/** Status badge color map — use with IcBadge or Badge component.
 *  Every entry is one of the five semantic tones (success/warning/danger/
 *  info/neutral) per the Option B status-badge mapping table. */
const SUCCESS  = { bg: '#E5F4EC', text: '#1D7A46', border: '#A9DFC0' };
const WARNING  = { bg: '#FDF1DC', text: '#8A5300', border: '#F2D49B' };
const DANGER   = { bg: '#FDE8E6', text: '#B42318', border: '#F4C7C2' };
const INFO     = { bg: '#E3F3F4', text: '#06656D', border: '#BFE0E2' };
const NEUTRAL  = { bg: '#EEF1F2', text: '#50646A', border: '#D3DFE0' };

export const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  // success — paid, completed, balanced, active
  active:     SUCCESS,
  completed:  SUCCESS,
  balanced:   SUCCESS,
  paid:       SUCCESS,
  normal:     SUCCESS,
  // warning — partial, pending, waiting, due
  pending:    WARNING,
  waiting:    WARNING,
  partial:    WARNING,
  due:        WARNING,
  // danger — unpaid, overdue, failed, short, rejected
  unpaid:     DANGER,
  overdue:    DANGER,
  failed:     DANGER,
  short:      DANGER,
  rejected:   DANGER,
  high:       DANGER,
  critical:   DANGER,
  // info — in progress, processing
  in_progress:  INFO,
  'in-progress':INFO,
  processing:   INFO,
  low:          INFO,
  // neutral — cancelled, draft, inactive
  cancelled:  NEUTRAL,
  draft:      NEUTRAL,
  inactive:   NEUTRAL,
  closed:     NEUTRAL,
};
