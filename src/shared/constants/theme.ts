export const colors = {
  bg: '#1a1a2e',
  bgSecondary: '#16213e',
  bgCard: '#0f3460',
  accent: '#4f46e5',
  accentLight: '#7c75f0',
  text: '#ffffff',
  textSecondary: '#aaaacc',
  textMuted: '#666688',
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  border: '#2a2a4a',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  xl: 24,
  full: 9999,
};

export const typography = {
  h1: { fontSize: 32, fontWeight: '700' as const, letterSpacing: 0.5 },
  h2: { fontSize: 24, fontWeight: '700' as const },
  h3: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  caption: { fontSize: 14, fontWeight: '400' as const },
  label: { fontSize: 12, fontWeight: '500' as const, letterSpacing: 0.5 },
};
