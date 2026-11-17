# SP5 · Sync offline de mobile: diseño

**Fecha:** 2026-11-16 · **Estado:** propuesta · **Depende de:** SP3 y SP4 (diseñados, **no implementados**) · **Gobierna:** [spec de la Etapa 2](2026-07-11-etapa2-plataforma-multinegocio-design.md) (qué y por qué) y [docs/20](../../20-plan-etapa2.md) (gate y calendario: 5 semanas, 01-25 → 02-26)

## Objetivo

Que la caja mobile siga vendiendo **sin red** y que, cuando haya red, sus ventas lleguen al servidor **una sola vez, en orden y sin perder ninguna**, dentro del libro de inventario de SP3/SP4. El gate de docs/20 lo resume: *"UUIDv7 en mobile con la suite financiera en verde; op-log y push/pull idempotente; catálogo descargado de solo lectura; ventas offline que sincronizan; política definida para permisos revocados offline"*.

Principios heredados del spec de la Etapa 2 que este diseño no negocia:

- **Vender jamás depende de la red** ([docs/12](../../12-vision-multiplataforma.md)): SQLite local es la verdad inmediata en la caja.
- **El servidor es la autoridad final** al sincronizar; mobile cachea los permisos efectivos para decidir sin red.
- **Un único escritor por dato** y dominio *append-mostly*: el stock se deriva de movimientos, nunca de un contador.

SP5 es el sub-proyecto más incierto (docs/20). El producto ya se puede demostrar desde SP4, así que este diseño ordena el trabajo para que lo riesgoso salga primero (spikes) y deja escrito qué se recorta si el calendario no alcanza.

## Alcance

**Entra en SP5:**

1. Migración de los ids de mobile de enteros autoincrementales a **UUIDv7**, con la suite financiera en verde, compatibilidad de respaldos y plan de vuelta atrás.
2. **Op-log local** (cola de salida durable) escrita en la misma transacción que cada escritura de negocio.
3. **Push** idempotente por lotes (`POST /sync/push`) y **pull** del catálogo, precios, stock del punto y permisos (`GET /sync/pull`).
4. **Ventas offline que sincronizan** como documentos `sale` del libro (modelo de SP4), incluidas su anulación y corrección como reversiones.
5. Entradas y salidas de almacén hechas en la caja, sincronizadas como documentos de inventario (recortable, ver "Recortes").
6. **Catálogo descargado de solo lectura** en la caja vinculada.
7. **Política explícita de permisos revocados offline** (gate), con un *lease* de permisos firmado por el servidor.
8. Refresh de sesión en segundo plano y estado de sync visible en la UI.
9. Vinculación (*onboarding*) de un negocio que hoy usa la app en un solo dispositivo.

**Queda solo local (non-goals de SP5):**

| Dato o función | Por qué queda local |
|---|---|
| Gastos (`gastos`) | El servidor no tiene gastos (non-goal de SP4: "Utilidad bruta, sin gastos") |
| Cobro en efectivo y vuelto (`sesiones_venta.monto_recibido`, `vuelto`) | `sales` de SP4 no tiene esas columnas; es una ayuda de caja, no un hecho contable del servidor |
| Configuración (`configuracion`: descuentos sugeridos, umbrales, recordatorios, último respaldo) | Son preferencias del dispositivo |
| Reportes locales, exportación a Excel y respaldos | Siguen funcionando sobre los datos locales, como hoy |
| Historia previa a la vinculación | Ver D7: no se sube por defecto |

**Fuera de SP5:** cierre de caja (`cash:close`), transferencias entre puntos desde mobile, alta o edición de productos desde mobile en una caja vinculada, varios usuarios alternándose offline en la misma caja, anular ventas de una caja desde la web, pull incremental por cursor (si se acepta D5), UI web de resolución de conflictos más allá de marcar lo que requiere revisión.

## Lo que ya existe (verificado en el código)

| Hecho | Dónde |
|---|---|
| Todas las tablas de mobile usan `integer('id').primaryKey({ autoIncrement: true })`: `productos`, `movimientos_almacen`, `sesiones_venta`, `ventas`, `gastos`. `configuracion` usa `clave` (texto). FKs: `ventas.producto_id`, `ventas.sesion_id`, `movimientos_almacen.producto_id` | `apps/mobile/db/schema.ts` |
| Las fechas de negocio son texto `yyyy-MM-dd` **sin hora** (`fecha`); solo `sesiones_venta.creado_en` guarda un ISO completo | `apps/mobile/db/schema.ts`, `apps/mobile/store/index.ts` (`format(new Date(), 'yyyy-MM-dd')`) |
| El selector de fecha de la venta **no tiene `maxDate`**: se puede registrar una venta en el futuro. Entradas, salidas y gastos sí lo limitan a hoy | `apps/mobile/app/sales/new-session.tsx` (sin `maxDate`), `app/inventory/stock-entry.tsx:265`, `app/expenses/outflow.tsx:307`, `app/expenses/new.tsx:154` |
| Anular es un *soft delete* en el lugar (`anulado`/`anulada = true`) y existe "restaurar" (deshacer) para ventas, entradas y salidas | `db/sales.ts:191-197`, `db/movements.ts:99-135`, `db/movements.ts:207-214`, `app/sales/history.tsx`, `app/inventory/history.tsx` |
| Editar es un `UPDATE` en el lugar: `updateSale` recalcula la utilidad con el `costo_al_vender` congelado; `updateEntry` puede cambiar hasta el producto y recalcula el costo promedio desde cero | `db/sales.ts:214`, `db/movements.ts:70` |
| Solo `registerSalesSession` es atómico (transacción síncrona de Drizzle). `registerEntry`, `updateEntry`, `cancelEntry` y `restoreEntry` hacen un `INSERT`/`UPDATE` y después otro `UPDATE` de `productos` **sin transacción** | `db/sales.ts:59-64`, `db/movements.ts:16-37`, `:70-96`, `:99-116` |
| Una venta de varias líneas solo queda agrupada si hubo cobro en efectivo (`sesion_id`); sin cobro, las líneas no tienen nada que las una | `db/sales.ts:67-87` |
| El costo de la venta es `productos.precio_costo` (no el promedio), decisión de la corrección de utilidad de [docs/13](../../13-utilidad-costo-promedio.md) | `db/sales.ts:103` |
| El stock local es `Σ movimientos con signo − Σ ventas` sin anular; `ajuste` lleva cantidad con signo | `db/queries.ts:34-60`, `packages/domain/src/stock.ts` |
| Importes y cantidades en `real` (flotantes) y una sola lista de precios (`precio_efectivo`, `precio_transferencia`) sin moneda ni punto de venta | `db/schema.ts` |
| Migraciones con `useMigrations` de `drizzle-orm/expo-sqlite/migrator` al arrancar; 4 migraciones SQL; los tests aplican todos los `.sql` en orden sobre `better-sqlite3` en memoria | `app/_layout.tsx:21`, `drizzle/`, `db/__tests__/test-db.ts` |
| `db/client.ts` no activa `PRAGMA foreign_keys`: las FKs locales no se hacen cumplir hoy | `apps/mobile/db/client.ts` |
| Respaldo = copia del archivo `db.sqlite` tras `PRAGMA wal_checkpoint(FULL)`; restaurar = sobrescribir el archivo (valida solo la cabecera SQLite) | `apps/mobile/lib/backup.ts` |
| Suite: 77 tests en `apps/mobile` (`db/__tests__`, `lib/__tests__`) + 19 en `packages/domain` = los **96** de docs/20. Umbrales globales de mobile: statements 93, branches 69, functions 95, lines 95 | `apps/mobile/package.json` (`jest.coverageThreshold`) |
| Mobile usa Zod 3 y `@hookform/resolvers` 3; `@monaco/contracts` usa Zod 4 y su `Uuid` exige UUIDv7 en minúsculas | `apps/mobile/package.json`, `packages/contracts/src/common/uuid.ts` |
| `sales:create` y `sales:void` ya existen en el catálogo de permisos | `packages/contracts/src/iam/permissions.ts:17-18` |
| Access token de 10 min; refresh rotativo de 30 días con familia de 90 días absolutos, detección de reuso y revocación inmediata; permisos resueltos por petición | [ADR 0004](../../adr/0004-autenticacion.md) §1-§4 |

