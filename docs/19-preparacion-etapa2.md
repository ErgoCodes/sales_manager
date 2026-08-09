# 19 · Preparación previa a Etapa 2 (plataforma multi-negocio)

**Prioridad: ALTA · Estado: sin trabajo iniciado**

> Este doc formaliza la fase previa a SP1 (ver [12-vision-multiplataforma.md](12-vision-multiplataforma.md) y el [spec de Etapa 2](superpowers/specs/2026-07-11-etapa2-plataforma-multinegocio-design.md)). SP1 exige "los tests de lógica financiera de la Etapa 1 en verde" como prerrequisito y da por hecho que el punto de enganche (`db/*.ts`) ya está aislado de las pantallas — ambas cosas hay que cerrarlas o confirmarlas antes de tocar el esquema. Estas dos tareas son honestamente auditables ahora mismo (no dependen de decisiones de producto pendientes), por eso van antes que SP1 y no dentro de él.

## 1. Cobertura de tests sobre lógica financiera

### Estado actual

27 assertions en total repartidas en 5 archivos (`db/__tests__/*.test.ts`, `lib/__tests__/*.test.ts`). La transacción central de venta, `registerSalesSession` en [db/sales.ts](../db/sales.ts), no tiene test de atomicidad ni de los cálculos que hace dentro de la transacción (total efectivo, vuelto, `sessionId` compartido entre líneas). Los flujos de anulación (`cancelSale`/`updateSale`, y sus equivalentes en `db/movements.ts`) tampoco están cubiertos.

### Problema

SP1 migra las 5 tablas sincronizables a UUIDv7 recreando el esquema — es el cambio más delicado hasta ahora porque toca todas las FKs del código local. Hacerlo sin una suite que verifique stock derivado, costo promedio ponderado y costo congelado al vender significa no poder distinguir una regresión real de un efecto esperado del cambio de PK.

### Plan de mejora

1. Cubrir `registerSalesSession` (`db/sales.ts`): venta simple, venta con `cashPayment` (verificar `saleSessions` y `sessionId` en cada línea), venta que dispara `StockWarning`, atomicidad si una línea falla a mitad de transacción.
2. Cubrir anulación/edición de ventas y de movimientos de almacén: que el stock derivado y el costo promedio se recalculen correctamente tras anular/editar.
3. Cubrir `effectiveUnitCost` y `calculateTransferPrice` (`lib/pricing.ts`) en combinación con datos reales de `calculateAllStocks`, no solo unitarios aislados.
4. Umbral objetivo: toda función en `db/*.ts` que escribe o recalcula debe tener al menos un test de camino feliz y uno de borde (cantidad 0, stock insuficiente, cancelación).

### Criterio de hecho

- `pnpm test` cubre atomicidad y cálculos de `registerSalesSession`.
- Anulación/edición de ventas y movimientos tiene test de recálculo de stock y costo promedio.
- CI (`pnpm test` en el workflow existente) sigue en verde.

---

## 2. Split a monorepo + `db/client.ts` inyectable

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
