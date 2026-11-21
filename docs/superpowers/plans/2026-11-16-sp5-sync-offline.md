# SP5 · Sync offline de mobile: plan de implementación

> **Para agentes:** el diseño completo, las decisiones abiertas con su default y las reglas de seguridad están en el [spec de SP5](../specs/2026-11-16-sp5-sync-offline-design.md). **Ese spec manda**: este plan solo ordena el trabajo y define el "Hecho cuando" de cada tarea. El protocolo y la política de conflictos están en el [ADR 0009](../../adr/0009-protocolo-sync-mobile.md); la migración de ids, en el [ADR 0010](../../adr/0010-migracion-ids-mobile-uuidv7.md); el libro y las ventas, en los ADR 0006 y 0007. Antes de escribir código hay que consultar la doc vigente de Expo 54 (`https://docs.expo.dev/versions/v54.0.0/`: `expo-sqlite`, `expo-secure-store`, `expo-background-task`, `expo-crypto`, NetInfo), NestJS, Drizzle, `nestjs-zod`, Vitest y `fast-check`. Cada tarea va en un PR contra `main` con CI en verde. **Ninguna regla de precio, stock, costo o fecha de negocio se escribe en `apps/api`, `apps/web`, `apps/mobile` ni `packages/sync`: va a `packages/domain`.**

**Antes de T1:**

- SP3 y SP4 tienen que estar en `main` para toda tarea que no sea spike (T1–T3 pueden correr antes porque no se mergean; T3 necesita el código de SP3/SP4 en una rama local). Regla de docs/20: hasta que SP4 esté mergeado, `apps/mobile/db/` no se toca.
- Confirmar o cambiar los defaults de "Decisiones abiertas" del spec (D1–D10). Las **[Dueño]** (D1, D2, D3, D6, D7) las decide el dueño. Si alguna cambia, se actualizan el spec, el ADR 0009 y las tareas afectadas antes de empezar.
- Hacer el smoke test en dispositivo real pendiente (TSK-5 de docs/20) con la versión actual de la app: es la línea base de T1.

**Gate de salida:** el del spec de SP5 (sección "Gate de salida").

**Tareas críticas de seguridad o datos** (revisión más estricta, tests de integración obligatorios): **T1**, **T3**, **T5**, **T6a**, **T7a**, **T7b**, **T8**, **T9**, **T10**, **T11**, **T12** y **T14b** (restauración de respaldos en una caja vinculada).

**Orden y paralelismo**

```
Spikes (antes de todo)
T1 (ids mobile) ───────┐
T2 (runtime Expo) ─────┼───────────────────────────────────────────────┐
T3 (shortfall + corr.) ┼──────────────┐                                │
                       │              │                                │
T4 (domain) ──┬─> T6a (motor) ─> T6b (simulación)                      │
T5 (contracts)┤        │                                               │
              │        └──────────────┐                                │
T7a (tx mobile) ─> T7b (UUIDv7) ─> T8 (op-log mobile) ─┬─> T13a (runtime sync) ─┬─> T14a (UI sync) ──┐
              │                                        └─> T13b (caja vinculada)┤                    │
              ├─> T9 (lease) ───────┐                                           └─> T14b (onboarding)┼─> T16 (integración + docs)
              └─> T10 (casos de uso)┴─> T11 (sync API) ─┬─> T15 (web) ─────────────────────────────┤
                         └─────────────> T12 (onboarding API) ──────────────────────────────────────┘
```