**Dependencias de SP3 y SP4 (diseñados, sin código todavía).** SP5 usa: el libro append-only con idempotencia por id del cliente + `payload_hash`, reversión única por documento, locks por (punto, producto) y producto/punto archivado (SP3, ADR 0006); `sales`/`sale_lines`, el tipo `sale`, `RecordSale`, `saleLineAmounts`, `tenants.time_zone`, la sesión mobile con `expo-secure-store`, el `deviceId` estable, el cliente generado en `apps/mobile/lib/api/` y `TRUSTED_PROXY_HOPS` en la API (SP4, ADR 0007). Ninguna tarea de servidor de SP5 empieza antes de que SP3 y SP4 estén en `main`; si cambian al implementarse, este spec se revisa primero. Las tareas de mobile tampoco tocan `db/` antes del merge de SP4 (regla de docs/20: "hasta SP4, `apps/mobile` solo recibe cambios de tooling"); los spikes sí pueden correr antes porque no se mergean.

## Decisiones de diseño

| Tema | Decisión | Por qué |
|---|---|---|
| Unidad de sync | La **operación** (un comando de negocio con su id), no la fila ni el diff de columnas | El servidor es append-only: no hay filas que pisar, hay hechos que agregar |
| Id de cada operación | El id del documento que crea (UUIDv7 generado en el dispositivo). Es a la vez la clave de idempotencia | Es el modelo de SP3 (ADR 0006 §4): no hace falta una tabla de idempotencia aparte |
| Ediciones y anulaciones locales | Se siguen haciendo en el lugar en SQLite (la suite financiera no cambia), y el op-log las traduce a **reversión** o a **reversión + documento nuevo** en el servidor | Mantiene el comportamiento local probado y respeta el libro append-only |
| Motor de sync | Paquete puro `packages/sync` (`@monaco/sync`) con puertos de almacenamiento y transporte; adaptadores en mobile (expo-sqlite, `openapi-fetch`) y en los tests (`better-sqlite3`, fake o API real) | Permite tests de propiedades y una simulación determinista de dos dispositivos en Node, y la integración contra la API real con Testcontainers (ADR 0009) |
| Pull | Instantánea completa del punto con `ETag` (D5) | Catálogos chicos; sin cursores ni tombstones mientras el servidor no borre nada |
| Stock en la caja vinculada | `stock del servidor (instantánea) + efecto de las operaciones locales aún no incluidas en esa instantánea` | Otras cajas y la web también mueven el stock del punto; el stock local solo no alcanza |
| Permisos offline | *Lease* de permisos firmado por la API (D2) | Es "cachear los permisos efectivos" del spec de la Etapa 2, pero verificable por el servidor |
| Stock negativo al sincronizar | Las ventas se aceptan y se marcan; el resto de documentos mantiene la regla estricta (D1) | Una venta ya cobrada es un hecho; rechazarla pierde una venta |

## Migración de ids a UUIDv7 en mobile

### Estrategia

1. **Migración SQL pura** (`apps/mobile/drizzle/0004_uuid_ids.sql`), así `useMigrations` la aplica al arrancar y `db/__tests__/test-db.ts` la aplica en los tests sin cambios: la suite financiera corre sobre el esquema migrado.
2. Por cada tabla con id entero: crear `<tabla>_new` con `id text primary key` (UUIDv7) y la columna `legacy_id integer` (única, nullable para filas nuevas), copiar las filas, reescribir las FKs con un *join* contra la tabla de mapeo, borrar la vieja y renombrar. Orden: `productos` → `sesiones_venta` → `movimientos_almacen`, `ventas` → `gastos`. Los índices (`idx_ventas_producto`, etc.) se recrean.
3. **Generación de UUIDv7 en SQL:** 48 bits de milisegundos + versión `7` + 12 bits aleatorios + variante `10` + 62 bits aleatorios, con `printf('%012x', …)` y `hex(randomblob(…))`. El timestamp sale de la fecha de negocio de la fila (`fecha` a mediodía UTC) y, para `productos`, del `legacy_id` como desempate: los ids quedan ordenados aproximadamente por fecha y son únicos por la parte aleatoria. Un test en `db/__tests__` valida que todos los ids migrados pasan la regex de UUIDv7 y que `legacy_id` cubre el 100 % de las filas viejas.
4. **Columnas nuevas** en la misma migración: `ventas.ticket_id text` (agrupa las líneas de una venta: para las filas viejas, el id nuevo de su `sesion_id` si existe, o el propio id de la línea), `ventas.occurred_at text`, `movimientos_almacen.occurred_at text` (ISO con offset; null en filas viejas).
5. **Código:** `schema.ts` pasa a `text('id').primaryKey().$defaultFn(uuidv7)` y todas las firmas `id: number` de `db/*.ts`, `store/index.ts` (`CartItem.productId`) y pantallas pasan a `string`. Las rutas tipadas `app/catalog/[id].tsx` reciben el id como string (ya lo hacen por URL).
6. **Generador UUIDv7 en el dispositivo:** el de SP3 (`packages/contracts`, con `globalThis.crypto.getRandomValues`). Hermes no trae `crypto.getRandomValues`: se instala el polyfill que indique la doc de Expo 54 (`expo-crypto`), verificado en el spike T1. Para no arrastrar Zod 4 al bundle, mobile lo importa desde un *subpath* sin Zod (`@monaco/contracts/ids`) (D9).

