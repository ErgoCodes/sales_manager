/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: 'var(--color-primary)', soft: 'var(--color-primary-soft)' },
        surface: { DEFAULT: 'var(--color-surface)', muted: 'var(--color-surface-muted)', bg: 'var(--color-background)' },
        semantic: {
          cash: 'var(--color-cash)',
          'cash-soft': 'var(--color-cash-soft)',
          transfer: 'var(--color-transfer)',
          'transfer-soft': 'var(--color-transfer-soft)',
          cost: 'var(--color-cost)',
          'cost-soft': 'var(--color-cost-soft)',
          danger: 'var(--color-danger)',
          'danger-soft': 'var(--color-danger-soft)',
          'danger-dark': 'var(--color-danger-dark)',
          warning: 'var(--color-warning)',
          'warning-soft': 'var(--color-warning-soft)',
          'warning-dark': 'var(--color-warning-dark)',
          neutral: 'var(--color-neutral)',
          'neutral-soft': 'var(--color-neutral-soft)',
          'low-stock-bg': 'var(--color-low-stock-bg)',
          'teal-soft': 'var(--color-teal-soft)',
        },
        border: { DEFAULT: 'var(--color-border)' },
        'text-strong': 'var(--color-text-strong)',
        'text-muted': 'var(--color-text-muted)',
        'tab-default': 'var(--color-tab-default)',
      },
      borderRadius: {
        card: '16px',
        hero: '20px',
      },
    },
  },
  plugins: [],
};