- **T1 ∥ T2 ∥ T3:** spikes sin PR de código (solo notas en el ADR correspondiente y ajustes al spec). T1 trabaja sobre una copia de `apps/mobile` fuera del árbol; T2 en un proyecto Expo de prueba; T3 en una rama local con SP3/SP4.
- **T4 ∥ T5 ∥ T7a:** `packages/domain` frente a `packages/contracts` (+ `packages/contracts/openapi.json`, `apps/web/src/lib/api/schema.d.ts`, `apps/mobile/lib/api/schema.d.ts`) frente a `apps/mobile/db/` (solo transacciones). Solo T5 regenera los clientes generados hasta T11.
- **T6a ∥ T7b ∥ T9 ∥ T10:** `packages/sync/` frente a `apps/mobile/{db,drizzle,store,app,components}` frente a `apps/api/src/modules/iam/` (lease y throttler, sin migración) frente a `apps/api/src/modules/{sales,inventory}/` + `apps/api/drizzle/`. **T10 es la única tarea que crea migraciones de la API** (incluye las columnas de `devices` que usa T11).
- **T11 ∥ T12:** `apps/api/src/modules/sync/` frente a `apps/api/src/modules/onboarding/`. Comparten el registro en `app.module.ts` (una línea cada una) y los generados: los contratos ya están en T5, así que ninguna regenera `openapi.json` salvo que cambie un esquema (en ese caso, la que mergea segunda).
- **T13a ∥ T13b:** `apps/mobile/lib/sync/` + registro del *background task* en `app/_layout.tsx` frente a `apps/mobile/db/` (stock combinado, `occurred_at`), `app/catalog/`, `app/sales/`, `components/ui/date-picker.tsx` no se toca (solo se pasa `maxDate`). No comparten archivos.
- **T14a ∥ T14b:** `app/(tabs)/_layout.tsx` + `app/account/sync.tsx` + `lib/notifications.ts` frente a `app/account/link.tsx` + `lib/backup.ts` + `app/configuration.tsx`.
- **T15** toca solo `apps/web/`.
- **Recorte si el calendario aprieta** (spec, "Recortes"): T12 y T14b primero (onboarding manual), luego el segundo plano de T13a, luego las operaciones de inventario de T8/T13b, luego `sale.correct`, luego la adopción de T14a, luego T15.

---

### T1 · Spike: migración de ids de mobile sobre datos reales `M` · `Difícil` · **crítica de datos** (sin dependencias)

- [ ] Con una copia de `db.sqlite` de producción (Mercado Mónaco, con permiso del dueño) y otra sembrada con 50.000 ventas, escribir el borrador de `0004_uuid_ids.sql` (spec, "Migración de ids").
- [ ] Verificar en expo-sqlite 16 (Android y iOS): versión de SQLite, `randomblob`/`printf` para generar UUIDv7, que `useMigrations` envuelve cada migración en una transacción, estado de `PRAGMA foreign_keys`, `journal_mode` y `synchronous`.
- [ ] Medir el tiempo de la migración en un teléfono de gama baja y el tamaño de `db.pre-uuid.sqlite`.
- [ ] Probar la restauración de un respaldo con esquema `0003` sobre la app migrada.
- [ ] Verificar que `crypto.getRandomValues` funciona en Hermes con el polyfill que indique la doc de Expo 54.

**Hecho cuando:** el ADR 0010 registra los resultados medidos (tiempo, tamaño, PRAGMAs, versión de SQLite) y confirma o corrige la estrategia SQL pura; las sumas de ventas, stock y costo promedio son idénticas antes y después sobre las dos copias; y no se mergea código.

### T2 · Spike: runtime de Expo para sync `S` · `Media` (en paralelo con T1 y T3)

- [ ] `expo-background-task`: frecuencia real en Android e iOS, comportamiento con la app cerrada y con el teléfono bloqueado.
- [ ] `expo-secure-store` con `WHEN_UNLOCKED_THIS_DEVICE_ONLY` dentro de la tarea en segundo plano (D4).
- [ ] NetInfo: eventos al recuperar red en modo avión.
- [ ] Anotar las dependencias exactas y su configuración en `app.json`.

**Hecho cuando:** el spec (sección "Auth offline") y la D4 quedan actualizados con lo medido, con la recomendación confirmada o cambiada; y no se mergea código.

### T3 · Spike: venta con stock negativo y corrección atómica bajo locks `S` · `Difícil` · **crítica de datos** (requiere SP3 y SP4 en una rama local)

- [ ] Prototipo de `RecordSale` con `shortfallPolicy: 'flag'` y de `CorrectSale` (reversión + documento nuevo en una transacción) sobre el guion de locks del ADR 0006.
- [ ] Test de integración (Testcontainers) con dos ventas concurrentes de la última unidad y una corrección concurrente con una entrada del mismo par: sin deadlocks, orden global de locks respetado, stock neto correcto.

