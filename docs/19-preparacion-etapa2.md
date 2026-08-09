# 19 · Preparación previa a Etapa 2 (plataforma multi-negocio)

**Prioridad: ALTA · Estado: secciones 1 y 2 completas (2026-08-09).**

> Este doc formaliza la fase previa a SP1 (ver [12-vision-multiplataforma.md](12-vision-multiplataforma.md) y el [spec de Etapa 2](superpowers/specs/2026-07-11-etapa2-plataforma-multinegocio-design.md)). SP1 exige "los tests de lógica financiera de la Etapa 1 en verde" como prerrequisito y da por hecho que el punto de enganche (`db/*.ts`) ya está aislado de las pantallas — ambas cosas hay que cerrarlas o confirmarlas antes de tocar el esquema. Estas dos tareas son honestamente auditables ahora mismo (no dependen de decisiones de producto pendientes), por eso van antes que SP1 y no dentro de él.

## 1. Cobertura de tests sobre lógica financiera

**Estado: completa (2026-08-09).** Tracking en Notion: TSK-49.

### Estado antes de este trabajo

27 assertions en total repartidas en 5 archivos (`db/__tests__/*.test.ts`, `lib/__tests__/*.test.ts`). La transacción central de venta, `registerSalesSession` en [db/sales.ts](../db/sales.ts), no tenía test de atomicidad ni de los cálculos que hace dentro de la transacción (total efectivo, vuelto, `sessionId` compartido entre líneas). Los flujos de anulación (`cancelSale`/`updateSale`, y sus equivalentes en `db/movements.ts`) tampoco estaban cubiertos. Cobertura medida de `db/**` + `lib/**`: 31.73% statements · 30.29% branches · 21.25% funcs · 32.14% lines. El módulo de reportes de `db/queries.ts` (`getDailySummary`, `getRangeSummary`, `getRangeRanking`, `getLossesBreakdown`, `getDailyTotalsInRange`) no se ejercitaba en absoluto (11% de cobertura).

### Problema

SP1 migra las 5 tablas sincronizables a UUIDv7 recreando el esquema — es el cambio más delicado hasta ahora porque toca todas las FKs del código local. Hacerlo sin una suite que verifique stock derivado, costo promedio ponderado y costo congelado al vender significa no poder distinguir una regresión real de un efecto esperado del cambio de PK.

### Trabajo realizado

- Fixtures compartidos en `db/__tests__/helpers.ts` (`resetDb`, `seedProduct`, `seedEntry`, `seedOutflow`, `seedSale`, `seedExpense`) para eliminar la duplicación de setup entre suites.
- Suites reorganizadas por módulo: `queries.test.ts` (stock/costo promedio), `sales.test.ts`, `reports.test.ts`, `movements.test.ts`, `expenses.test.ts`, `products.test.ts`, `config.test.ts`, más `lib/__tests__/format.test.ts` y `safe-write.test.ts`.
- **`registerSalesSession`**: test de atomicidad (una línea con `productId` inexistente revierte el ticket completo — ninguna fila queda en `sales` ni `saleSessions`), sesión de caja (`cashTotal` solo de líneas `efectivo`, `change` correcto), `isCostSale` con `profit = 0`, y verificación de que `costAtSale` se congela desde el catálogo en el momento de la venta.
- `recalculateAverageCostFromScratch`: fallback a `costPrice` sin entradas activas, exclusión de entradas anuladas, caso borde `totalQty = 0`.
- Ciclos completos de anular/restaurar en ventas, entradas y salidas de almacén, verificando el efecto en stock, costo promedio y `getDailySummary`.
- Todo el módulo de reportes de `db/queries.ts`.
- Se eliminaron dos imports muertos de `effectiveUnitCost` (`db/sales.ts`, `app/sales/new-session.tsx`) encontrados al mapear qué función de costo usa cada flujo.

### Estado final

92 tests / 11 suites en verde. Cobertura de `db/**` + `lib/**` (excluyendo `db/client.ts`, `db/schema.ts` — declarativos — y los wrappers de I/O de Expo `lib/backup.ts`, `lib/excel.ts`, `lib/notifications.ts`, fuera de alcance por requerir mocks pesados sin ser lógica financiera):

| Métrica | Antes | Después | Umbral de CI |
|---|---|---|---|
| Statements | 31.73% | 95.96% | 93% |
| Branches | 30.29% | 73.75% | 71% |
| Functions | 21.25% | 100% | 95% |
| Lines | 32.14% | 97.93% | 95% |

