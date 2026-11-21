# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Docs

Always read https://docs.expo.dev/versions/v54.0.0/ before writing Expo-specific code. The API changes between major versions; training data may be stale.

## Task Tracking

Task status (pending/in-progress/done) lives in Notion, not in this repo: [Centro de Proyectos › Mercado Mónaco — MVP multiplataforma](https://app.notion.com/p/39a19c33c39081fab767c40eb46cc347). `docs/` holds the technical spec for each task (file:line references, acceptance criteria); Notion says what's pending and its priority/size. Don't duplicate technical content into Notion — link to the doc instead.

`docs/01-estado-del-proyecto.md` and `docs/02-plan-roadmap-pendiente.md` are stale (dated 2026-07-07, describe tasks as pending that were implemented afterward). Treat `ROADMAP.md` + the Notion board as the source of truth for what's actually done.

The long-term vision (multi-tenant/backend platform, not started) is documented in `docs/12-vision-multiplataforma.md`.

## Package Manager

Use `pnpm` exclusively. Never use `npm` or `yarn`.

## Commands

```bash
# Mobile (Expo), from repository root
pnpm start
pnpm android
pnpm ios
pnpm web          # Expo web for mobile, not the Stage 2 web app

# Stage 2 platform: Postgres, then API (:4000) and web (:3000) together
pnpm db:up        # Postgres 17 from infra/docker-compose.yml
pnpm db:migrate   # migrations as the owner role (needs apps/api/.env)
pnpm dev          # api + web in parallel
pnpm db:down

# Quality
pnpm lint
pnpm typecheck
pnpm test:coverage
# API integration tests (Testcontainers, needs Docker; override image with POSTGRES_IMAGE)
pnpm --filter api test:integration
# Contracts: after changing packages/contracts, regenerate and commit both outputs
pnpm openapi:generate            # packages/contracts/openapi.json
pnpm --filter web api:generate   # apps/web/src/lib/api/schema.d.ts
```

Run Expo-specific commands from `apps/mobile/`. Shared pricing, stock, catalog, formatting, and product-status rules belong in `packages/domain/`. It compiles to `dist/` (`pnpm build`; mobile's lint/typecheck/test scripts build it first via `pre*` hooks) and tests with Vitest. Non-Expo TS packages share `@monaco/eslint-config`.

**CI** (`.github/workflows/ci.yml`): `quality` (build packages, lint, typecheck, `test:coverage`), `api-integration` (Testcontainers), `openapi-drift` (fails if `pnpm openapi:generate` / `pnpm --filter web api:generate` change `packages/contracts/openapi.json` or `apps/web/src/lib/api/schema.d.ts`; regenerate and commit both when contracts change) and `build` (`next build` + API `docker build`). The root `devDependencies` pin `react`/`react-dom` 19.1.0 (mobile's) on purpose: with the hoisted linker they keep web's React 19.3 nested under `apps/web`, otherwise web's Testing Library tests render empty trees.

## Naming Convention

All code identifiers (file names, variables, functions, types, constants) must be in English. Git branch names must also be in English. User-facing UI labels remain in Spanish (the app is for a Spanish-speaking user). DB column names in SQL strings (e.g., `'precio_costo'`) stay as-is to avoid migrations; only the JS/TS identifiers are English.

## Architecture

**Routing** — Expo Router v6 (file-based). All screens live under `app/`. Route groups use parentheses: `(tabs)/`. Layouts are `_layout.tsx` files. Typed routes are enabled (`typedRoutes: true`), so use `router.push('/exact-path')` with the generated types.

**Navigation layers**
- `app/_layout.tsx` — root Stack + ThemeProvider (react-navigation DarkTheme/DefaultTheme)
- `app/(tabs)/_layout.tsx` — bottom tab bar with haptic feedback
- `app/configuration.tsx` — settings modal (Stack presentation)

**Component conventions**
- `components/` — shared UI; `components/ui/` for atomic primitives
- Platform-specific variants use file suffixes: `.ios.tsx`, `.web.ts` — Metro picks the right one automatically
- Themed primitives (`ThemedText`, `ThemedView`) wrap React Native core components and pull colors from `useThemeColor`

**Theme system**
- `constants/theme.ts` — `Colors` object with `light`/`dark` palettes
- `hooks/use-theme-color.ts` — selects correct color for current scheme
- `hooks/use-color-scheme.ts` + `use-color-scheme.web.ts` — wraps `useColorScheme()`

**TypeScript**
- Strict mode enabled; path alias `@/*` maps to project root
- React Compiler experiment is on (`reactCompiler: true`) — avoid manual `useMemo`/`useCallback` for performance; the compiler handles it

**State management** — Zustand for cross-screen state (`store/index.ts`). `useCartStore` manages the batch sales cart session. Use React local state for screen-only state.

**Backend/API** — `apps/api` (NestJS 11, hexagonal per module; see `docs/adr/0001-arquitectura-hexagonal-api.md` and copy `src/modules/health/` as the template). Env in `apps/api/.env` (gitignored, from `.env.example`). The API connects as `monaco_app` (RLS applies); migrations run as `monaco_owner` (see `docs/adr/0003-aislamiento-tenants-rls.md`). This app is not used by mobile.

**IAM module (SP2)** — `apps/api/src/modules/iam/` holds identity: pure `domain/` (permissions, `can()`, `assertNoEscalation`, system roles), use cases in `application/`, HTTP and the global `AuthGuard` in `http/`, Drizzle repositories in `infrastructure/` (only usable through `TenantUnitOfWork`). The admin modules (`locations`, `users`, `roles`, `assignments`, `devices`, `audit`) call it from their use cases: the use case is the authority (ADR 0004 auth, ADR 0005 authorization). The web BFF keeps the session in `apps/web/src/lib/session` (`__Host-` cookies, refresh in `proxy.ts`).

**Catalog and inventory modules (SP3)** — `apps/api/src/modules/catalog/` owns products and per-location price overrides (`location_products`); `apps/api/src/modules/inventory/` owns the append-only ledger (`inventory_documents` + `inventory_movements`, ADR 0006). Stock is never stored: it is `SUM(quantity_delta)` per (location, product); `location_products.average_cost` is a projection. Every write (entry, exit, adjustment, transfer, reversal) builds a `DocumentPlan` in `application/inventory.use-cases.ts` (authorize first) and goes through the single script in `application/record-document.ts`: targetless `ON CONFLICT DO NOTHING` header insert (idempotency by the client's id + `payload_hash`), `FOR SHARE` on locations/products, `FOR UPDATE` on the pairs in global order, stock sum, domain rules, insert, project, audit. Sign, stock (integer thousandths) and average-cost math live only in `packages/domain/src/inventory.ts` (`movementDelta`, `assertStockNotNegative`, `averageCostAfterEntry`/`averageCostAfterTransferIn`, `replayAverageCost`); never re-implement them in the API or web. Amounts are integer minor units. `db:seed` adds demo products, P2 price overrides and documents through these same use cases (`src/scripts/demo-inventory-seed.ts`, fixed document ids so a re-run is a replay).

**Adding a movement kind** — (1) add it to `INVENTORY_MOVEMENT_KINDS` in `packages/domain/src/inventory.ts` and give it a sign in `movementDelta` (`POSITIVE_KINDS`/`NEGATIVE_KINDS`, or signed like `adjustment`); add it to `BLENDING_KINDS` only if it changes the average cost, and to `LEGACY_MOVEMENT_KIND` if mobile has an equivalent; extend the domain tests (including the property tests). (2) Add it to `INVENTORY_MOVEMENT_KINDS` in `packages/contracts/src/inventory/inventory.ts` in the same order (`inventory/domain-contracts.test.ts` fails otherwise); a new document kind goes to `INVENTORY_DOCUMENT_KINDS`, a new audit type to `AUDIT_EVENT_TYPES`. (3) Add its sign to `inventory_movements_sign_check` in `apps/api/src/infrastructure/db/schema/inventory.ts` (the kind CHECK is generated from the domain list) and run `pnpm --filter api db:generate`. (4) Produce it from a use case with a `PlannedLine` whose `valuation` says how it is costed (`paid`, `average`, `transferred`, `reversed`); keep `record-document.ts` as the only writer. (5) Add its Spanish label to `MOVEMENT_KIND_LABELS` in `apps/web/src/lib/inventory/format.ts`, then run `pnpm openapi:generate` and `pnpm --filter web api:generate`.

**Adding a permission** — add it to `PERMISSIONS` in `packages/contracts/src/iam/permissions.ts` (and to the `ADMIN_PERMISSIONS` if it is tenant-scope only), generate a migration (`pnpm --filter api db:generate`: the CHECK on `role_permissions` comes from the catalog and a test fails if they diverge), review `SYSTEM_ROLES` in `iam/domain/system-roles.ts`, protect the endpoint with `@RequirePermission('x:y')` and call `can()` in the use case, then run `pnpm openapi:generate` and `pnpm --filter web api:generate` if contracts changed.

**Adding a tenant table** — it needs `tenant_id`, `UNIQUE (id, tenant_id)` when others reference it plus composite FKs to its parents, the policy from `infrastructure/db/schema/tenancy.ts`, and `FORCE ROW LEVEL SECURITY` in a hand-written migration (drizzle-kit does not emit it). UUIDv7 ids are generated in the app (`infrastructure/db/uuidv7.ts`). The RLS guard tests fail if any of it is missing; always query through `withTenant`/`TenantUnitOfWork`.

**E2E** — Playwright specs live in `apps/web/e2e` and run with `pnpm --filter web test:e2e` (own database, real API, production web build; see README). Vitest only includes `src/**`, so e2e is never picked up by unit tests. Demo credentials come from `DEMO_USERS` in `apps/api/src/scripts/demo-seed.ts`; never duplicate them.

**Contracts rule** — request/response schemas live in `packages/contracts` (Zod 4), not inline in the API or the web app. After changing a schema or endpoint, run `pnpm openapi:generate` and `pnpm --filter web api:generate`, then commit `packages/contracts/openapi.json` and `apps/web/src/lib/api/schema.d.ts`. CI's `openapi-drift` job fails if either is stale (see `docs/adr/0002-contratos-zod-openapi.md`).

**Web** — `apps/web` (Next 16 App Router, Tailwind 4, typed API client in `src/lib/api`). Env in `apps/web/.env.local` (gitignored, from `.env.example`); server-only, never `NEXT_PUBLIC_`.

**Before writing code against a framework**, read its current docs, not your memory: Next.js in `node_modules/next/dist/docs/` (Next 16 has breaking changes versus older versions), and the current NestJS, Drizzle, nestjs-zod and Vitest docs (via Context7 or the official sites).

**New Architecture** is enabled (`newArchEnabled: true`). Avoid legacy NativeModules API; use the new Fabric/TurboModules path.
