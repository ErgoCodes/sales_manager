import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // SWC emits the decorator metadata Nest's DI relies on (esbuild does not).
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/main.ts', 'src/scripts/**'],
      // Unit-test floor, a few points under the current numbers (SP2 raises it).
      thresholds: {
        statements: 97,
        branches: 90,
        functions: 95,
        lines: 97,
        // Pure authorization rules: every branch is a security decision (SP2 · T2, ADR 0005).
        'src/modules/iam/domain/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.ts'] },
      },
      {
        // Needs Docker (Testcontainers). Never part of `test` / `test:coverage`.
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          globalSetup: ['test/integration/global-setup.ts'],
          // One container, shared state: files run one after another.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