**Hecho cuando:** el prototipo demuestra que la corrección evaluada sobre el neto no deja estados intermedios visibles y que el orden de locks no cambia; las conclusiones quedan en el ADR 0009; y el prototipo se descarta (T10 lo reescribe con tests).

### T4 · Reglas de sync en `@monaco/domain` `S` · `Media` (en paralelo con T5 y T7a)

- [ ] `occurredAtFromBusinessDate(date, timeZone, now)`: hoy → `now`; otro día → 12:00 en la zona; tests con `America/Havana` en los dos cambios de hora.
- [ ] `projectStock(serverStock, asOf, operations)`: stock combinado del spec (pendientes, rechazadas y aplicadas después de `asOf`).
- [ ] `toMinorUnits`/`fromMinorUnits` y el mapeo `efectivo`/`transferencia` → `cash`/`transfer`, si SP3/SP4 no los dejaron (verificar antes; no duplicar).
- [ ] Tests unitarios de todo lo anterior.

**Hecho cuando:** los umbrales de cobertura de `packages/domain` se mantienen y la suite de mobile pasa sin cambios.

### T5 · Contratos de sync y subpath de ids `M` · `Difícil` · **crítica de seguridad** (en paralelo con T4 y T7a)

- [ ] `packages/contracts/src/sync/`: `SyncOperation` (unión discriminada por `type` y `schemaVersion`: `sale.record`, `sale.void`, `sale.correct`, `inventory.entry`, `inventory.exit`, `inventory.adjustment`, `inventory.reverse`, `inventory.correct`), `SyncPushRequest` (≤ 100 ops), `SyncPushResult`, `SyncPullResponse`, `PermissionLeaseClaims`, `OnboardingRequest`/`OnboardingResult`, todos con `.meta({ id })`.
- [ ] Códigos de error `DEPENDENCY_REJECTED` y `LEASE_INVALID` en `ErrorResponse`; flags `stock_shortfall`, `clock_adjusted`, `authorized_by_lease`, `adopted`.
- [ ] Subpath `@monaco/contracts/ids` con el generador UUIDv7 sin importar Zod (D9) y un test que lo verifica.
- [ ] `pnpm openapi:generate`, `pnpm --filter web api:generate` y el `api:generate` de mobile.

**Hecho cuando:** los esquemas rechazan lotes de más de 100 operaciones, ids que no son UUIDv7, cantidades con más de 3 decimales y montos negativos (tests); importar `@monaco/contracts/ids` no carga `zod`; y `openapi-drift` está en verde.

### T6a · Motor de sync: op-log, orden, coalescencia y reintentos `L` · `Difícil` · **crítica de datos** (después de T4 y T5)

- [ ] Paquete `packages/sync` (`@monaco/sync`, compila a `dist/`, Vitest, `@monaco/eslint-config`), con puertos `OperationStore`, `SnapshotStore`, `Transport` y `Clock`.
- [ ] Máquina de estados de una operación (`pending` → `in_flight` → `applied`/`rejected`/`superseded`), `in_flight` → `pending` al arrancar.
- [ ] Armado de lotes por `seq` (≤ 100 ops, ≤ 256 KB), `depends_on`, `not_before`, coalescencia solo sobre `pending`.
- [ ] Interpretación de resultados (`applied`, `duplicate`, `rejected`, `not_processed`), backoff con *jitter* y `Retry-After`.
- [ ] Tests de propiedades con `fast-check` (spec, "Tests"): ningún doble aplicado, dependencias respetadas, coalescencia nunca toca lo enviado, cola nunca vacía por errores.

**Hecho cuando:** las propiedades del spec pasan con 1.000 corridas por propiedad y semilla fija en CI; cobertura de `packages/sync` ≥ 90 % de líneas; y el paquete no importa nada de React Native ni de Expo.

### T6b · Pull, stock combinado y simulación de dos dispositivos `M` · `Difícil` (después de T6a)