### Datos instalados, transacción y vuelta atrás

- **Copia previa:** antes de `useMigrations`, si el journal indica que `0004` no se aplicó, la app copia `db.sqlite` a `db.pre-uuid.sqlite` (tras `wal_checkpoint(FULL)`, como `exportBackup`). Si la copia falla, no migra y muestra un error con la opción de exportar un respaldo.
- **Atomicidad:** el migrador de Drizzle corre cada migración en una transacción; una falla deja el esquema viejo. `PRAGMA foreign_keys` no puede cambiar dentro de una transacción, pero hoy está apagado (ver "Lo que ya existe"), así que el *rebuild* de tablas no lo necesita; tras la copia se corre `PRAGMA foreign_key_check` y un conteo por tabla, y si algo no cuadra la migración aborta (`SELECT RAISE(ABORT, …)`). El spike T1 confirma estos supuestos sobre expo-sqlite 16.
- **Vuelta atrás:** las apps no se pueden "desactualizar" en las tiendas, así que el rollback es de datos: `db.pre-uuid.sqlite` se conserva 30 días y Configuración → Respaldo ofrece "Restaurar copia previa a la actualización" junto con una versión de la app que vuelve a migrar. Pasados 30 días sin problemas, se borra.
- **Compatibilidad de respaldos:** un respaldo viejo (ids enteros) se restaura como hoy (sobrescribe el archivo) y en el siguiente arranque `useMigrations` lo migra, porque la tabla `__drizzle_migrations` viaja dentro del archivo. Un respaldo nuevo **no** se puede restaurar en una versión vieja de la app: se documenta. Un test de mobile restaura un archivo con el esquema `0003` y comprueba que queda en `0004` con las mismas sumas financieras.
- **Gate de la tarea:** la suite completa (96 tests) pasa sin cambiar ninguna aserción financiera (solo tipos de id en los helpers) y con los mismos umbrales de cobertura. Además, un test de equivalencia corre los reportes de `db/__tests__/reports.test.ts` sobre una base sembrada antes y después de la migración y compara los resultados.

## Op-log local

### Forma

Tablas nuevas en SQLite (nombres en inglés: son nuevas, la regla de `CLAUDE.md` solo conserva las columnas existentes):

| Tabla | Columnas | Notas |
|---|---|---|
| `sync_operations` | `seq integer primary key autoincrement`, `id text unique` (UUIDv7 = id del documento en el servidor), `type`, `aggregate_id` (venta o movimiento local que la originó), `depends_on` (id de otra operación o null), `payload` (JSON congelado), `payload_hash`, `schema_version`, `author_user_id`, `location_id`, `lease_id`, `created_at` (reloj del dispositivo), `not_before`, `status` (`pending`, `in_flight`, `applied`, `rejected`, `superseded`), `attempts`, `next_attempt_at`, `last_error_code`, `server_result` (JSON), `applied_at` (hora del servidor) | `seq` es el orden total local. El `payload` no se reescribe nunca: ni las migraciones locales lo tocan |
| `sync_state` | una fila: `tenant_id`, `location_id`, `device_id`, `linked_at`, `pull_etag`, `pulled_at` (hora del servidor), `server_clock_offset_ms`, `lease_token`, `lease_expires_at`, `last_push_at`, `restored_at` | Existe solo en una caja vinculada; sin fila, la app funciona como hoy |
| `server_products`, `server_location_prices`, `server_stock` | proyección de la instantánea del pull | Solo lectura para la UI; se reemplazan enteras en cada pull |

### Qué es una operación

| Acción local (función actual) | Operación | En el servidor |
|---|---|---|
| Registrar venta (`registerSalesSession`) | `sale.record` (una por ticket: `id = ticket_id`, una línea por fila de `ventas`, `line.id = ventas.id`) | `RecordSale` |
| Anular una línea (`cancelSale`) | `sale.correct` con las líneas que quedan, o `sale.void` si no queda ninguna | Reversión del documento vigente del ticket (+ documento nuevo con las líneas restantes) |
| Editar una línea (`updateSale`) | `sale.correct` | Reversión + documento nuevo, atómicos |
| Restaurar una línea (`restoreSale`) | `sale.correct` (o `sale.record` si el ticket estaba anulado entero) | Igual |
| Entrada (`registerEntry`) / salida (`registerOutflow`) | `inventory.entry` / `inventory.exit` / `inventory.adjustment` (un documento de una línea; el mapeo de tipos es el de `@monaco/domain` de SP3) | Casos de uso de inventario de SP3 |
| Editar, anular o restaurar entrada/salida | `inventory.correct` / `inventory.reverse` | Reversión (+ documento nuevo) atómicos |
| Gastos, configuración, cobro en efectivo | Ninguna | Solo local |

Regla única: **cualquier cambio local a un ticket o movimiento ya registrado se envía como "revertir la versión vigente en el servidor y, si queda algo, registrar la versión nueva"**. La tabla `sync_aggregate_versions (aggregate_id, current_document_id)` guarda qué documento del servidor representa hoy a cada ticket o movimiento; cada corrección genera un id nuevo de documento y uno de reversión, y depende (`depends_on`) de la operación anterior del mismo agregado.

**Coalescencia antes de enviar** (solo sobre operaciones `pending` del mismo agregado, nunca sobre `in_flight` o `applied`): registrar + anular → ambas `superseded` (no viaja nada); registrar + editar → se reemplaza el `payload` del registro **antes** de su primer envío (el hash se recalcula; nunca se envió) ; editar + editar → la última. Así el "Deshacer" inmediato no genera tráfico. Las anulaciones esperan `not_before = created_at + 10 s` (la ventana del botón Deshacer) antes de ser elegibles.

**Atomicidad:** cada función de `db/` que escribe datos de negocio escribe también su operación **en la misma transacción SQLite** cuando la caja está vinculada. Como hoy solo `registerSalesSession` es transaccional, la tarea T7a envuelve en transacciones `registerEntry`, `updateEntry`, `cancelEntry`, `restoreEntry` y las demás escrituras antes de agregar el op-log (con la suite como gate).

### Orden

- **Local:** orden total por `seq`. Se envía en orden de `seq`.
- **Servidor:** procesa cada lote en el orden recibido; el orden del libro y del costo promedio es el de **llegada** (SP3 · D13), no `occurred_at`.
- **Garantía:** dentro de un agregado, una operación nunca se aplica antes que su `depends_on`. Entre agregados distintos no hay dependencia: una entrada rechazada no bloquea una venta posterior del mismo producto (la venta se acepta y, si deja stock negativo, se marca; D1).