El umbral en `package.json` (`jest.coverageThreshold`) está calibrado por debajo de lo medido para que sea un gate real, no decorativo: comentar cualquiera de las suites nuevas lo hace fallar. `pnpm test:coverage` corre en CI (`.github/workflows/ci.yml`); el pre-push de husky sigue en `pnpm test` (sin cobertura) para no penalizar la iteración local.

### Decisión documentada: dos bases de costo distintas

Las ventas valoran la utilidad al `costPrice` del catálogo (`db/sales.ts` en `registerSalesSession`/`updateSale`, y `app/sales/new-session.tsx` en el checkout), mientras que las salidas de almacén (mermas, retiros) y el propio recálculo de costo promedio (`recalculateAverageCost`) usan `effectiveUnitCost` (averageCost si es > 0, si no costPrice). Es un comportamiento **deliberado y ya cubierto por test** (`db/__tests__/sales.test.ts`: *"calculates profit using the catalog costPrice, not the costAtSale carried in the cart item"*) — se documenta aquí para que la migración de SP1 no lo "corrija" por accidente asumiendo que es un bug.

### Criterio de hecho

- [x] `pnpm test` cubre atomicidad y cálculos de `registerSalesSession`.
- [x] Anulación/edición de ventas y movimientos tiene test de recálculo de stock y costo promedio.
- [x] CI (`pnpm test:coverage` en el workflow existente) sigue en verde, con umbral de cobertura que falla el build si se degrada.

---

## 2. Split a monorepo + `db/client.ts` inyectable

**Estado: completa (2026-08-09).** La aplicación se trasladó a `apps/mobile` y las reglas de dominio puras viven en `packages/domain`. La conexión SQLite se inicializa explícitamente con `initDb()` y los repositorios resuelven la instancia activa mediante `getDb()`, lo que permite inyectar una instancia de prueba. La cobertura y CI corren recursivamente desde la raíz con pnpm.

### Estado actual

`pnpm-workspace.yaml` solo define `nodeLinker`/`allowBuilds`, sin clave `packages:` — no es un monorepo todavía aunque ya usa pnpm workspaces parcialmente. [db/client.ts](../db/client.ts) es un singleton de 5 líneas: `openDatabaseSync('db.sqlite')` con nombre fijo al importar el módulo, sin scope ni inyección — de ahí que testing dependa de `db/__mocks__/client.ts` en vez de una instancia real parametrizable.

### Problema

SP2 introduce `apps/api` (NestJS + Drizzle + Postgres) que necesita compartir esquema y lógica de dominio (`lib/pricing.ts`, derivación de stock, costo promedio) con el cliente Expo. Sin la estructura de monorepo, ese código se duplicaría entre cliente y servidor con el riesgo de que diverjan las fórmulas. Por separado, `db/client.ts` como singleton de nombre fijo bloquea que un mismo dispositivo abra la base de datos de más de un punto de venta (relevante para el rol `admin` de SP2, que gestiona varios puntos).

### Plan de mejora

1. Mover la raíz actual a `apps/mobile/` sin cambios de comportamiento (mismo `@/*` alias, mismo `tsconfig.json` extendido).
2. Declarar `packages:` en `pnpm-workspace.yaml` con `apps/*` y `packages/*`.
3. Extraer a `packages/domain/` (TS puro, sin dependencias de Expo/React Native): `lib/pricing.ts`, la derivación de stock (`calculateStock`/`calculateAllStocks` de `db/queries.ts`), costo promedio ponderado, `lib/product-status.ts`.
4. Convertir `db/client.ts` en una factory (`createDbClient(dbName: string)`) en vez de un singleton a nivel de módulo; actualizar los ~15 archivos que importan `db` desde `./client` para recibir la instancia en vez de importarla como valor global.
5. Verificar que `pnpm lint`, `pnpm typecheck`, `pnpm test` y `expo start` siguen funcionando desde `apps/mobile/` sin cambios de comportamiento visible.

### Criterio de hecho

- `apps/mobile` arranca igual que hoy (`npx expo start`), sin cambios visibles en ninguna pantalla.
- `packages/domain` no importa nada de `expo-sqlite`/`react-native`; tiene sus propios tests portados de `lib/__tests__`.
- `db/client.ts` ya no abre la base de datos como efecto secundario del import; la instancia se crea explícitamente y se puede parametrizar por nombre.
- CI sigue en verde tras el movimiento de carpetas.
