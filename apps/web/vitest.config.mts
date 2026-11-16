import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Radix (hoisted next to mobile's React 19.1) must share web's React 19.3 with react-dom/server.
      { find: /^react$/, replacement: fileURLToPath(new URL('./node_modules/react/index.js', import.meta.url)) },
      { find: /^react\/(jsx-runtime|jsx-dev-runtime)$/, replacement: fileURLToPath(new URL('./node_modules/react/', import.meta.url)) + '$1.js' },
      { find: /^react-dom$/, replacement: fileURLToPath(new URL('./node_modules/react-dom/index.js', import.meta.url)) },
      { find: /^react-dom\/(client|test-utils|server)$/, replacement: fileURLToPath(new URL('./node_modules/react-dom/', import.meta.url)) + '$1.js' },
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      // `server-only` throws outside the RSC graph; stub it for unit tests.
      { find: /^server-only$/, replacement: fileURLToPath(new URL('./vitest.server-only.ts', import.meta.url)) },
    ],
  },
  test: {
    server: { deps: { inline: [/radix-ui/, /@radix-ui/, /@floating-ui/, /aria-hidden/, /react-remove-scroll/, /react-style-singleton/, /use-sidecar/, /get-nonce/, /use-callback-ref/] } },
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/lib/api/schema.d.ts', 'src/app/layout.tsx', 'src/app/(backoffice)/page.tsx', 'src/components/ui/**'],
      // Initial floor for the skeleton; raise as SP2 adds features.
      thresholds: { statements: 80, branches: 70, functions: 80, lines: 80 },
    },
  },
});
