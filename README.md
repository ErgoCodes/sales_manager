# Sales Manager

An offline-first inventory and sales app built for a real client: the owner of a small grocery store in Cuba.

## The problem

The store sells every product at **two prices**: one for cash and one for bank transfer. At the end of the day the owner needed to know exactly how much came in through each payment method and what the business really earned after costs, losses, staff purchases, salaries and taxes. That was all done on paper.

The constraints shaped the design:

- **Connectivity is unreliable and expensive**, so the app has to work fully offline. There is no backend: data lives in SQLite on the phone.
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

- **Framework**: [Expo SDK 54](https://expo.dev/) with [Expo Router v6](https://docs.expo.dev/router/introduction/) (file-based routing).
- **Language**: [TypeScript](https://www.typescriptlang.org/) in strict mode.
- **Database**: [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/) with [Drizzle ORM](https://orm.drizzle.team/) for typed queries and migrations.
- **Styling**: [uniwind](https://github.com/uniwind/uniwind) (Tailwind CSS v4 for React Native).
- **State**: [Zustand](https://github.com/pmndrs/zustand) for the cart and transient sale-session state.
- **Forms and validation**: [react-hook-form](https://react-hook-form.com/) with [Zod](https://zod.dev/).
- **Keyboard**: [react-native-keyboard-controller](https://kirillzyusko.github.io/react-native-keyboard-controller/) for form-heavy screens.
- **Animations**: [react-native-reanimated](https://docs.swmansion.com/react-native-reanimated/).
- **Dates**: [date-fns](https://date-fns.org/) with Spanish locale.

The UI is in Spanish, for its user.

## Repository layout

A pnpm monorepo:

```
apps/mobile/       # Expo app (screens, components, local SQLite)
  app/             # routes: sales, inventory, catalog, expenses, reports, configuration
  db/              # schema, repositories and tests
  drizzle/         # generated SQL migrations
packages/domain/   # shared business rules (pricing, profit, stock), framework-free
```

Keeping the business rules in `packages/domain`, independent of React Native, means the profit and stock logic is tested without a device and can be reused if the app gets a second platform.

## Design decisions

- **Repository pattern over SQLite** (`apps/mobile/db/`): `products`, `sales`, `movements` (stock in, withdrawals, shrinkage, adjustments), `expenses`, `queries` (aggregated financial reports) and `config`. Screens never write SQL directly.
- **Every write from the UI goes through `safeWrite`** (`lib/safe-write`), so every failed write is caught and reported to the user the same way.
- **Migrations run automatically on startup** with Drizzle's `useMigrations` hook in `app/_layout.tsx`, so updating the app never requires a manual step from the user.
- **Cost price on stock entries is mandatory, with no default**, because a silent default would corrupt every profit report downstream.

## Getting started

Prerequisites: Node.js 18.18+ (20 recommended), pnpm 9+, and Android SDK or Xcode for emulators or devices. Local notifications need a development build on a real device; they don't fully work in Expo Go.

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
