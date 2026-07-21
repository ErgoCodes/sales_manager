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
# Dev
npx expo start           # Metro bundler (opens QR + dev server)
npx expo start --android # Open directly on Android emulator/device
npx expo start --ios     # Open directly on iOS simulator/device
npx expo start --web     # Open in browser

# Quality
npx expo lint            # ESLint (eslint-config-expo flat config)
```

No test runner is configured yet.

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

**Backend/API** — not yet added. No `.env` files present; add them (gitignored) when integrating a backend.

**New Architecture** is enabled (`newArchEnabled: true`). Avoid legacy NativeModules API; use the new Fabric/TurboModules path.
