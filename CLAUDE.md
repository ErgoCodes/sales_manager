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
# Dev (from repository root)
pnpm start
pnpm android
pnpm ios
pnpm web

# Quality
pnpm lint
pnpm typecheck
pnpm test:coverage
# API integration tests (Testcontainers, needs Docker; override image with POSTGRES_IMAGE)
pnpm --filter api test:integration
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

**Backend/API** — `apps/api` (NestJS 11, hexagonal per module; see `docs/adr/0001-arquitectura-hexagonal-api.md` and copy `src/modules/health/` as the template). Env in `apps/api/.env` (gitignored, from `.env.example`). After changing a contract or endpoint run `pnpm openapi:generate` and commit `packages/contracts/openapi.json`. This app is not used by mobile.

**New Architecture** is enabled (`newArchEnabled: true`). Avoid legacy NativeModules API; use the new Fabric/TurboModules path.
