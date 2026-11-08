const { defineConfig } = require('eslint/config');

// Hexagonal boundaries (ADR 0001): domain/ and application/ are plain
// TypeScript. They may not import frameworks, persistence or outer layers.
const frameworkImports = [
  { group: ['@nestjs/*', 'nestjs-*'], message: 'domain/ and application/ must not depend on NestJS (wire them with useFactory in the module).' },
  { group: ['drizzle-orm', 'drizzle-orm/*', 'pg', 'pg-*', 'postgres'], message: 'Persistence belongs in infrastructure/ behind a port.' },
  { group: ['express', 'express/*', 'helmet', 'pino', 'pino-*'], message: 'HTTP and logging concerns belong in http/ or common/.' },
  { group: ['**/infrastructure/**', '**/infrastructure', '**/http/**', '**/http'], message: 'Inner layers cannot import outer layers (infrastructure/, http/).' },
  {
    group: ['**/*.module', '**/*.module.ts', '**/*.tokens', '**/*.tokens.ts', '**/app.module', '**/bootstrap', '**/main', '**/scripts/**'],
    message: 'Composition roots (modules, DI tokens, bootstrap) are wired from the outside, never imported by inner layers.',
  },
  {
    group: ['**/common/**', '**/common', '**/config/**', '**/config'],
    message: 'src/common and src/config are Nest/HTTP infrastructure; pass values in through constructors instead.',
  },
];

module.exports = defineConfig([
  ...require('@monaco/eslint-config'),
  {
    // Tenant repositories only exist inside a unit of work (ADR 0004): they take
    // a TenantTransaction, and only the *unit-of-work.ts adapter may build them.
    // Listed first: the domain/application blocks below replace this rule with
    // their stricter lists (which already forbid infrastructure/ as a whole).
    files: ['src/**/*.ts', 'test/**/*.ts'],
    ignores: ['src/modules/*/infrastructure/*unit-of-work.ts', 'src/modules/*/infrastructure/repositories/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/repositories/*', '**/repositories'],
              message: 'Repositories are built only by the module\'s TenantUnitOfWork adapter; use TenantUnitOfWork.run(tenantId, scope => ...).',
            },
          ],
        },
      ],
    },
  },
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