## Push

`POST /sync/push` con el bearer de la sesión mobile.

```json
{
  "batchId": "<uuidv7>",
  "pendingCount": 12,
  "ops": [
    { "id": "<uuidv7>", "type": "sale.record", "schemaVersion": 1, "dependsOn": null,
      "authorUserId": "<uuid>", "locationId": "<uuid>", "leaseId": "<jti>",
      "occurredAt": "2027-02-01T14:03:00-05:00", "payload": { … } }
  ]
}
```

- **Lotes:** hasta 100 operaciones y 256 KB por petición (límite de body propio de la ruta; el resto de la API mantiene el suyo). El motor arma lotes por `seq`.
- **Respuesta `200`** con un resultado por operación, en el mismo orden: `applied` (con `documentId`, `appliedAt`, `flags`), `duplicate` (ya aplicada con el mismo hash: mismo resultado que la primera vez), `rejected` (`code` permanente) o `not_processed`. Los errores de **todo el lote** (401, 413, 422 de forma del lote, 429) no procesan nada.
- **Procesamiento:** cada operación en su propia transacción de `withTenant` (fallas parciales sin deshacer las anteriores). Si una operación falla por algo **reintentable** (timeout de lock, serialización, 5xx interno), el servidor corta: esa y las siguientes vuelven `not_processed`, y el orden se conserva. Si falla de forma **permanente**, se marca `rejected` y las que dependen de ella en el mismo lote salen `rejected` con `DEPENDENCY_REJECTED`; las independientes siguen.
- **Idempotencia:** por id del documento + `payload_hash` (ADR 0006 §4). Mismo id con otro hash → `rejected` `IDEMPOTENCY_CONFLICT` (en la práctica, un bug del cliente: la coalescencia nunca reescribe una operación ya enviada).
- **Reintentos en el dispositivo:** `in_flight` vuelve a `pending` al arrancar la app o si la petición falla sin respuesta. Backoff exponencial con *jitter* (2 s, 4 s, 8 s… tope 15 min), respetando `Retry-After`. Una operación `rejected` no se reintenta sola: queda visible para el usuario (ver "Observabilidad"). Un lote con red caída no consume intentos.
- **Errores permanentes:** `FORBIDDEN`, `NOT_FOUND`, `ARCHIVED` (entradas de producto o punto archivado), `INSUFFICIENT_STOCK` (documentos que no son venta), `ALREADY_REVERSED`, `IDEMPOTENCY_CONFLICT`, `LEASE_INVALID`, `DEPENDENCY_REJECTED`, `VALIDATION_FAILED`. Los mensajes en español viven en mobile.

## Pull

`GET /sync/pull?locationId=…` con `If-None-Match`. Respuesta `200` con la instantánea, o `304`.

| Bloque | Contenido | Regla |
|---|---|---|
| `tenant` | `id`, `name`, `timeZone` | `time_zone` de SP4 |
| `location` | `id`, `name`, `archivedAt` | |
| `products` | todos los productos del tenant, **incluidos los archivados** (`archivedAt`), con `name`, `unitOfMeasure`, `category`, `currency`, `lowStockThreshold`, `expirationDate`; `costPrice` solo si el actor puede ver costos | Costos según SP3 · D10 (`catalog:write` o `inventory:write` en el alcance) |
| `prices` | precio efectivo y transferencia efectivos del punto (override o base) | Precio en unidades menores + moneda |
| `stock` | stock por producto del punto y `averageCost` (solo si ve costos) | Derivado con `SUM(quantity_delta)` |
| `permissionLease` | JWT firmado (ver "Auth offline") | |
| `asOf` | `now()` de la DB al leer | Base para combinar con las operaciones locales |

- **Solo lectura en la caja:** con la caja vinculada, el catálogo de mobile (`app/catalog/`) muestra los datos de `server_products` y deshabilita alta, edición y archivado con el texto "Los productos se administran en la web". Los precios sugeridos de la venta salen de `server_location_prices`.
- **Sin tombstones:** el servidor nunca borra productos ni puntos (se archivan, SP3), y la instantánea es completa: lo que no viene, no existe para ese actor. Si en el futuro se pasa a un pull incremental, el cursor sería una secuencia por tenant y los archivados viajarían como cambios, no como borrados (D5).
- **Stock mostrado:** `server_stock` + efecto de cada operación local con `status ∈ {pending, in_flight, rejected}` o con `applied_at > asOf`. Las aplicadas antes de `asOf` ya están en la instantánea. Las dos horas son del servidor, así que no depende del reloj del dispositivo. `verifySessionStock` usa este stock en una caja vinculada; sin vincular, sigue igual.
- **Frecuencia:** al abrir la app, al recuperar red, tras cada push exitoso y cada 5 min en primer plano. Tamaño esperado: < 1 MB con gzip para 5.000 productos.

## Conflictos

El servidor procesa por orden de llegada y bajo el lock por (punto, producto) de SP3. Reglas por caso, con quién gana:

| Caso | Ejemplo | Regla | Gana |
|---|---|---|---|
| Dos cajas venden la última unidad offline | Stock 1 en el punto. Caja A vende 1 a las 10:00 y caja B vende 1 a las 10:05, las dos sin red. A sincroniza a las 12:00, B a las 12:30 | A: `applied`, stock 0. B: `applied` con `flags: ['stock_shortfall']`, stock −1. Audit `sale_stock_shortfall`. La web muestra el par con stock negativo y "Revisar" hasta que alguien registre una entrada o un ajuste | Las dos ventas (son hechos cobrados) (D1) |
| Precio cambiado mientras la caja estaba offline | La web sube el precio de 100 a 120 a las 9:00; la caja, sin red desde las 8:00, vende a 100 | Se registra `unit_price = 100`: el precio de la venta es el que pagó el cliente. El audit de la venta lleva `metadata.price_differs: true` | La caja (para esa venta). La lista de precios sigue siendo la del servidor |
| Producto archivado offline | La web archiva "Galletas" a las 9:00; la caja vende galletas a las 10:00 sin saberlo | La venta se acepta (archivado admite salidas, SP3). Una **entrada** de galletas desde la caja se rechaza `ARCHIVED` | El servidor para entradas; la caja para ventas |
| Punto archivado offline | El Owner archiva el punto mientras su caja está sin red | Las ventas hechas con un *lease* válido se aceptan (D2) aunque el punto ya no aparezca en las asignaciones (ADR 0004 §4 descarta puntos archivados). Entradas: `ARCHIVED`. En el siguiente pull la caja ve `archivedAt` y bloquea nuevas ventas | Ventas: la caja; lo demás: el servidor |
| Stock negativo al llegar (documento que no es venta) | La caja registra una merma de 3 offline; mientras, otra caja vendió todo el stock | `rejected` `INSUFFICIENT_STOCK`. La caja la marca como rechazada; el usuario puede registrar un ajuste o descartarla | El servidor |
| Edición de algo ya revertido en la web | La web revierte una entrada hecha por la caja; después la caja, offline, edita esa entrada | La corrección sale `rejected` `ALREADY_REVERSED`. El pull trae el documento revertido y la caja marca la fila local como anulada por el servidor | El servidor |
| Edición de una venta ya sincronizada | La caja edita la cantidad de una línea sincronizada | `sale.correct`: reversión del documento vigente + documento nuevo con el ticket corregido, en una transacción y con stock evaluado sobre el neto | La caja (es el único escritor de sus ventas) |

