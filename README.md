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

- **Framework**: [Expo SDK 58](https://expo.dev/) with [Expo Router](https://docs.expo.dev/router/introduction/) (file-based routing).
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
pnpm --filter api keys:generate              # 2b. dev JWT key + IP secret: paste into apps/api/.env
pnpm db:up                                   # 3. start Postgres 17 in Docker
pnpm db:migrate                              # 4. apply migrations
pnpm --filter api db:seed                    # 4b. optional: demo tenant with 3 development users
pnpm dev                                     # 5. API on http://localhost:4000, web on http://localhost:3000
```

Stop the database with `pnpm db:down`. The API health check is `GET http://localhost:4000/health`.

### Tenants and demo data

Both commands connect as the schema owner (`DATABASE_MIGRATION_URL`), like `db:migrate`.

```bash
pnpm --filter api tenant:create --name "Acme" --slug acme --owner-email boss@acme.example
pnpm --filter api db:seed
```

`tenant:create` creates the tenant, its system roles and an owner with a temporary password (72 h, must be changed at first login). The password is printed once; save it, it cannot be recovered. Reports group sales by day in the tenant's time zone: pass `--time-zone <IANA zone>` (for example `--time-zone America/Havana`, the default when omitted); it is validated when written and cannot be changed by the API.

`db:seed` is idempotent and only runs with `NODE_ENV` unset, `development` or `test`; any other value (including `production`) is refused. It creates the `demo` tenant with two locations (`P1`, `P2`) and three **development-only** users:

| User | Role | Scope | Password |
| --- | --- | --- | --- |
| `owner@demo.example` | owner | whole tenant | `demo-owner-pass` |
| `manager@demo.example` | manager | location P1 | `demo-manager-pass` |
| `cashier@demo.example` | cashier | location P1 | `demo-cashier-pass` |

To try the back-office, run `pnpm dev`, open http://localhost:3000/login and sign in with any of these users. The owner can manage locations, users, roles and assignments; the cashier sees none of the admin actions.

The seed also stocks a demo catalog (40 products in CUP across the catalog categories, with price overrides in P2) and a history of the last 14 days, today included and in full: weekly entries, shrinkage, owner withdrawals, a transfer from P1 to P2 every two weeks and 25–60 sales a day per location (1–4 lines each, weekly seasonality). Days are local to the tenant's time zone; reports cut at the current time, so "today" fills up during the day. A few products are left stagnant, low on stock or near their expiration date. Everything is written as the demo owner through the same use cases as the API (`RecordSale` for sales; stock and average cost from `@monaco/domain`, audit events included) with a fixed-seed generator and deterministic UUIDv7 ids, all in one transaction. Running it again changes nothing: once the tenant has sales the history is left alone. Pass `--history-days <1..366>` for a longer one:

```bash
pnpm --filter api db:seed --history-days 30
```

To walk through the inventory flow:

1. Sign in as the **manager** and open **Inventario**: the stock of P1 (the only location the manager has), with the average cost.
2. **Registrar entrada**: pick a product, a quantity and a unit cost; after saving, the stock row shows the new quantity. A double click on "Guardar" still records one document (the form carries its id).
3. **Registrar salida** with more than the stock: the form shows "No hay stock suficiente" and how much is missing; nothing is recorded.
4. **Movimientos** lists the ledger of the location; each document opens its detail.
5. Sign in as the **cashier**: the same stock page for P1 only, without average costs or write actions.
6. Sign in as the **owner** to see both locations and the catalog (`/catalogo`), including the P2 price overrides.

To see the dashboard, sign in as the **owner**: with `reports:view` the login lands on **Tablero** (`/tablero`), with sales, profit and margin per currency, the daily series, the product ranking, the comparison by location and the inventory health. The filters live in the URL (`?punto`, `?periodo=7d|30d`, `?desde` + `?hasta`, `?moneda`, `?orden`), so a link reproduces the view; the presets stay within 30 days (the reports latency budget, ADR 0007). The **manager** sees only P1; the **cashier** (`reports:view_own` only) has no "Tablero". Each view makes at most five report calls and never polls (the API throttles `/reports/*` to 30 requests per minute per IP and endpoint).

### Public demo reset

`demo:reset` regenerates the public demo (ADR 0008): it connects as the schema owner (`DATABASE_MIGRATION_URL`) and, in **one** transaction, empties every tenant table (sessions included), recreates the `demo` tenant with `read_only = true` and seeds 90 days of history the same way as `db:seed` (about 7 000 sales, under a minute locally). It refuses unless `DEMO_RESET_CONFIRM=demo` is set and every tenant in the database is read-only, so it never wipes a real tenant or a `db:seed` database. Run it only against the dedicated demo database:

```bash
DEMO_RESET_CONFIRM=demo pnpm --filter api demo:reset
```

The API refuses writes to a read-only tenant in its `AuthGuard` (`403 DEMO_READ_ONLY`); the reset calls the use cases directly, outside HTTP, so that guard is not in its path. Requests that arrive during a reset (about a minute) wait on its locks and, with the API's 5 s statement timeout, fail with an error: they never see a half-reset state. The reset also refuses to run if the database holds any tenant other than the read-only demo tenant.

On the web, `DEMO_MODE=true` (server-side env of `apps/web`) shows the accounts of `DEMO_ACCOUNTS` on `/login` as buttons that fill the form (no automatic login, nothing in the URL); see `apps/web/.env.example` for the format. Any action the API refuses with `DEMO_READ_ONLY` shows "Demo de solo lectura".

### End-to-end tests

`pnpm --filter web test:e2e` runs the Playwright suite against the real API and a production build of the web app, on its own database (`monaco_e2e`, recreated on every run; your `monaco` database is never touched). It needs a Postgres superuser URL in `E2E_PG_ADMIN_URL` (default `postgres://postgres:postgres@127.0.0.1:55432/postgres`) and Chromium (`pnpm --filter web exec playwright install chromium`). See [docs/21](docs/21-estado-sp2-y-continuacion-local.md) for the details.

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

Prerequisites: Node.js 22.13+ or 24.3+ (Expo SDK 58), pnpm 11, and Android SDK or Xcode for emulators or devices. Local notifications need a development build on a real device; they don't fully work in Expo Go.

```bash
pnpm install       # install dependencies
pnpm start         # start the Expo dev server
pnpm android       # or: pnpm ios
```

To open it in Expo Go on a phone on the same Wi-Fi, use the store Expo Go (it only runs SDK 58) and start Metro with `EXPO_OFFLINE=1 pnpm exec expo start --go --lan` from `apps/mobile`. `--go` serves Expo Go instead of the dev client; `EXPO_OFFLINE=1` skips the Expo account login that otherwise hangs the phone when the CLI runs without a terminal. Set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env.local` to the computer's LAN address (for example `http://192.168.0.9:4000`).

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