- [ ] Aplicación de la instantánea del pull (`ETag`, reemplazo atómico de `server_*`, `reversedDocuments`).
- [ ] Servidor falso en memoria con las reglas del spec (shortfall, archivados, *lease*, idempotencia, reversión única).
- [ ] Planificador determinista con semilla: red caída, respuestas perdidas, reinicios, relojes desfasados.
- [ ] Los casos fijos de "Conflictos" del spec y "ninguna venta perdida".

**Hecho cuando:** la simulación corre 500 escenarios aleatorios por CI sin violar los invariantes (cada venta registrada en un dispositivo aparece exactamente una vez en el servidor; el stock del servidor es la suma de sus movimientos) y cada caso fijo tiene su test con nombre.

### T7a · Escrituras atómicas en mobile `M` · `Media` · **crítica de datos** (después del merge de SP4)

- [ ] Envolver en transacciones síncronas de Drizzle (como `registerSalesSession`) `registerEntry`, `updateEntry`, `cancelEntry`, `restoreEntry`, `registerOutflow`, `updateOutflow`, `cancelOutflow`, `restoreOutflow`, `cancelSale`, `restoreSale` y `updateSale`.
- [ ] Un test por función que fuerza una falla después del primer `INSERT`/`UPDATE` y comprueba que no queda nada escrito.

**Hecho cuando:** `pnpm test:coverage` de mobile pasa con los 96 tests originales sin cambiar aserciones financieras, más los nuevos, y los umbrales no bajan.

### T7b · Migración de ids de mobile a UUIDv7 `L` · `Difícil` · **crítica de datos** (después de T1, T5 y T7a)

- [ ] `drizzle/0004_uuid_ids.sql` según el spec y el resultado de T1: tablas `_new`, `legacy_id`, FKs reescritas, índices, `ventas.ticket_id`, `occurred_at`, `foreign_key_check` y conteos con `RAISE(ABORT)`.
- [ ] `db/schema.ts` con ids `text` y `$defaultFn` del generador de `@monaco/contracts/ids`; tipos `string` en `db/*.ts`, `store/index.ts` y pantallas.
- [ ] `registerSalesSession` asigna un `ticket_id` a todas las líneas de la venta.
- [ ] Copia previa `db.pre-uuid.sqlite` antes de `useMigrations` y opción "Restaurar copia previa a la actualización" (30 días).
- [ ] Tests: ids válidos, FKs, equivalencia de reportes antes/después, restauración de un respaldo `0003`.

**Hecho cuando:** la suite completa pasa sin cambiar aserciones financieras (solo tipos de id en `helpers.ts`) con los umbrales de cobertura; la app arranca y migra en un dispositivo real con la copia de producción de T1; y el ADR 0010 pasa a "Aceptada".

### T8 · Op-log en mobile `L` · `Difícil` · **crítica de datos** (después de T6a y T7b)

- [ ] Migración `0005_sync.sql`: `sync_operations`, `sync_state`, `sync_aggregate_versions`, `server_products`, `server_location_prices`, `server_stock`.
- [ ] Adaptador `OperationStore`/`SnapshotStore` de `@monaco/sync` sobre expo-sqlite (y el de `better-sqlite3` para los tests de mobile).
- [ ] Cada escritura de `db/` emite su operación en la misma transacción **solo si existe `sync_state`** (spec, tabla "Qué es una operación"), con `occurred_at` de `occurredAtFromBusinessDate`.
- [ ] Tests: sin vincular, ninguna operación y comportamiento idéntico; vinculada, una operación por acción con el `payload` esperado; rollback conjunto.

**Hecho cuando:** la suite financiera pasa sin cambios en modo no vinculado; los tests nuevos cubren cada fila de la tabla "Qué es una operación"; y una falla forzada después de escribir la venta no deja ni la venta ni la operación.

### T9 · Lease de permisos y throttler por dispositivo `M` · `Difícil` · **crítica de seguridad** (después de T5; en paralelo con T6a, T7b y T10)

