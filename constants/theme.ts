import { Platform } from 'react-native';

const tintLight = '#0F766E';
const tintDark = '#5EEAD4';

export const Colors = {
  light: {
    text: '#0F172A',
    textMuted: '#64748B',
    background: '#FAFAF9',
    surface: '#FFFFFF',
    surfaceMuted: '#F1F5F9',
    tint: tintLight,
    icon: '#64748B',
    tabIconDefault: '#94A3B8',
    tabIconSelected: tintLight,
    border: '#E2E8F0',
  },
  dark: {
    text: '#ECEDEE',
    textMuted: '#94A3B8',
    background: '#0B1220',
    surface: '#111827',
    surfaceMuted: '#1F2937',
    tint: tintDark,
    icon: '#9BA1A6',
    tabIconDefault: '#475569',
    tabIconSelected: tintDark,
    border: '#1F2937',
  },
};

export const Semantic = {
  cash: '#059669',
  cashSoft: '#D1FAE5',
  transfer: '#4F46E5',
  transferSoft: '#E0E7FF',
  cost: '#D97706',
  costSoft: '#FEF3C7',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  warning: '#F59E0B',
  warningSoft: '#FEF3C7',
  neutral: '#475569',
  neutralSoft: '#F1F5F9',
  textDark: '#334155',
  tealSoft: '#CCFBF1',
  dangerDark: '#991B1B',
  warningDark: '#92400E',
  lowStockBg: '#FFFBFB',
};

/**
 * Dark-mode overrides for the scheme-dependent semantic tokens.
 * Accents are brightened for contrast on dark surfaces; the pale "soft"
 * backgrounds become deep tints; strong text tones flip light.
 * Keys not present here fall back to the light `Semantic` values.
 */
export const SemanticDark: Partial<typeof Semantic> = {
  cash: '#34D399',
  transfer: '#818CF8',
  cost: '#FBBF24',
  danger: '#F87171',
  warning: '#FBBF24',
  neutral: '#94A3B8',
  cashSoft: '#064E3B',
  transferSoft: '#312E81',
  costSoft: '#78350F',
  dangerSoft: '#7F1D1D',
  warningSoft: '#78350F',
  neutralSoft: '#1F2937',
  textDark: '#CBD5E1',
  tealSoft: '#134E4A',
  dangerDark: '#FCA5A5',
  warningDark: '#FCD34D',
  lowStockBg: '#2A1618',
};

export type ColorScheme = 'light' | 'dark';

/** Flattened per-scheme palette: base colors + semantic tokens in one object. */
export const Palette: Record<ColorScheme, typeof Colors.light & typeof Semantic> = {
  light: { ...Colors.light, ...Semantic },
  dark: { ...Colors.dark, ...Semantic, ...SemanticDark },
};

export const Shadows = {
  sm: '0 1px 2px rgba(15,23,42,0.05)',
  md: '0 1px 3px rgba(15,23,42,0.08), 0 1px 2px rgba(15,23,42,0.04)',
  lg: '0 8px 16px rgba(15,23,42,0.10), 0 2px 4px rgba(15,23,42,0.06)',
  hero: '0 12px 24px rgba(15,118,110,0.25), 0 4px 8px rgba(15,118,110,0.15)',
};

/** Spacing scale — multiples of 4 */
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
} as const;

/** Border radius scale */
export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 999,
} as const;

/** Font size scale */
export const FontSize = {
  xs: 13,
  sm: 14,
  md: 15,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 42,
} as const;

/** Overlay / hero-card decorative alphas */
export const Overlay = {
  subtle: 'rgba(255,255,255,0.06)',
  light: 'rgba(255,255,255,0.08)',
  medium: 'rgba(255,255,255,0.15)',
  strong: 'rgba(255,255,255,0.25)',
  text: 'rgba(255,255,255,0.75)',
  textStrong: 'rgba(255,255,255,0.85)',
} as const;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
