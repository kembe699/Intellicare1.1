/**
 * Design System Tokens
 * 
 * Centralized design tokens for consistent spacing, typography, colors, and other design values.
 * Use these tokens instead of arbitrary values to maintain design consistency across the app.
 */

export const spacing = {
  xs: '0.5rem',    // 8px
  sm: '0.75rem',   // 12px
  md: '1rem',      // 16px
  lg: '1.5rem',    // 24px
  xl: '2rem',      // 32px
  '2xl': '3rem',   // 48px
  '3xl': '4rem',   // 64px
} as const;

export const borderRadius = {
  none: '0',
  sm: '0.25rem',   // 4px
  md: '0.375rem',  // 6px
  lg: '0.5rem',    // 8px
  xl: '0.75rem',   // 12px
  '2xl': '1rem',   // 16px
  full: '9999px',
} as const;

export const fontSize = {
  xs: '0.75rem',   // 12px
  sm: '0.875rem',  // 14px
  base: '1rem',    // 16px
  lg: '1.125rem',  // 18px
  xl: '1.25rem',   // 20px
  '2xl': '1.5rem', // 24px
  '3xl': '1.875rem', // 30px
  '4xl': '2.25rem',  // 36px
} as const;

export const fontWeight = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const lineHeight = {
  tight: '1.25',
  normal: '1.5',
  relaxed: '1.75',
} as const;

export const shadows = {
  none: 'none',
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
} as const;

export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

/**
 * Semantic color tokens
 * These map to CSS custom properties defined in index.css
 */
export const colors = {
  // Base colors
  background: 'hsl(var(--background))',
  foreground: 'hsl(var(--foreground))',
  heading: 'hsl(var(--heading))',
  label: 'hsl(var(--label))',
  brandTeal: 'hsl(var(--brand-teal))',

  // Card colors
  card: 'hsl(var(--card))',
  cardForeground: 'hsl(var(--card-foreground))',

  // Primary brand colors
  primary: 'hsl(var(--primary))',
  primaryForeground: 'hsl(var(--primary-foreground))',
  primaryHover: 'hsl(var(--primary-hover))',
  primarySoft: 'hsl(var(--primary-soft))',

  // Secondary colors
  secondary: 'hsl(var(--secondary))',
  secondaryForeground: 'hsl(var(--secondary-foreground))',

  // Muted colors
  muted: 'hsl(var(--muted))',
  mutedForeground: 'hsl(var(--muted-foreground))',

  // Accent colors
  accent: 'hsl(var(--accent))',
  accentForeground: 'hsl(var(--accent-foreground))',

  // Status colors — each has a DEFAULT (solid), a soft background, and a
  // matching border, for the pill-badge / alert-box pattern.
  success: 'hsl(var(--success))',
  successForeground: 'hsl(var(--success-foreground))',
  successBg: 'hsl(var(--success-bg))',
  successBorder: 'hsl(var(--success-border))',
  warning: 'hsl(var(--warning))',
  warningForeground: 'hsl(var(--warning-foreground))',
  warningBg: 'hsl(var(--warning-bg))',
  warningBorder: 'hsl(var(--warning-border))',
  destructive: 'hsl(var(--destructive))',
  destructiveForeground: 'hsl(var(--destructive-foreground))',
  destructiveBg: 'hsl(var(--destructive-bg))',
  destructiveBorder: 'hsl(var(--destructive-border))',
  info: 'hsl(var(--info))',
  infoForeground: 'hsl(var(--info-foreground))',
  infoBg: 'hsl(var(--info-bg))',
  infoBorder: 'hsl(var(--info-border))',
  neutral: 'hsl(var(--neutral))',
  neutralForeground: 'hsl(var(--neutral-foreground))',
  neutralBg: 'hsl(var(--neutral-bg))',
  neutralBorder: 'hsl(var(--neutral-border))',

  // Border and input
  border: 'hsl(var(--border))',
  input: 'hsl(var(--input))',
  ring: 'hsl(var(--ring))',
  disabledBg: 'hsl(var(--disabled-bg))',
  skeleton: 'hsl(var(--skeleton))',
} as const;

/**
 * Z-index scale for layering
 */
export const zIndex = {
  base: 0,
  dropdown: 1000,
  sticky: 1020,
  fixed: 1030,
  modalBackdrop: 1040,
  modal: 1050,
  popover: 1060,
  tooltip: 1070,
} as const;

/**
 * Transition durations
 */
export const transitions = {
  fast: '150ms',
  base: '200ms',
  slow: '300ms',
  slower: '500ms',
} as const;

/**
 * Common transition timing functions
 */
export const easings = {
  linear: 'linear',
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
  easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
  easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

/**
 * Icon sizes
 */
export const iconSizes = {
  xs: '0.75rem',   // 12px
  sm: '1rem',      // 16px
  md: '1.25rem',   // 20px
  lg: '1.5rem',    // 24px
  xl: '2rem',      // 32px
} as const;

/**
 * Container max widths
 */
export const containerSizes = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
  full: '100%',
} as const;
