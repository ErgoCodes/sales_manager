import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      // `server-only` throws outside the RSC graph; stub it for unit tests.
      { find: /^server-only$/, replacement: fileURLToPath(new URL('./vitest.server-only.ts', import.meta.url)) },
    ],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/lib/api/schema.d.ts', 'src/app/layout.tsx', 'src/app/page.tsx', 'src/components/ui/**'],
      // Initial floor for the skeleton; raise as SP2 adds features.
      thresholds: { statements: 80, branches: 70, functions: 80, lines: 80 },
    },
  },
});
