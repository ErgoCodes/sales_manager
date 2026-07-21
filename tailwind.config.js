/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#0F766E', soft: '#CCFBF1' },
        surface: { DEFAULT: '#FFFFFF', muted: '#F1F5F9', bg: '#FAFAF9' },
        semantic: {
          cash: '#059669',
          'cash-soft': '#D1FAE5',
          transfer: '#4F46E5',
          'transfer-soft': '#E0E7FF',
          cost: '#D97706',
          'cost-soft': '#FEF3C7',
          danger: '#DC2626',
          'danger-soft': '#FEE2E2',
          'danger-dark': '#991B1B',
          warning: '#F59E0B',
          'warning-soft': '#FEF3C7',
          'warning-dark': '#92400E',
          neutral: '#475569',
          'neutral-soft': '#F1F5F9',
          'low-stock-bg': '#FFFBFB',
          'teal-soft': '#CCFBF1',
        },
        border: { DEFAULT: '#E2E8F0' },
        'text-strong': '#0F172A',
        'text-muted': '#64748B',
        'tab-default': '#94A3B8',
      },
      borderRadius: {
        card: '16px',
        hero: '20px',
      },
    },
  },
  plugins: [],
};