- [ ] `IssuePermissionLease` y `VerifyPermissionLease` en `modules/iam/` (EdDSA con la clave de la API, `typ: perm-lease+jwt`, `aud: monaco-mobile-lease`, TTL de D3).
- [ ] El guard de auth rechaza un *lease* usado como bearer.
- [ ] Throttler `device` (clave = `did`) con el storage de Postgres de ADR 0004.
- [ ] Tests unitarios y de integración: firma, `aud`, tenant/usuario/dispositivo cruzados, vencido, gracia.

**Hecho cuando:** un *lease* de otro tenant, usuario o dispositivo, vencido más allá de la gracia o con firma alterada se rechaza en tests de integración; usarlo como bearer da 401; y el ADR 0004 queda enmendado.

### T10 · Casos de uso de venta e inventario para sync `L` · `Difícil` · **crítica de datos** (después de T3 y T5)

- [ ] Migración de la API (única de SP5): `sales.sync_flags` con `CHECK`, `sales.author_user_id`, `sales.adopted_by`, `devices.last_sync_at`, `devices.last_reported_pending`; privilegios de `monaco_app` sin `UPDATE` sobre `sales`.
- [ ] `RecordSale` con `shortfallPolicy` y el clamp de `occurred_at` (`clock_adjusted`); audit `sale_stock_shortfall`.
- [ ] `VoidSale` (`sales:void`), `CorrectSale` y `CorrectInventoryDocument` (reversión + documento nuevo en una transacción, stock sobre el neto).
- [ ] `POST /inventory/documents/:id/reverse` rechaza documentos `sale`.
- [ ] Enmiendas a los ADR 0006 y 0007.

**Hecho cuando:** los tests de integración cubren: dos ventas de la última unidad (−1 con flag), una salida que no cabe (`INSUFFICIENT_STOCK`), corrección atómica (sin estado intermedio visible), anulación sin `sales:void` (403), reversión de `sale` desde inventario rechazada y el guard de privilegios con las columnas nuevas.

### T11 · Módulo `sync` en la API `L` · `Difícil` · **crítica de seguridad** (después de T9 y T10)

- [ ] `POST /sync/push`: validación del lote, una transacción por operación, corte en error reintentable (`not_processed`), `DEPENDENCY_REJECTED`, política de D2 (lease, permisos actuales, adopción), `duplicate`, límite de body de 256 KB, throttler `device`, `devices.last_sync_at`/`last_reported_pending`.
- [ ] `GET /sync/pull`: instantánea del punto (spec, tabla de "Pull"), costos según SP3 · D10, `reversedDocuments`, `ETag`/`304`, *lease*.
- [ ] Logs estructurados por lote sin montos; audit `sync_rate_anomaly`.

**Hecho cuando:** los tests de integración cubren cada rama de la política de permisos revocados (lease válido, vencido, inválido, anulación sin permiso actual, dispositivo revocado, adopción), orden y corte del lote, idempotencia, fuga entre tenants y entre puntos, `304` y rate limit.

### T12 · Onboarding en la API `M` · `Difícil` · **crítica de datos** (después de T10; en paralelo con T11)

- [ ] `POST /sync/onboarding` en `modules/onboarding/`: productos con los ids del cliente, precios base, documento `entry` "Saldo inicial" por producto con stock > 0, en una transacción; exige punto sin productos ni movimientos; idempotente.
- [ ] Validación contra `UNITS_OF_MEASURE`, `CATEGORIES` y monedas; permisos `catalog:write` e `inventory:write` con alcance tenant.

**Hecho cuando:** un test de integración importa un catálogo de 2.000 productos, repite la importación sin duplicar, rechaza un punto con datos y un actor sin alcance tenant, y el stock y el costo promedio resultantes coinciden con los del payload.

### T13a · Runtime de sync en mobile `M` · `Difícil` (después de T8 y T11; en paralelo con T13b)

- [ ] Adaptador `Transport` sobre el cliente generado de SP4 (bearer, refresh single-flight, `Retry-After`).
- [ ] Disparadores: al abrir, NetInfo, *debounce* tras cada operación, cada minuto con pendientes, pull cada 5 min; `expo-background-task` según T2.
- [ ] *Lease* y `server_clock_offset_ms` en `sync_state`; el *lease* vencido deja `leaseId: null`.
- [ ] Sesión revocada: se borra la sesión, nunca el op-log.

