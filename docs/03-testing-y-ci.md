# 03 · Testing y CI

**Prioridad: ALTA · Estado: base completa — hábito continuo**

> **Actualización 2026-08-09:** este doc describía "cero tests, sin CI" cuando en realidad ya no es el caso. La cobertura de la lógica financiera se cerró como parte de la fase previa a Etapa 2 — ver [`docs/19-preparacion-etapa2.md`](19-preparacion-etapa2.md) (sección 1) para el detalle completo del trabajo, cifras de cobertura y decisiones documentadas. Este doc queda como referencia de la infraestructura vigente y del hábito a mantener.

## Estado actual

- **Runner:** `jest` + `jest-expo` (`package.json` → `jest.preset`). Scripts `test` y `test:coverage`; `typecheck` corre `tsc --noEmit`.
- **Capa `db/` contra SQLite real:** `db/__mocks__/client.ts` levanta `better-sqlite3` en `:memory:` y aplica todas las migraciones de `drizzle/*.sql` en orden. Cada suite de `db/__tests__/*.test.ts` hace `jest.mock('../client')` para cargar ese mock; Drizzle expone la misma API sync sobre better-sqlite3, así que `registerSalesSession` (transacción sync) se ejercita igual que en runtime.
- **Fixtures compartidos:** `db/__tests__/helpers.ts` (`resetDb`, `seedProduct`, `seedEntry`, `seedOutflow`, `seedSale`, `seedExpense`) — evita repetir inserts de 12-15 líneas en cada test. Está excluido de `testMatch`/`collectCoverageFrom` vía `jest.testPathIgnorePatterns` en `package.json` porque, al vivir dentro de `__tests__/`, Jest lo trataría como una suite si no se excluye explícitamente.
- **CI:** `.github/workflows/ci.yml` corre `pnpm lint && pnpm typecheck && pnpm test:coverage` en cada push/PR.
- **Husky:** pre-commit `lint && typecheck`; pre-push `test` (sin cobertura, para no penalizar la iteración local — el gate de cobertura vive solo en CI).
- **Umbral de cobertura:** `jest.coverageThreshold.global` en `package.json`, acotado a `db/**/*.ts` + `lib/**/*.ts` (menos `db/client.ts`, `db/schema.ts` — declarativos — y los wrappers de I/O de Expo `lib/backup.ts`, `lib/excel.ts`, `lib/notifications.ts`). Calibrado por debajo de lo medido para que sea un gate real: si una suite se rompe o se comenta, el build falla.

## Qué está cubierto

Organizado por archivo de suite (`db/__tests__/`, `lib/__tests__/`):

| Suite | Cubre |
|---|---|
| `queries.test.ts` | `recalculateAverageCost`, `recalculateAverageCostFromScratch`, `calculateStock`, `calculateAllStocks`, `countLowStock`, `getLastSaleDate(s)` |
| `sales.test.ts` | `registerSalesSession` (atomicidad, sesión de caja, `isCostSale`), `verifySessionStock`, `listSales`, `updateSale`/`cancelSale`/`restoreSale`, `runAverageCostBackfill` |
| `reports.test.ts` | `getDailySummary`, `getDailyBreakdown`, `getRangeSummary`/`getRangeBreakdown`, `getDailyTotalsInRange`, `getRangeRanking`, `getLossesBreakdown` |
| `movements.test.ts` | `registerEntry`/`updateEntry`/`cancelEntry`/`restoreEntry`, `registerOutflow`/`updateOutflow`/`cancelOutflow`/`restoreOutflow`, `getEntryById`/`getOutflowById`, `getEntriesSummaryByProduct`, `listEntries`/`listMovements`, `sumLossOutflowsValue` |
| `expenses.test.ts` | CRUD + cancelar/restaurar + filtros de fecha de gastos |
| `products.test.ts` | `createProduct`, `updateProduct`, `archiveProduct`/`restoreProduct`, `listProducts` (join con stock, búsqueda, filtros) |
| `config.test.ts` | `getConfig`/`setConfig` (upsert)/`getAllConfig` (merge sobre `CONFIG_DEFAULTS`) |
| `lib/pricing.test.ts`, `lib/product-status.test.ts`, `lib/format.test.ts`, `lib/safe-write.test.ts` | lógica pura sin dependencias de DB |

Fuera de alcance (documentado, no un olvido): `lib/backup.ts`, `lib/excel.ts`, `lib/notifications.ts` (wrappers de I/O sobre módulos nativos de Expo — exigen mocks pesados y no son lógica financiera) y tests de UI/componentes/E2E (Maestro/Detox) — coste alto para un solo desarrollador, reconsiderar tras validar Etapa 2.

## Hábito para el futuro

Toda función nueva en `db/queries.ts`, `db/*.ts` o `lib/` que calcule dinero o stock entra con su test — el umbral de cobertura en CI ya lo hace cumplir automáticamente. Los reportes nuevos que se agreguen (agregaciones, rankings) nacen testeados siguiendo el patrón de `reports.test.ts`.

## Qué no reemplaza esto

El smoke-testing manual en dispositivo real sigue siendo necesario: los tests corren contra `better-sqlite3` en Node, no contra `expo-sqlite` en el runtime real. Antes de dar por buena una migración de esquema (como la de SP1), validar también en dispositivo.