**Único escritor:** una venta la escribe solo la caja que la registró; en SP5 no hay anulación de ventas desde la web, y `POST /inventory/documents/:id/reverse` rechaza documentos `sale` (`FORBIDDEN`) para que no exista un segundo escritor. Los documentos de inventario sí pueden revertirse desde la web (SP3); por eso el pull informa las reversiones de documentos creados por esa caja (`reversedDocuments` en la instantánea, últimos 30 días).

## Tiempo y relojes

- **Dos tiempos:** `occurred_at` (fecha de negocio, la informa el dispositivo) y el orden del servidor (`created_at` y el lock). Los reportes agrupan por `occurred_at` (SP4); el libro y el costo promedio se ordenan por llegada (SP3 · D13). Una venta sincronizada tarde cae en su día real y cambia los totales de un día pasado (ADR 0007): la UI de mobile lo explica en la pantalla de sync.
- **De `fecha` a `occurred_at`:** mobile solo guarda `yyyy-MM-dd`. Al registrar en una caja vinculada, si `fecha` es hoy (en la zona del tenant) se usa la hora del dispositivo; si es otro día, `fecha` a las 12:00 en la zona del tenant (el mediodía evita los cambios de hora de Cuba, que ocurren a medianoche). La función vive en `@monaco/domain` (`occurredAtFromBusinessDate`).
- **Día de la caja:** una vez vinculada, la caja calcula "hoy" en la zona del tenant (`sync_state` guarda la zona del pull), no en la del dispositivo, y lo avisa si difieren.
- **Reloj desfasado:** el servidor acepta `occurred_at` hasta `now() + 5 min`. Más adelante (reloj adelantado o fecha futura elegida), la venta **se acepta** con `occurred_at = now()` y `flags: ['clock_adjusted']`; el `payload` original queda en el hash y en el audit. Fechas pasadas se aceptan sin límite (una venta de hace dos semanas existió). SP5 agrega `maxDate` de hoy al selector de fecha de la venta, como ya tienen entradas y salidas.
- **Offset del reloj:** cada pull guarda `server_clock_offset_ms` (de `asOf` y la hora local). Se usa solo para la UI (vencimiento del *lease*, "hace N min"); el servidor nunca confía en el reloj del dispositivo.

## Auth offline

- **Base (SP4):** access token en memoria (10 min), refresh en `expo-secure-store`, `deviceId` estable, single-flight. Sin red, la caja no necesita el access token para vender: solo para sincronizar.
- **Lease de permisos:** cada pull trae `permissionLease`, un JWT EdDSA con la misma clave de la API pero `typ: perm-lease+jwt` y `aud: monaco-mobile-lease` (el guard lo rechaza como bearer). Claims: `tid`, `sub`, `did`, `jti`, `iat`, `exp` (D3: 7 días) y los permisos efectivos por punto (`{ locationId: [permission] }`). Se guarda en `sync_state` (no es una credencial: no autentica nada).
- **Decisión local sin red:** la UI habilita vender, anular o registrar entradas según el *lease* vigente. Con el *lease* vencido, la caja **sigue vendiendo** (vender jamás depende de la red) y las operaciones nuevas viajan con `leaseId: null`.
- **Política para permisos revocados offline (gate de docs/20), default D2:**
  1. **Ventas (`sale.record`) hechas con un *lease* válido:** se aceptan aunque el permiso se haya quitado después, si el *lease* tiene firma válida, es del mismo tenant, usuario y dispositivo, incluye `sales:create` en ese punto y la operación **llega al servidor antes de `lease.exp` + 7 días de gracia** (medido con el reloj del servidor, porque el del dispositivo no es confiable). El dispositivo siempre adjunta el *lease* más reciente que tiene, así que un *lease* viejo solo aparece en operaciones hechas antes de recibir el nuevo. Se marcan `flags: ['authorized_by_lease']` y audit `sale_accepted_under_stale_permission`.
  2. **Ventas sin *lease* o con *lease* vencido:** se autorizan con los permisos **actuales**. Si ya no los tiene, `rejected` `FORBIDDEN`.
  3. **Todo lo demás** (anulaciones y correcciones de ventas, entradas, salidas): permisos **actuales**, siempre. Una anulación es la vía de abuso clásica (anular y quedarse el efectivo), así que no se acepta con un permiso viejo.
  4. **Una operación rechazada no se borra:** queda en la caja como "Rechazada", con su efecto local visible y marcado, hasta que un usuario con el permiso la **adopte** (la vuelve a enviar con su sesión; el servidor registra `author_user_id` original y `adopted_by`, audit `sync_operation_adopted`) o la descarte (`sync_operation_discarded`, local y con confirmación).
