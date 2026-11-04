# Sales Manager

An offline-first inventory and sales app built for a real client: the owner of a small grocery store in Cuba.

## The problem

The store sells every product at **two prices**: one for cash and one for bank transfer. At the end of the day the owner needed to know exactly how much came in through each payment method and what the business really earned after costs, losses, staff purchases, salaries and taxes. That was all done on paper.

The constraints shaped the design:

- **Connectivity is unreliable and expensive**, so the app has to work fully offline. The mobile app has no backend: its data lives in SQLite on the phone. The Stage 2 platform (API and web back-office) is described below.
- **One user, entering sales at the end of a busy day**, so data entry has to be fast (batch entry of the day's sales instead of a checkout per customer).
- **Reports get shared over WhatsApp**, because that's how the owner already communicates.
- **Losing the phone can't mean losing the business's history**, so backup and restore are part of the MVP, not an extra.

## What it does

- **Catalog and pricing**: products with unit of measure, cost, cash price and transfer price, plus a suggested price (cost + 30%).
- **Warehouse inventory**: stock entries, real-time stock with low-stock alerts, expiry dates and alerts for products that aren't moving.
- **Sales**: fast end-of-day batch entry, sales to staff at cost price, marketing discounts, and editing or voiding recorded sales.
- **Daily summary**: cash vs. transfer, and real profit using weighted average cost.
- **Losses and expenses**: owner withdrawals, shrinkage, salaries, fines, taxes (ONAT) and clearance markdowns.
- **Reports**: daily, weekly and monthly; best-selling and most profitable products; a breakdown of losses and expenses; export and share via WhatsApp.
- **Backup and restore** of the local database.

## Tech stack

### Mobile (`apps/mobile`)

- **Framework**: [Expo SDK 54](https://expo.dev/) with [Expo Router v6](https://docs.expo.dev/router/introduction/) (file-based routing).
- **Language**: [TypeScript](https://www.typescriptlang.org/) in strict mode.
- **Database**: [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/) with [Drizzle ORM](https://orm.drizzle.team/) for typed queries and migrations.
- **Styling**: [uniwind](https://github.com/uniwind/uniwind) (Tailwind CSS v4 for React Native).
- **State**: [Zustand](https://github.com/pmndrs/zustand) for the cart and transient sale-session state.
- **Forms and validation**: [react-hook-form](https://react-hook-form.com/) with [Zod](https://zod.dev/).
- **Keyboard**: [react-native-keyboard-controller](https://kirillzyusko.github.io/react-native-keyboard-controller/) for form-heavy screens.
- **Animations**: [react-native-reanimated](https://docs.swmansion.com/react-native-reanimated/).
- **Dates**: [date-fns](https://date-fns.org/) with Spanish locale.

### Stage 2 platform

- **API** (`apps/api`): [NestJS 11](https://nestjs.com/) on Express, [Drizzle ORM](https://orm.drizzle.team/) over [PostgreSQL 17](https://www.postgresql.org/), [pino](https://getpino.io/) logging, [helmet](https://helmetjs.github.io/).
- **Contracts** (`packages/contracts`): [Zod 4](https://zod.dev/) schemas, [nestjs-zod](https://github.com/BenLorantfy/nestjs-zod) for validation and OpenAPI, [openapi-typescript](https://openapi-ts.dev/) for the web client types.
- **Web** (`apps/web`): [Next.js 16](https://nextjs.org/) App Router with React 19, [Tailwind CSS v4](https://tailwindcss.com/), [openapi-fetch](https://openapi-ts.dev/openapi-fetch/).
- **Infrastructure**: Docker Compose for local Postgres ([infra/](infra/docker-compose.yml)); [Vitest](https://vitest.dev/) and [Testcontainers](https://testcontainers.com/) for tests; GitHub Actions for CI.

The UI is in Spanish, for its user.

## Stage 2 architecture

Stage 2 turns the app into a multi-business platform: a NestJS API that owns the data, a Next.js back-office, and the mobile app as an offline-first till that will sync with the server (SP5). The business rules stay in `packages/domain`, free of framework code, so any app can reuse them.

```
  apps/mobile (Expo)                    apps/web (Next 16)
  offline SQLite, the till              back-office
        │ uses                                │ HTTP/JSON, typed client
        ▼                                     ▼
  packages/domain                       apps/api (NestJS 11)  ── uses ──▶ packages/contracts (Zod 4)
  pricing, stock, profit rules                 │                          → openapi.json → web client types
                                               │ SQL, RLS (role monaco_app)
                                               ▼
                                         Postgres 17 (infra/)

  packages/eslint-config: shared lint config for the TS packages and apps
```

- **`apps/api`**: NestJS 11 with one hexagonal folder per module (domain, application, infrastructure, http). See [ADR 0001](docs/adr/0001-arquitectura-hexagonal-api.md).
- **`packages/contracts`**: Zod 4 schemas are the source of truth for the HTTP API; `openapi.json` and the web client types are generated from them. See [ADR 0002](docs/adr/0002-contratos-zod-openapi.md).
- **Tenancy**: one shared schema with `tenant_id` and forced row-level security; the API connects as a role without `BYPASSRLS`. See [ADR 0003](docs/adr/0003-aislamiento-tenants-rls.md).
- **`apps/web`**: Next.js 16 back-office, calling the API through the generated client.
- **`apps/mobile`** and **`packages/domain`**: the mobile app keeps working fully offline and does not depend on the API yet.

Plan and status: [docs/20-plan-etapa2.md](docs/20-plan-etapa2.md) (SP1 foundations, then identity, catalog, dashboard and sync). Architecture decisions: [docs/adr/](docs/adr/README.md).

## Local setup

Prerequisites: Node.js 22 (CI uses 24), pnpm 11, and Docker.

```bash
pnpm install                                 # 1. install dependencies
cp apps/api/.env.example apps/api/.env       # 2. API env (development values)
cp apps/web/.env.example apps/web/.env.local # 2. web env (development values)
pnpm db:up                                   # 3. start Postgres 17 in Docker
pnpm db:migrate                              # 4. apply migrations
pnpm dev                                     # 5. API on http://localhost:4000, web on http://localhost:3000
```

Stop the database with `pnpm db:down`. The API health check is `GET http://localhost:4000/health`.

## Repository layout

A pnpm monorepo:

```
apps/api/                NestJS API (Stage 2): hexagonal modules, Drizzle, RLS
apps/web/                Next.js back-office (Stage 2)
apps/mobile/             Expo app (screens, components, local SQLite)
  app/                   routes: sales, inventory, catalog, expenses, reports, configuration
  db/                    schema, repositories and tests
  drizzle/               generated SQL migrations
packages/domain/         shared business rules (pricing, profit, stock), framework-free
packages/contracts/      Zod schemas for the HTTP API, plus generated openapi.json
packages/eslint-config/  shared ESLint config
infra/                   docker-compose.yml (Postgres 17) and postgres/init.sql (app roles)
docs/                    specs, ADRs and the Stage 2 plan
```

Keeping the business rules in `packages/domain`, independent of React Native, means the profit and stock logic is tested without a device and can be reused by any app that needs the same rules.

## Design decisions

- **Repository pattern over SQLite** (`apps/mobile/db/`): `products`, `sales`, `movements` (stock in, withdrawals, shrinkage, adjustments), `expenses`, `queries` (aggregated financial reports) and `config`. Screens never write SQL directly.
- **Every write from the UI goes through `safeWrite`** (`lib/safe-write`), so every failed write is caught and reported to the user the same way.
- **Migrations run automatically on startup** with Drizzle's `useMigrations` hook in `app/_layout.tsx`, so updating the app never requires a manual step from the user.
- **Cost price on stock entries is mandatory, with no default**, because a silent default would corrupt every profit report downstream.

## Mobile app: getting started

Prerequisites: Node.js 18.18+ (20 recommended), pnpm 11, and Android SDK or Xcode for emulators or devices. Local notifications need a development build on a real device; they don't fully work in Expo Go.

```bash
pnpm install       # install dependencies
pnpm start         # start the Expo dev server
pnpm android       # or: pnpm ios
```

Quality checks:

```bash
pnpm lint
pnpm typecheck
pnpm test:coverage
```

After changing `apps/mobile/db/schema.ts`, generate a migration:

```bash
npx drizzle-kit generate
```

## Project docs

- [ROADMAP.md](./ROADMAP.md): the MVP task list and its completion status (in Spanish).
- [docs/](./docs/README.md): technical analyses, tech debt and improvement specs (in Spanish).
- [docs/20-plan-etapa2.md](./docs/20-plan-etapa2.md): the Stage 2 development plan (in Spanish).
- [docs/adr/](./docs/adr/README.md): architecture decision records (in Spanish).
