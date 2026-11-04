import { createRequire } from 'node:module';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const require = createRequire(import.meta.url);
const base = require('@monaco/eslint-config');

const config = [
  ...base,
  ...nextCoreWebVitals,
  ...nextTypescript,
  { ignores: ['.next/**', 'next-env.d.ts', 'src/lib/api/schema.d.ts'] },
];

export default config;
