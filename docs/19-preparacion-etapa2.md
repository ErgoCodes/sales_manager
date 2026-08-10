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

### Estado antes de este trabajo

`pnpm-workspace.yaml` solo definía `nodeLinker`/`allowBuilds`, sin clave `packages:` — no era un monorepo todavía aunque ya usaba pnpm workspaces parcialmente. `db/client.ts` era un singleton de 5 líneas: `openDatabaseSync('db.sqlite')` con nombre fijo al importar el módulo, sin scope ni inyección — de ahí que testing dependiera de `db/__mocks__/client.ts` en vez de una instancia real parametrizable.

### Problema

SP2 introduce `apps/api` (NestJS + Drizzle + Postgres) que necesita compartir esquema y lógica de dominio (`lib/pricing.ts`, derivación de stock, costo promedio) con el cliente Expo. Sin la estructura de monorepo, ese código se duplicaría entre cliente y servidor con el riesgo de que diverjan las fórmulas. Por separado, `db/client.ts` como singleton de nombre fijo bloqueaba que un mismo dispositivo abra la base de datos de más de un punto de venta (relevante para el rol `admin` de SP2, que gestiona varios puntos).

### Trabajo realizado

Cinco commits secuenciales, cada uno verde por separado (`pnpm -r typecheck && pnpm -r lint && pnpm -r test:coverage`):

1. `chore(monorepo): move app root to apps/mobile` — movimiento puro con `git mv` (historial preservado), sin editar contenido salvo los `package.json`. `pnpm-workspace.yaml` gana `packages: ['apps/*', 'packages/*']`, conservando `nodeLinker: hoisted`.
2. `feat(domain): extract pure business rules` — `packages/domain` (`@monaco/domain`) con `pricing.ts`, `product-status.ts`, `format.ts`, `catalog.ts`, `stock.ts` (`stockDelta`/`deriveStock`) y `average-cost.ts` (`blendAverageCost`/`weightedAverageCost`), extraídos de `lib/*` y `db/queries.ts`. `db/queries.ts` conserva el SQL agregado pero delega la regla de signo y el costo promedio en el paquete compartido. **Desviación del plan:** el registry de npm tuvo una salida de red intermitente durante la implementación; `packages/domain` usa el runner `jest-expo` ya disponible localmente en vez de `ts-jest` (que no se pudo instalar). No afecta la pureza del paquete (cero imports de Expo/React Native/Drizzle en `src/`, verificado).
3. `refactor(db): replace client singleton with explicit factory` — `db/client.ts` expone `createDbClient`/`initDb`/`setDb`/`getDb`/`getExpoDb`; los 6 repos y `lib/backup.ts` consumen `getDb()`/`getExpoDb()` en vez de importar `db` como valor global; `app/_layout.tsx` llama `initDb()` a nivel de módulo. Tests migrados a `setDb()` sobre una instancia in-memory real; se eliminó `db/__mocks__/client.ts` y los `jest.mock('../client')`.
4. `refactor: relocate constants out of drizzle` — `drizzle/constants/{theme,expenses}.ts` → `constants/`; `catalog.ts` se elimina (vive en `@monaco/domain`); ~50 imports reescritos.
5. `chore(ci): adapt tooling, thresholds and docs` — umbrales de cobertura recalibrados por paquete, scripts raíz recursando con `pnpm -r`, esta sección y `CLAUDE.md`/`README.md` actualizados.

### Estado final

13 suites / 96 tests en verde (`packages/domain`: 5 suites / 19 tests; `apps/mobile`: 8 suites / 77 tests — el conteo sube desde las 92 pruebas de la sección 1 porque tres suites de `lib/` se movieron a `packages/domain` sin perder cobertura). `grep -rnE "\b(expo|react-native|drizzle)\b" packages/domain/src` no devuelve nada. `npx expo export --platform android` bundlea sin errores de resolución. `pnpm lint` sin errores (solo warnings preexistentes).

### Criterio de hecho

- [x] `apps/mobile` arranca igual que antes (`npx expo start`), sin cambios visibles en ninguna pantalla.
- [x] `packages/domain` no importa nada de `expo-sqlite`/`react-native`; tiene sus propios tests portados de `lib/__tests__`.
- [x] `db/client.ts` ya no abre la base de datos como efecto secundario del import; la instancia se crea explícitamente y se puede parametrizar por nombre.
- [x] CI sigue en verde tras el movimiento de carpetas.

### Pendiente (fuera de alcance, señalado en el plan)

`restoreBackup` (`apps/mobile/lib/backup.ts`) sigue sin reabrir la base tras `closeSync()` — la app requiere reinicio manual después de restaurar un respaldo. `initDb()` ya está disponible para resolverlo en una línea; queda como tarea aparte, no escondida en este movimiento.
