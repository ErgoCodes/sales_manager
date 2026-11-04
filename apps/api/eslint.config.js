const { defineConfig } = require('eslint/config');

// Hexagonal boundaries (ADR 0001): domain/ and application/ are plain
// TypeScript. They may not import frameworks, persistence or outer layers.
const frameworkImports = [
  { group: ['@nestjs/*', 'nestjs-*'], message: 'domain/ and application/ must not depend on NestJS (wire them with useFactory in the module).' },
  { group: ['drizzle-orm', 'drizzle-orm/*', 'pg', 'pg-*', 'postgres'], message: 'Persistence belongs in infrastructure/ behind a port.' },
  { group: ['express', 'express/*', 'helmet', 'pino', 'pino-*'], message: 'HTTP and logging concerns belong in http/ or common/.' },
  { group: ['**/infrastructure/**', '**/infrastructure', '**/http/**', '**/http'], message: 'Inner layers cannot import outer layers (infrastructure/, http/).' },
];

module.exports = defineConfig([
  ...require('@monaco/eslint-config'),
  {
    files: ['src/modules/*/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...frameworkImports,
            { group: ['**/application/**', '**/application'], message: 'domain/ cannot import application/.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/modules/*/application/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: frameworkImports }] },
  },
]);
