/** Design tokens shared by every screen — keeps the app visually coherent. */
export const colors = {
  mat50: '#f5f3ff',
  mat100: '#ede9fe',
  mat500: '#8b5cf6',
  mat600: '#7c3aed',
  mat700: '#6d28d9',
  mat900: '#4c1d95',
  ink50: '#f8fafc',
  ink100: '#f1f5f9',
  ink200: '#e2e8f0',
  ink300: '#cbd5e1',
  ink400: '#94a3b8',
  ink500: '#64748b',
  ink600: '#475569',
  ink700: '#334155',
  ink800: '#1e293b',
  ink900: '#0f172a',
  white: '#ffffff',
  green50: '#ecfdf5',
  green600: '#059669',
  green700: '#047857',
  amber50: '#fffbeb',
  amber600: '#d97706',
  amber700: '#b45309',
  rose50: '#fff1f2',
  rose600: '#e11d48',
  rose700: '#be123c',
  sky50: '#f0f9ff',
  sky600: '#0284c7',
} as const;

export const radius = { sm: 10, md: 14, lg: 20, xl: 28 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  active: { bg: colors.green50, fg: colors.green700 },
  trialing: { bg: colors.sky50, fg: colors.sky600 },
  past_due: { bg: colors.amber50, fg: colors.amber700 },
  frozen: { bg: colors.ink100, fg: colors.ink600 },
  cancelled: { bg: colors.rose50, fg: colors.rose700 },
  booked: { bg: colors.sky50, fg: colors.sky600 },
  checked_in: { bg: colors.green50, fg: colors.green700 },
  waitlisted: { bg: colors.amber50, fg: colors.amber700 },
  attended: { bg: colors.green50, fg: colors.green700 },
  no_show: { bg: colors.rose50, fg: colors.rose700 },
};
