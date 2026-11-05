import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/index.ts'],
      // SP2 · T2: the whole package is covered; keep every branch tested.
      thresholds: { statements: 95, branches: 100, functions: 95, lines: 95 },
    },
  },
});