- **Token vencido offline:** si el refresh venció (30 días sin sync, o 90 de familia), la caja sigue vendiendo y pide iniciar sesión para sincronizar. Al volver a entrar con el mismo usuario y el `deviceId` guardado (ADR 0004 §3), el push continúa.
- **Usuario desactivado o dispositivo revocado:** el refresh responde 401 y la sesión se borra (SP4), **pero el op-log no**. La caja muestra "Sesión revocada: N operaciones sin sincronizar". Un Owner o Manager inicia sesión en esa caja (un dispositivo revocado no se reusa: se registra uno nuevo) y las operaciones pendientes se envían como adoptadas, con sus permisos actuales. Si el dispositivo se revocó por robo, no hay nada que recuperar y las ventas no llegan: es el comportamiento buscado.
- **Refresh en segundo plano:** `expo-background-task` (Expo 54) dispara push, pull y refresh cuando el sistema lo permite; **no se confía en él**: la sincronización principal es en primer plano (al abrir, al recuperar red con NetInfo, tras cada operación con *debounce* de 2 s y cada minuto si hay pendientes). El refresh token guardado con `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (SP4) no se puede leer con el teléfono bloqueado: D4 decide si se relaja.
- **Cerrar sesión con pendientes:** se avisa ("Hay N ventas sin sincronizar; quedarán en este teléfono") y se permite; el siguiente usuario que inicie sesión las adopta.

## Servidor: endpoints, validación y aislamiento

| Endpoint | Permiso | Notas |
|---|---|---|
| `POST /sync/push` | sesión válida; cada operación autoriza en su caso de uso | Lote ≤ 100 ops / 256 KB; throttler `device` |
| `GET /sync/pull?locationId=` | algún permiso del punto (`sales:create`, `inventory:write` o `catalog:view`/`inventory:view` de SP3) | `ETag`/`304`; throttler `device` |
| `POST /sync/onboarding` | `catalog:write` e `inventory:write` con alcance tenant | Importación única, idempotente por id (ver "Onboarding") |

- **Módulo `sync`** (`apps/api/src/modules/sync/`, hexagonal, plantilla `health`): el controller valida la forma del lote con contracts y delega cada operación en los casos de uso existentes (`RecordSale` y los de inventario de SP3) más los nuevos: `VoidSale`, `CorrectSale`, `CorrectInventoryDocument` (reversión + documento nuevo en **una** transacción, con el stock evaluado sobre el neto). El caso de uso sigue siendo la autoridad (ADR 0005).
- **Contratos** en `packages/contracts/src/sync/`: `SyncPushRequest`, `SyncPushResult`, `SyncOperation` (unión discriminada por `type` y `schemaVersion`), `SyncPullResponse`, `PermissionLease`, `OnboardingRequest`; códigos de error nuevos `DEPENDENCY_REJECTED` y `LEASE_INVALID`. `pnpm openapi:generate`, el `schema.d.ts` de la web y el de mobile se regeneran.
- **Validación del servidor:** el `payload` se valida con el contrato de su `type`; `tenant` sale del token, nunca del cuerpo; `device_id` de `sales` sale de la sesión; `cashier_user_id` es el `authorUserId` solo si es un usuario del mismo tenant y la operación es adoptada o del propio actor (si no, `FORBIDDEN`); montos ≥ 0, cantidades con 3 decimales como máximo (SP3 · D1), descuentos 0–100; el costo **lo calcula el servidor**, el cliente nunca lo envía (D6).
- **Aislamiento:** todo corre en `withTenant` con RLS (ADR 0003); ids de productos, puntos o documentos de otro tenant dan la misma respuesta que los inexistentes (`NOT_FOUND`) o `IDEMPOTENCY_CONFLICT`, sin oráculos (SP3). El punto de cada operación tiene que estar en el *lease* o en los permisos actuales.
- **Esquema (migración de la API):** `sales.sync_flags text[] not null default '{}'` con `CHECK` contra `stock_shortfall`, `clock_adjusted`, `authorized_by_lease`, `adopted`; `sales.author_user_id` y `sales.adopted_by` (null); `devices.last_sync_at` y `devices.last_reported_pending`. Ningún `UPDATE` sobre el libro: los flags se fijan al insertar.
- **Regla de stock relajada solo para ventas sincronizadas:** `RecordSale` recibe `shortfallPolicy: 'reject' | 'flag'`; el push usa `'flag'`, todo lo demás sigue en `'reject'`. Es una enmienda al ADR 0006 ("el inventario no puede quedar negativo"), que se documenta allí.
- **Rate limits y abuso:** throttler `device` (clave = `did` del token) de 60 peticiones/min en `/sync/*` con el backoff progresivo de ADR 0004 §8; 100 ops por lote; `statement_timeout` de `monaco_app` (5 s, SP4). Un dispositivo que supera 2.000 operaciones/hora genera el audit `sync_rate_anomaly` para el Owner. La respuesta a un dispositivo comprometido es revocarlo (SP2).

## Seguridad de los datos (ninguna venta perdida)

- **Durabilidad:** la venta y su operación se escriben en la misma transacción SQLite; si la app muere a mitad, no queda ni una ni otra (y el usuario ve que la venta no se registró). El spike T1 confirma el modo de journal (WAL) y `synchronous` de expo-sqlite 16; si no es `FULL`, se fija al abrir la base.
- **Caída durante el sync:** el estado `in_flight` vuelve a `pending` al arrancar; el reenvío es idempotente (`duplicate` con el mismo resultado). Si la respuesta se pierde después del commit en el servidor, el reenvío devuelve `duplicate` y la caja marca `applied`.
- **Actualización de la app con la cola llena:** el `payload` lleva `schemaVersion`. El servidor acepta la versión actual y la anterior durante al menos una versión publicada de la app; las migraciones locales nunca reescriben `sync_operations.payload`.
- **Respaldo de la cola:** la cola vive en `db.sqlite`, así que el respaldo la incluye. Restaurar en una caja vinculada es peligroso: las operaciones ya aplicadas vuelven como `pending` (inofensivo: `duplicate`) y las posteriores al respaldo desaparecen de la caja (aunque el servidor las tenga). Default D8: restaurar en una caja vinculada exige confirmación explícita, marca `restored_at`, fuerza un push y un pull completos y muestra que el historial local puede no incluir operaciones que ya están en el servidor.
- **Retención:** las operaciones `applied` se conservan 90 días y después se compactan (se borra el `payload`, quedan id, tipo, estado y fechas). Las `rejected` no se compactan nunca.
- **Nada se borra automáticamente** de la cola por un error de sesión, de permisos o de red.

## Observabilidad del sync en la UI

- **Indicador en la barra de pestañas** (`app/(tabs)/_layout.tsx`): "Sincronizado · hace 2 min", "3 pendientes", "Sin conexión · 3 pendientes", "1 rechazada" (con color de alerta) o nada si la caja no está vinculada.
- **Pantalla "Sincronización"** (Configuración → Cuenta en línea): última subida y bajada correcta, permisos válidos hasta (fecha del *lease*), lista de pendientes y de rechazadas con el motivo en español y las acciones "Adoptar" y "Descartar", botón "Sincronizar ahora" y la explicación de por qué un día pasado puede cambiar en la web.
- **Ventas e historial:** cada línea muestra un ícono de "no sincronizada" o "rechazada" (ícono con `accessibilityLabel`, no solo color, [docs/09](../../09-accesibilidad.md)).
- **Notificación local** (`lib/notifications.ts`) si hay operaciones pendientes con más de 24 h.
- **Servidor:** `devices.last_sync_at` y `last_reported_pending` se ven en la página de dispositivos de la web (SP2); logs estructurados por lote (tenant, dispositivo, cantidad, resultados por código, duración), sin montos.

## Onboarding de un negocio de un solo dispositivo

El caso real es Mercado Mónaco: una sola caja con años de datos locales.

1. El Owner crea el tenant y el punto (`tenant:create` de SP2; time zone de SP4) e inicia sesión en la caja (login de SP4).
2. "Vincular esta caja" (Configuración → Cuenta en línea): elige el punto (de los de `GET /me` con `catalog:write` e `inventory:write`) y la moneda de los productos (D2 de SP3: moneda por producto; mobile no tiene moneda; default `CUP`).
3. **Revisión previa en el dispositivo:** unidades y categorías fuera de `UNITS_OF_MEASURE`/`CATEGORIES` (se muestran para corregir), precios que al pasar a unidades menores cambian, productos con stock negativo (se reportan; entran con saldo 0 y una nota).
4. **Importación** (`POST /sync/onboarding`, una sola transacción): crea los productos **con los mismos UUIDv7 locales** como id (así no hay que remapear nada en la caja), sus precios como base del catálogo y, por producto con stock > 0, un documento `entry` "Saldo inicial" con `unit_cost = effectiveUnitCost(costo_promedio, precio_costo)`. Requiere que el punto no tenga productos ni movimientos; repetirla con el mismo id es idempotente.
5. La caja escribe `sync_state` y hace el primer pull. Desde ahí el catálogo es de solo lectura en el dispositivo.
6. **Historia previa** (D7): no se sube por defecto. Los reportes locales la siguen mostrando; la web arranca en la fecha de vinculación.

Una segunda caja que se vincula a un tenant existente necesita la base local vacía de productos: si tiene datos, la app ofrece exportar un respaldo y empezar de cero.

## Seguridad

- **Lease:** firmado con EdDSA por la API, `aud` y `typ` propios; nunca sirve como bearer (test explícito). Lleva permisos, no secretos; si se filtra, no da acceso a nada. Riesgo aceptado: un dispositivo que atrasa su reloj puede seguir creando ventas con un *lease* viejo, pero solo se aceptan si llegan antes de `exp` + 7 días según el servidor, y solo ventas (nunca anulaciones).
- **El servidor no confía en el dispositivo** para tenant, `device_id`, costos, stock, hora (clamp) ni permisos (el *lease* solo acepta ventas, con firma y gracia acotada).
- **Anulaciones con permisos actuales** siempre (vía de fraude).
- **Adopción auditada:** quien adopta queda en `sales.adopted_by` y en `audit_events`.
- **Refresh en almacenamiento seguro** (SP4); D4 evalúa la accesibilidad del llavero en segundo plano.
- **Datos en el teléfono:** la base local no está cifrada (como hoy). Con la caja vinculada, contiene costos solo si el usuario puede verlos (SP3 · D10). El cifrado de SQLite queda fuera de SP5.
- **Abuso:** throttler por dispositivo, límites de lote, anomalía auditada y revocación inmediata (ADR 0004).
- **Sin oráculos entre tenants** (SP3): respuestas idénticas para ids ajenos e inexistentes.

## Tests

- **`packages/sync` (Vitest):**
  - **Propiedades** (`fast-check`, dependencia nueva de desarrollo): para cualquier secuencia de acciones locales (registrar, editar, anular, restaurar, en cualquier orden y con fallas de red intercaladas), el estado del servidor tras sincronizar es igual al de aplicar las acciones directamente; ninguna operación se aplica dos veces; ninguna se aplica antes que su `depends_on`; la coalescencia nunca toca una operación enviada.
  - **Simulación determinista de dos dispositivos** con un servidor falso en memoria que implementa las reglas de este spec y un planificador con semilla (red caída, respuestas perdidas, reinicios, relojes desfasados). Casos fijos: los cinco ejemplos de "Conflictos" y "ninguna venta perdida".
- **Integración contra la API real** (`apps/api`, Testcontainers): el mismo motor con el adaptador `better-sqlite3` y `fetch` contra la app Nest: dos dispositivos, push/pull, reintento tras corte, `duplicate`, stock negativo marcado, *lease* (aceptado, vencido, firma inválida, usado como bearer → 401), permisos revocados, dispositivo revocado y adopción, fuga entre tenants y entre puntos, rate limit, `ETag`.
- **Mobile (Jest, suite financiera):** la migración `0004` (ids válidos, FKs reescritas, sumas iguales antes y después, restauración de un respaldo `0003`), las transacciones nuevas, la escritura del op-log en la misma transacción (rollback de las dos), el stock combinado y `occurredAtFromBusinessDate`. Los umbrales de cobertura no bajan.
- **E2E:** un escenario Playwright de la web que comprueba que una venta enviada por el adaptador de tests aparece en `/tablero` y que un par con `stock_shortfall` se muestra con "Revisar".
- **Manual en dispositivo real:** modo avión → vender → reabrir la app → recuperar red → comprobar en la web (gate). Es también el smoke test pendiente TSK-5 de docs/20.

## Decisiones abiertas

El spec de la Etapa 2 y docs/20 no fijan estos puntos. El resto del documento **asume el default recomendado**. Las marcadas **[Dueño]** son de producto.

| # | Decisión | Opciones y tradeoffs | Default recomendado (supuesto) |
|---|---|---|---|
| D1 | **[Dueño]** Venta offline que deja el stock negativo al llegar | (a) aceptar y marcar (`stock_shortfall`), revisión en la web: ninguna venta se pierde, el stock refleja la realidad física con un error visible; (b) rechazar al sincronizar: preserva la regla de SP3 pero pierde una venta cobrada; (c) aceptar sin mover stock y dejarla en cola de revisión: el stock queda mal hasta que alguien decide | (a), solo para ventas; entradas y salidas siguen estrictas. Enmienda al ADR 0006 |
| D2 | **[Dueño]** Permisos revocados offline (gate) | (a) *lease* firmado: ventas hechas con un *lease* válido se aceptan, lo demás con permisos actuales, lo rechazado se adopta o descarta; (b) siempre permisos actuales: simple, pero rechaza ventas legítimas tras un cambio de rol; (c) aceptar todo lo de un dispositivo autenticado: simple, pero un Cashier al que se le quitó el permiso puede seguir vendiendo y anulando | (a) |
| D3 | **[Dueño]** TTL del *lease* | 72 h (más seguro, más rechazos tras un fin de semana sin red); 7 días; sin vencimiento (contradice "el servidor es la autoridad") | 7 días |
| D4 | Llavero del refresh en segundo plano | (a) mantener `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: el sync en segundo plano solo funciona con el teléfono desbloqueado; (b) `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`: sync con el teléfono bloqueado, el token es legible por procesos de la app tras el primer desbloqueo | (a): el sync en primer plano cubre el caso; se mide en el spike T2 |
| D5 | Forma del pull | (a) instantánea completa con `ETag`; (b) incremental con secuencia por tenant: menos tráfico, pero exige una secuencia transaccional por tabla y cambios como eventos | (a), con el límite de 5.000 productos medido; (b) si se supera |
| D6 | **[Dueño]** Costo de una venta sincronizada | (a) lo calcula el servidor con `effectiveUnitCost` (promedio por punto, SP4); (b) el costo que vio la caja (`precio_costo`, regla actual de mobile tras docs/13): coincide con la utilidad local, pero el cliente dictaría costos | (a). La utilidad local y la de la web pueden diferir; se explica en la pantalla de sync. Ver "Contradicciones" |
| D7 | **[Dueño]** Historia previa en el onboarding | (a) solo catálogo y saldo inicial; (b) subir toda la historia como documentos: la web tendría años de datos, pero con costos promedio recalculados por llegada y muchos casos borde | (a) |
| D8 | Restaurar un respaldo en una caja vinculada | (a) permitir con confirmación, push y pull completos y aviso; (b) prohibir mientras esté vinculada: más seguro, pero quita la salida de emergencia | (a) |
| D9 | Generador UUIDv7 en mobile y Zod 4 | (a) subpath `@monaco/contracts/ids` sin Zod y mobile sigue con Zod 3 (la migración a Zod 4 de SP4 · D8 se vuelve a posponer: el dispositivo arma los `payload` con tipos generados del OpenAPI y valida el servidor); (b) migrar mobile a Zod 4 y `@hookform/resolvers` 5 para validar con contracts en el dispositivo: más seguridad de tipos, toca todos los formularios | (a) |
| D10 | Dónde vive el motor de sync | (a) paquete puro `packages/sync`; (b) `apps/mobile/lib/sync`: menos piezas, pero sin simulación ni integración contra la API real fuera de Jest/Expo | (a) |

## Contradicciones encontradas

1. **Costo de la venta:** mobile usa `precio_costo` (`apps/mobile/db/sales.ts:103`, decisión de docs/13), y SP4 define `unit_cost = effectiveUnitCost(average_cost, cost_price)` (promedio por punto). La utilidad de la misma venta difiere entre la caja y la web (D6). El test de SP4 · T2 que compara `saleLineAmounts` con mobile solo vale "cuando el costo es el mismo".
2. **Venta con fecha futura:** el selector de fecha de la venta no tiene `maxDate`, y SP3 dice que `occurred_at` "no puede estar en el futuro". Se resuelve con el clamp del servidor y `maxDate` en mobile.
3. **"Stock no negativo" de SP3/ADR 0006** frente a "ninguna venta perdida" offline: D1 relaja la regla solo para ventas sincronizadas.
4. **Ticket de venta:** SP4 modela una venta con cabecera y líneas; mobile solo agrupa líneas si hubo cobro en efectivo. Se agrega `ventas.ticket_id`.
5. **Reversión de un documento `sale` desde la web:** SP3 permite revertir cualquier documento, y el principio de único escritor pide que una venta solo la corrija su caja. SP5 rechaza esa reversión para `sale`.
6. **Escrituras no atómicas en mobile:** `registerEntry` y sus variantes no son transaccionales; el op-log lo exige (T7a).
7. **Ventas sincronizadas y puntos archivados:** ADR 0004 §4 descarta puntos archivados al resolver permisos, así que una venta hecha antes del archivado se rechazaría por permisos actuales; D2 la acepta por *lease*.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| La migración de ids corrompe datos instalados | Spike T1 sobre una copia real; SQL pura y transaccional; `foreign_key_check` y conteos; copia previa de 30 días; equivalencia de reportes antes/después |
| La cola pierde una venta | Misma transacción SQLite; nada se borra por error; tests de propiedades y simulación con fallas |
| SP3/SP4 se deslizan y SP5 no puede empezar en servidor | Los spikes, `packages/sync`, T7a y la migración de ids no dependen de la API; se adelantan en cuanto SP4 esté en `main` |
| El segundo plano no corre en iOS/Android | El sync principal es en primer plano; el segundo plano es un extra |
| Divergencia de utilidad caja/web | D6 explícito y explicado en la UI |
| El calendario de 5 semanas no alcanza (SP5 es el más incierto) | Orden de recorte abajo; el gate de docs/20 se cumple con lo que queda |

## Recortes si se pasa del calendario

En este orden (cada uno deja el gate de docs/20 intacto):

1. **Onboarding automático** (T12): el Owner carga el catálogo en la web (SP3) y la caja se vincula vacía.
2. **Segundo plano** (parte de T13a): solo sync en primer plano.
3. **Sync de entradas y salidas** desde la caja: en una caja vinculada se deshabilitan y se hacen en la web; la caja solo vende.
4. **Corrección de ventas sincronizadas** (`sale.correct`): editar se deshabilita tras sincronizar; anular entera sigue (`sale.void`).
5. **Adopción** de operaciones rechazadas: solo "Descartar" y exportar el respaldo.
6. **Marcas en la web** (T15): los flags quedan en la base y en el audit.

## Entregables de documentación

- **ADR 0009** · Protocolo de sync de mobile: op-log de comandos, push por lotes idempotente, pull por instantánea, conflictos y *lease* de permisos offline.
- **ADR 0010** · Migración de los ids de mobile a UUIDv7 por SQL con copia previa.
- Enmiendas al **ADR 0006** (venta sincronizada con `stock_shortfall`; `sale` no se revierte desde el endpoint de inventario), al **ADR 0004** (*lease*, throttler `device`) y al **ADR 0007** (flags de venta).
- `CLAUDE.md` (módulo `sync`, `packages/sync`, op-log), README (cómo probar el sync con dos dispositivos), docs/20 (estado).

## Gate de salida (de docs/20, detallado)

- **UUIDv7 en mobile con la suite financiera en verde:** migración `0004` aplicada en un dispositivo real con datos de producción copiados; los 96 tests (más los nuevos) en verde con los umbrales de cobertura; restauración de un respaldo viejo probada.
- **Op-log y push/pull idempotente:** tests de propiedades y simulación de dos dispositivos en verde; integración contra la API real con reintentos, `duplicate` y orden.
- **Catálogo descargado de solo lectura:** la caja vinculada muestra el catálogo y los precios del punto desde el pull y no permite editarlos.
- **Ventas offline que sincronizan:** en un dispositivo real en modo avión, ventas, una anulación y una edición llegan una sola vez al servidor y se ven en `/tablero` en su día real; dos cajas que venden la última unidad dejan el stock en −1 marcado.
- **Política de permisos revocados offline:** D2 (o la opción que elija el dueño) escrita en este spec y en el ADR 0009, con tests de integración de cada rama (lease válido, vencido, inválido, anulación sin permiso actual, dispositivo revocado y adopción).
- `openapi.json` y los `schema.d.ts` de web y mobile regenerados; CI verde.