**Hecho cuando:** en un dispositivo real, modo avión → 5 ventas → recuperar red sincroniza las 5 sin intervención; matar la app durante un push no duplica ni pierde ninguna (verificado en la web); y un 401 del refresh deja la cola intacta.

### T13b · Caja vinculada: catálogo de solo lectura, precios y stock del servidor `L` · `Media` (después de T8; en paralelo con T13a)

- [ ] Con `sync_state`: `app/catalog/` lee `server_products`, sin alta, edición ni archivado ("Los productos se administran en la web").
- [ ] Precios de la venta desde `server_location_prices`; `verifySessionStock` con `projectStock`.
- [ ] "Hoy" en la zona del tenant; `maxDate` de hoy en el selector de fecha de la venta (`app/sales/new-session.tsx`).
- [ ] Sin `sync_state`, todo igual que hoy (tests).

**Hecho cuando:** los tests de mobile cubren los dos modos; la suite financiera pasa sin cambios en modo no vinculado; y en una caja vinculada el stock mostrado coincide con el de la web más las ventas pendientes.

### T14a · UI del estado de sync `M` · `Media` (después de T13a y T13b; en paralelo con T14b)

- [ ] Indicador en `app/(tabs)/_layout.tsx` y pantalla `app/account/sync.tsx` (spec, "Observabilidad").
- [ ] Rechazadas con motivo en español, "Adoptar" (con la sesión actual) y "Descartar" (con confirmación).
- [ ] Íconos por línea en historial de ventas e inventario, con `accessibilityLabel`.
- [ ] Aviso al cerrar sesión con pendientes; notificación local con pendientes de más de 24 h.

**Hecho cuando:** cada estado del indicador tiene un test de componente; adoptar y descartar quedan auditados en el servidor (integración); y la pantalla funciona con lector de pantalla.

### T14b · Vinculación y respaldos en una caja vinculada `M` · `Difícil` · **crítica de datos** (después de T12, T13a y T13b)

- [ ] "Vincular esta caja" (`app/account/link.tsx`): punto, moneda, revisión previa (unidades, categorías, redondeos, stock negativo), importación y primer pull.
- [ ] Una caja con datos no se vincula a un tenant con catálogo: ofrece exportar el respaldo y empezar de cero.
- [ ] `lib/backup.ts`: restaurar en una caja vinculada pide confirmación, marca `restored_at` y fuerza push y pull completos (D8).

**Hecho cuando:** la vinculación de la copia de producción de T1 contra la API local deja en la web el mismo catálogo y el mismo stock por producto que la app; repetirla no duplica nada; y restaurar un respaldo viejo en la caja vinculada no duplica ventas en el servidor.

### T15 · Marcas de sync en la web `S` · `Fácil` (después de T10 y T11)

- [ ] Inventario: pares con stock negativo con la etiqueta "Revisar" y link a las ventas marcadas.
- [ ] Dispositivos: última sincronización y pendientes informados.

**Hecho cuando:** tests de componente de las dos vistas y el e2e de T16 ven la etiqueta.

### T16 · Integración de punta a punta, gate y documentación `M` · `Media` (después de todo)

- [ ] Test de integración en `apps/api` con dos instancias de `@monaco/sync` (adaptador `better-sqlite3`) contra la API real: los casos de "Conflictos" del spec.
- [ ] E2E Playwright: una venta sincronizada aparece en `/tablero` en su día real; "Revisar" visible.
- [ ] Prueba manual del gate en dispositivo real (modo avión, anulación, edición, dos cajas con la última unidad), con evidencia en el PR.
- [ ] ADR 0009 a "Aceptada"; `CLAUDE.md` (módulo `sync`, `packages/sync`, op-log), README (probar el sync con dos dispositivos), docs/20 (estado de SP5).

**Hecho cuando:** se cumple el gate de salida del spec y CI está en verde, incluidos `api-integration`, `openapi-drift` y `e2e`.
