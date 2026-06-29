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
};

export const Shadows = {
  sm: '0 1px 2px rgba(15,23,42,0.05)',
  md: '0 1px 3px rgba(15,23,42,0.08), 0 1px 2px rgba(15,23,42,0.04)',
  lg: '0 8px 16px rgba(15,23,42,0.10), 0 2px 4px rgba(15,23,42,0.06)',
  hero: '0 12px 24px rgba(15,118,110,0.25), 0 4px 8px rgba(15,118,110,0.15)',
};

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
