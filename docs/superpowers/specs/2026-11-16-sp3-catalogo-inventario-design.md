# SP3 · Catálogo e inventario — diseño

> Spec del sub-proyecto SP3 de la Etapa 2. Parte del [spec de la Etapa 2](2026-07-11-etapa2-plataforma-multinegocio-design.md) (catálogo central con precio y stock por punto, único escritor por dato, stock derivado con `@monaco/domain`) y de lo construido en SP2 (IAM, `TenantUnitOfWork`, `authorize`, RLS con FK compuestas, auditoría, back-office web). Calendario y gate de salida en [docs/20](../../20-plan-etapa2.md). El plan tarea por tarea está en [plans/2026-11-16-sp3-catalogo-inventario.md](../plans/2026-11-16-sp3-catalogo-inventario.md). La decisión de arquitectura nueva queda en el [ADR 0006](../../adr/0006-libro-de-inventario.md).

## Objetivo

Que un negocio tenga un **catálogo central** de productos, con precio opcional **por punto de venta**, y un **inventario por punto** cuyo stock se **deriva de un libro de movimientos** (nunca de un contador almacenado). Desde la web se registran entradas, salidas, ajustes y transferencias entre puntos, con *permiso + punto* validado en cada caso de uso y RLS como segunda barrera. Mobile no cambia en SP3: el modelo queda listo para que SP5 lo sincronice.

## Alcance

**Entra:**

- Productos del catálogo central: alta, edición, archivado, búsqueda y listado paginado.
- Precio por punto: un override opcional del precio base del catálogo.
- Libro de movimientos por punto: entradas (con costo), salidas (merma, retiro del dueño), ajustes con signo, transferencias entre puntos y reversión de un documento completo.
- Stock por punto derivado del libro con las reglas de `@monaco/domain`; regla de **stock no negativo**.
- Costo promedio ponderado por punto, con las funciones de `@monaco/domain`.
- Permisos nuevos de lectura, auditoría de cada documento, contratos en `packages/contracts`, pantallas del back-office y tests (unitarios, integración con Testcontainers, e2e).

**No entra (non-goals):**

- Ventas, anulación de ventas y cierre de caja: llegan con la caja mobile (SP4/SP5). SP3 solo deja el lugar del tipo `sale` en el libro (ver "Compatibilidad hacia adelante").
- Dashboard y KPIs (SP4). Login mobile (SP4) y sync offline (SP5).
- SKU, códigos de barras, variantes, lotes y vencimientos por punto, proveedores, órdenes de compra, recuento físico guiado e importación masiva. Ninguno aparece en el spec de la Etapa 2.
- Conversión entre monedas.
- Transferencias en dos pasos (envío y recepción con stock "en tránsito"): ver D6.
- Migrar los datos locales actuales de la app mobile (supuesto del spec de la Etapa 2).

## Punto de partida verificado en el código

| Hecho | Dónde |
|---|---|
| El stock de mobile es `SUM(movimientos con signo) − ventas`; el signo sale de `POSITIVE_MOVEMENT_TYPES = ['entrada', 'ajuste']` (el `ajuste` lleva cantidad con signo). | `packages/domain/src/stock.ts`, `apps/mobile/db/queries.ts:12` |
| El costo promedio de mobile se guarda en `productos.costo_promedio`, se mezcla al registrar una entrada con `blendAverageCost` y se recalcula desde cero con `weightedAverageCost` al editar o anular. Las salidas no lo cambian. | `packages/domain/src/average-cost.ts`, `apps/mobile/db/movements.ts:16`, `apps/mobile/db/queries.ts:64-111`, comentario de `registerOutflow` en `apps/mobile/db/movements.ts:146` |
| Mobile anula movimientos con un flag (`anulado`) y los edita en el lugar (`updateOutflow`). | `apps/mobile/db/movements.ts:108,209,170` |
| Precios y cantidades de mobile son `REAL` en unidades mayores; el precio de transferencia lo propone `calculateTransferPrice` (recargo y redondeo a 5 unidades). | `apps/mobile/db/schema.ts`, `apps/mobile/app/catalog/[id].tsx:127` |
| `Money` en contracts es un entero en **unidades menores** más `currency` (`CUP`/`USD`/`MLC`). | `packages/contracts/src/common/money.ts` |
| `Uuid` en contracts exige **UUIDv7** en minúsculas. El generador vive en la API y usa `node:crypto`. | `packages/contracts/src/common/uuid.ts`, `apps/api/src/infrastructure/db/uuidv7.ts` |
| Los permisos `catalog:write`, `inventory:write` e `inventory:transfer` ya existen; Manager los tiene, Cashier no tiene ninguno de lectura de stock. | `packages/contracts/src/iam/permissions.ts`, `apps/api/src/modules/iam/domain/system-roles.ts` |
| `can`, `authorize` y `hasPermissionAnywhere` son la regla de permisos. | `apps/api/src/modules/iam/domain/permissions.ts` |
| `apps/api` **no depende hoy de `@monaco/domain`** (solo de `@monaco/contracts`). | `apps/api/package.json` |
| Los roles de sistema solo se siembran al crear un tenant o en el seed (`ensureSystemRoles`); no hay mecanismo para agregar un permiso a los roles de tenants existentes. | `apps/api/src/scripts/provisioning.ts:41` |
| El filtro global traduce 23503 → 404 y 23505 → 409 genéricos; los errores de dominio IAM se mapean en `auth-http-errors.ts`. | `apps/api/src/common/http/all-exceptions.filter.ts:92`, `apps/api/src/modules/iam/http/auth-http-errors.ts` |
| La navegación del back-office se deriva de `GET /me`; las rutas de la web están en español (`/puntos-de-venta`, `/usuarios`). | `apps/web/src/lib/navigation.ts`, `apps/web/src/app/(backoffice)/` |

## Decisiones

| Tema | Decisión | Por qué |
|---|---|---|
| Libro de inventario | Tablas **append-only**: `inventory_documents` (cabecera) e `inventory_movements` (líneas). `monaco_app` solo tiene `INSERT` y `SELECT` sobre ellas. Ningún movimiento se edita ni se borra; una corrección es un **documento de reversión** (D8) | Historia completa y auditable; el spec de la Etapa 2 quiere un dominio *append-mostly* para que SP5 no tenga conflictos de sync |
| Stock derivado | El stock de un (punto, producto) es `SUM(quantity_delta)` de sus movimientos. `quantity_delta` se calcula **al escribir** con `movementDelta(kind, quantity)` de `@monaco/domain`, la única fuente del signo de cada tipo. No existe columna de stock | Lo pide el spec de la Etapa 2 ("suma de movimientos, nunca contador almacenado"). Guardar el delta con signo hace que la suma en SQL sea trivial y que la regla de signo no se repita en SQL (en mobile sí se repite: `queries.ts:12`) |
| Tipos de movimiento | `entry`, `shrinkage`, `owner_withdrawal`, `adjustment` (con signo), `transfer_out`, `transfer_in`, `reversal` (con signo, el opuesto exacto de la línea revertida). Los valores en la DB y la API van en inglés. `@monaco/domain` publica el mapeo con los tipos de mobile (`entrada`, `merma`, `retiro_owner`, `ajuste`) para SP5 | Regla de nombres de `CLAUDE.md`; mobile no cambia |
| Stock no negativo | Ningún documento puede dejar un (punto, producto) con stock < 0, **incluidos los ajustes y las reversiones**. La regla es una función pura de `@monaco/domain` (`assertStockNotNegative`) y la aplica el caso de uso **después de tomar el lock** del par (ver "Concurrencia"). No hay trigger en la DB | Una sola implementación de la regla (docs/20: "dominio único"). El lock garantiza que la suma leída no cambie hasta el commit |
| Concurrencia | Una fila por (punto, producto) en `location_products` hace de **mutex**: el caso de uso la crea si falta (`INSERT … ON CONFLICT DO NOTHING`) y la bloquea con `SELECT … FOR UPDATE`, siempre en **orden determinista** `(location_id, product_id)`. Aislamiento `READ COMMITTED` (el de `withTenant`) | Serializa solo lo que compite (mismo producto en el mismo punto). El orden fijo evita deadlocks, también en transferencias cruzadas A→B y B→A. Detalle y alternativas en el ADR 0006 |
| Idempotencia | Cada comando de escritura de inventario trae el `id` (UUIDv7) del documento, generado por el cliente. Si ya existe con el mismo `payload_hash` (SHA-256 del cuerpo normalizado **tal como lo envió el cliente, antes de aplicar defaults del servidor**, como `occurredAt = now()`; si no, un reintento sin `occurredAt` daría siempre `409`), se devuelve el documento existente con `200`; si existe con otro contenido, `409 IDEMPOTENCY_CONFLICT` | Un doble envío o un reintento de red no duplica stock. Es el mismo modelo que necesita el op-log de SP5 (ids generados en el dispositivo) |
| Costo promedio | Por (punto, producto), guardado en `location_products.average_cost` como proyección del libro. Una entrada lo mezcla con `blendAverageCost` (con el stock vigente en ese momento); una transferencia entrante lo mezcla en el destino con el costo promedio del origen; las salidas, los ajustes y las reversiones no lo mezclan. La **única recalculación** es `replayAverageCost` de `@monaco/domain`: un replay determinista del libro de ese (punto, producto), en orden de inserción, que lleva el stock acumulado y aplica `blendAverageCost` en cada `entry` y `transfer_in`, **excluyendo los documentos revertidos y sus reversiones**. Se usa al revertir un documento que contiene `entry` o `transfer_in` en ese par, y un test comprueba que, sin reversiones, el replay coincide con la proyección incremental. Revertir una transferencia recalcula así el costo del **destino** (queda como si la transferencia no hubiera existido); el origen no cambia, porque `transfer_out` no mueve el costo. `weightedAverageCost` no se usa para esto: ignora el consumo y las transferencias entrantes. Cada movimiento guarda su `unit_cost` (snapshot) para valorar pérdidas y transferencias en SP4 (D4) | Reutiliza `@monaco/domain` sin duplicar reglas. Mismo comportamiento que mobile |
| Precio por punto | El producto tiene precios base (`cash_price`, `transfer_price` opcional) y cada punto puede fijar un override de cualquiera de los dos. El precio efectivo es `override ?? base`. La web propone el precio de transferencia con `calculateTransferPrice`, igual que mobile; la API guarda lo que se envía (D3) | "Precio opcional por punto" del spec de la Etapa 2; la regla de propuesta ya existe en el dominio |
| Escritura del catálogo | Crear, editar y archivar productos exige `catalog:write` **con alcance tenant**. `catalog:write` con alcance de puntos solo permite fijar el precio de **esos** puntos (D14) | El catálogo es central: un Manager de un punto no puede cambiar el producto de todos los puntos |
| Lectura | Dos permisos nuevos con alcance por punto: `catalog:view` (catálogo y precios del punto) e `inventory:view` (stock y movimientos del punto). Los costos solo se devuelven a quien tiene `catalog:write` o `inventory:write` en ese alcance (D9, D10) | "Cada acción es un permiso" (spec de la Etapa 2) y el Cashier "ve el stock de su punto" |
| Unidad de trabajo | Cada módulo nuevo define su puerto (`CatalogUnitOfWork`, `InventoryUnitOfWork`) con adaptador sobre `withTenant`, como `AdminUnitOfWork`. Ningún repositorio se usa fuera de una unidad de trabajo | Regla de SP2 y ADR 0003 |
| Cantidades | `numeric(14,3)` en Postgres; `number` con como mucho 3 decimales en los contratos (`Quantity`) (D1) | Mobile vende por kg y litro; tres decimales cubren gramos y mililitros. La aritmética de stock del dominio (`assertStockNotNegative`, sumas y comparaciones) opera en **milésimas enteras** (`Math.round(q * 1000)`), nunca en flotantes: retirar 0.3 tras entradas de 0.1 y 0.2 no debe dar `-2.7e-17` ni un falso `INSUFFICIENT_STOCK` |
| Importes | Enteros en unidades menores (`bigint`) más la moneda del producto. El costo promedio, que puede tener fracción de centavo, se guarda como `numeric(20,6)` en unidades menores y se expone redondeado como `Money` (D2) | ADR 0002 ya prevé un esquema aparte para precisión sub-centavo en vez de cambiar `Money` |

## Modelo de datos (Postgres)

Todas las tablas siguen ADR 0003: `tenant_id uuid not null` con índice, `tenantIsolationPolicy('<tabla>')` en Drizzle, `FORCE ROW LEVEL SECURITY` en una migración custom, PK UUIDv7 generada en la aplicación (o por el cliente, en los documentos), `UNIQUE (id, tenant_id)` en las tablas padre y **FK compuestas** `(x_id, tenant_id)` en toda referencia entre tablas de tenant. Timestamps `timestamptz`.

| Tabla | Columnas clave | Restricciones e índices | Privilegios de `monaco_app` |
|---|---|---|---|
| `products` | `id`, `tenant_id`, `name`, `unit_of_measure`, `category` (null), `currency`, `cost_price` (bigint, null), `cash_price` (bigint, null), `transfer_price` (bigint, null), `low_stock_threshold` (numeric(14,3), null), `expiration_date` (date, null), `archived_at`, `created_at`, `updated_at` | `UNIQUE (id, tenant_id)`. `CHECK` de `unit_of_measure` contra `UNITS_OF_MEASURE` y de `category` contra `CATEGORIES` (ambos de `@monaco/domain`, generados como el CHECK de permisos), `currency IN ('CUP','USD','MLC')`, importes ≥ 0, umbral ≥ 0. Índice `(tenant_id, lower(name))` para búsqueda y `(tenant_id, archived_at)` | `SELECT`, `INSERT`, `UPDATE`; sin `DELETE` (se archiva) |
| `location_products` | `tenant_id`, `location_id`, `product_id`, `cash_price_override` (null), `transfer_price_override` (null), `average_cost` (numeric(20,6), default 0), `updated_at` | PK `(tenant_id, location_id, product_id)`. FK compuestas a `locations (id, tenant_id)` y `products (id, tenant_id)`. Overrides ≥ 0. Es a la vez la fila de precio por punto, la proyección del costo promedio y el **mutex** del par | `SELECT`, `INSERT`, `UPDATE`; sin `DELETE` |
| `inventory_documents` | `id` (del cliente), `tenant_id`, `kind` (`entry`/`exit`/`adjustment`/`transfer`/`reversal`), `location_id`, `target_location_id` (solo `transfer`), `reason` (solo `exit`: `shrinkage`/`owner_withdrawal`), `reverses_document_id` (solo `reversal`), `occurred_at`, `notes` (≤ 500), `payload_hash`, `created_by`, `created_at` | `UNIQUE (id, tenant_id)`. FK compuestas a `locations` (ambas), a `users (created_by)` y a sí misma (`reverses_document_id`). `CHECK`s de forma por `kind` (transfer con destino ≠ origen; reason solo en exit; etc.). **`UNIQUE (tenant_id, reverses_document_id)`**: un documento se revierte una sola vez. Índice `(tenant_id, location_id, created_at, id)` | `SELECT`, `INSERT` (append-only) |
| `inventory_movements` | `id`, `tenant_id`, `document_id`, `location_id`, `product_id`, `kind`, `quantity_delta` (numeric(14,3), ≠ 0), `unit_cost` (numeric(20,6), ≥ 0), `reverses_movement_id` (null), `created_at` | FK compuestas a `inventory_documents`, `location_products (tenant_id, location_id, product_id)` (así cada movimiento tiene su fila de lock) y a sí misma. `CHECK` de `kind`, y de signo por tipo como **defensa en profundidad** (`entry`/`transfer_in` > 0; `shrinkage`/`owner_withdrawal`/`transfer_out` < 0). Índice **`(tenant_id, location_id, product_id) INCLUDE (quantity_delta)`** para la suma; `(tenant_id, document_id)` | `SELECT`, `INSERT` (append-only) |

Notas:

- **Sin `DELETE` ni `UPDATE` en el libro.** `schema-guards.test.ts` amplía su matriz de privilegios con estas cuatro tablas, igual que fija hoy la de `audit_events`.
- **Los CHECK de signo no son la regla**: la regla es `movementDelta` en el dominio. El CHECK solo impide que un bug inserte un signo imposible. No se duplica la regla de stock no negativo, que necesita una suma y no cabe en un CHECK.
- **Producto archivado:** no recibe entradas, transferencias ni override de precio; sí admite salidas, ajustes y reversiones para poder llevar su stock a cero. **Punto archivado (D15):** admite salidas, ajustes y `transfer_out` (para vaciar su stock), pero no entradas ni `transfer_in`. Los dos se leen con `FOR SHARE` dentro de la transacción del documento, así que un archivado concurrente espera o hace esperar (supuesto: detalle de diseño, no lo fija el spec de la Etapa 2).
- **Invariante movimiento/documento:** nada en el esquema ata `inventory_movements.location_id` a los puntos del documento (`location_id`/`target_location_id`); una FK compuesta exigiría una tabla auxiliar de puntos por documento, que no se justifica. Se cubre con un **test de integración** que, tras cada tipo de documento, comprueba que todo movimiento está en un punto del documento (`transfer_out` en `location_id`, `transfer_in` en `target_location_id`, el resto en `location_id`) y que el caso de uso autorizó ese punto.
- **Fechas:** `occurred_at` es la fecha de negocio que informa el usuario (por defecto, ahora; no puede estar en el futuro). El orden del libro y del costo promedio es el de inserción (`created_at`, y el lock), no `occurred_at` (D13).
- **Rendimiento:** con el índice de la suma, el stock de un punto es un `GROUP BY product_id` sobre un índice cubriente. Si en SP4 el `EXPLAIN` de los reportes lo pide, se agregan snapshots periódicos como proyección (ADR 0006); en SP3 no.

## Cómo funciona un documento de inventario

Todo comando de escritura (entrada, salida, ajuste, transferencia, reversión) sigue el mismo guion, en una sola transacción de `withTenant`:

1. **Validar** el cuerpo con el contrato (líneas 1..100, productos no repetidos dentro del documento, cantidades > 0 salvo en ajustes, donde ≠ 0).
2. **Autorizar** antes de tocar datos: `authorize(actor, permiso, punto)` por cada punto que el documento modifica (ver "Permisos").
3. **Idempotencia:** `INSERT INTO inventory_documents … ON CONFLICT (id) DO NOTHING RETURNING id`. Para una reversión, la violación de `UNIQUE (tenant_id, reverses_document_id)` (23505, con un `id` distinto) se captura en el caso de uso y se traduce a `409 ALREADY_REVERSED`, no a un `409` genérico del filtro global. Si el insert de la cabecera no inserta, la transacción concurrente con el mismo id ya terminó (el índice único hace esperar): se lee el documento; si su `payload_hash` coincide, se responde con él (`200`), y si no, `409 IDEMPOTENCY_CONFLICT`. Si el id pertenece a otro tenant, RLS lo oculta y la respuesta es la misma `409`, sin revelar nada.
4. **Bloquear:** leer los productos y puntos con `FOR SHARE` (archivado), crear las filas faltantes de `location_products` y bloquear todas las del documento con `FOR UPDATE`, ordenadas por `(location_id, product_id)`. Una transferencia bloquea las del origen y las del destino en ese mismo orden global.
5. **Leer el stock** de los pares bloqueados (`SUM(quantity_delta)`) y el costo promedio.
6. **Calcular en el dominio:** deltas con `movementDelta`, stock resultante y `assertStockNotNegative` por par; costo promedio con `blendAverageCost` / `weightedAverageCost`; `unit_cost` de cada línea.
7. **Escribir** los movimientos, actualizar `location_products.average_cost`, registrar el `audit_event` y hacer commit.

Una transferencia es **un solo documento** con dos movimientos por línea (`transfer_out` en el origen y `transfer_in` en el destino), así que es atómica: o se mueven todas las líneas o ninguna. Una reversión crea un documento `reversal` cuyas líneas son el opuesto exacto de las del original (en todos los puntos que tocó), y pasa por la misma regla de stock no negativo: no se puede revertir una entrada cuyo stock ya salió.

## Decisiones abiertas

El spec de la Etapa 2 y docs/20 no fijan estos puntos. El resto del documento **asume el default recomendado** de cada uno; si se elige otra opción, cambian las secciones indicadas. D1–D14 vienen de la revisión de diseño inicial; D15 se agregó en la segunda revisión.

| # | Decisión | Opciones y tradeoffs | Default recomendado (supuesto) |
|---|---|---|---|
| D1 | Representación de cantidades | (a) `numeric(14,3)` + `number` en contratos: natural para kg/litro, compatible con las funciones del dominio (que reciben `number`); (b) enteros en milésimas: aritmética exacta, pero cada cliente convierte y el dominio también | (a), con comparaciones del dominio en milésimas enteras |
| D2 | Moneda | (a) una `currency` por producto, que aplica a todos sus precios y overrides; (b) una moneda por tenant: hay que cambiar `tenants`, cuyo `UPDATE` hoy está limitado a `name` (ADR 0003 §9); (c) moneda en cada importe: mezcla monedas dentro de un producto | (a), sin conversión entre monedas |
| D3 | Precio de transferencia | (a) guardarlo explícito (base y override), con la propuesta de `calculateTransferPrice` solo en la UI, como mobile; (b) derivarlo siempre del efectivo: pierde los precios ajustados a mano | (a). Para usar `calculateTransferPrice` con unidades menores, `@monaco/domain` agrega `toMinorUnits`/`fromMinorUnits` y una variante en unidades menores, sin cambiar la existente |
| D4 | Alcance del costo promedio | (a) por (punto, producto): cada punto valora su propio stock y una transferencia lleva el costo del origen; (b) uno por producto en todo el tenant: más simple, pero mezcla costos de puntos que compran distinto | (a) |
| D5 | Disponibilidad de productos por punto | (a) todo producto activo está disponible en todo punto activo (stock 0 si nunca tuvo movimientos); (b) habilitación explícita por punto: más control, más pantallas | (a). `location_products` se crea de forma perezosa |
| D6 | Forma de las transferencias | (a) un paso, atómica; (b) dos pasos (envío, recepción, stock en tránsito y diferencias): más real, bastante más alcance | (a). Dos pasos queda fuera de SP3 |
| D7 | Permiso de una transferencia | (a) `inventory:transfer` en el origen **y** en el destino; (b) solo en el origen: un Manager de A podría empujar stock a un punto que no gestiona | (a) |
| D8 | Correcciones | (a) reversión del documento completo; (b) solo ajustes: no corrige el costo de una entrada mal cargada; (c) editar o anular en el lugar, como mobile: rompe el libro append-only | (a), reversión de un documento como máximo una vez |
| D9 | Permisos de lectura | (a) `catalog:view` e `inventory:view` nuevos, por punto; `inventory:write`/`inventory:transfer` implican `inventory:view` y `catalog:write` implica `catalog:view` dentro de los casos de uso (sin backfill de roles personalizados); (b) leer con cualquier permiso del punto, como `GET /locations`: no agrega permisos pero no es "una acción, un permiso" | (a). Owner: todos; Manager y Cashier: ambos. La implicación evita que un rol personalizado con `write` no pueda leer su propio documento |
| D10 | Visibilidad de costos | (a) `cost_price`, `average_cost` y `unit_cost` solo para quien tiene `catalog:write` o `inventory:write` en ese alcance; (b) un permiso `inventory:cost` aparte; (c) visibles para todo lector | (a) |
| D11 | Cómo llegan los permisos nuevos a los roles de sistema de tenants existentes | (a) migración de datos que, en su transacción y como `monaco_owner`, hace `NO FORCE` en `roles` y `role_permissions`, inserta los permisos que falten en los roles de sistema (`ON CONFLICT DO NOTHING`) y vuelve a `FORCE` antes del commit; (b) un comando CLI por tenant: `monaco_owner` no puede listar tenants bajo `FORCE` (ADR 0003, Consecuencias), así que habría que pasar cada id a mano; (c) una función `SECURITY DEFINER` nueva: otra puerta sin tenant | (a), **idempotente y re-ejecutable**: si corre antes de desplegar el código nuevo, un tenant creado por el `ensureSystemRoles` viejo queda sin los permisos nuevos y se vuelve a correr la migración de datos; además un test de integración falla si algún rol de sistema difiere de `SYSTEM_ROLES`. El owner ya podía desactivar RLS como dueño de las tablas (ADR 0003 §8), el cambio es transaccional y un test verifica que `FORCE` sigue activo después. Se documenta en ADR 0005 |
| D12 | Categorías | (a) la lista fija `CATEGORIES` de `@monaco/domain`, la misma de mobile; (b) categorías por tenant en una tabla | (a). Categorías por tenant, más adelante |
| D13 | Fecha del movimiento y orden del costo | (a) `occurred_at` informativa, sin futuro; el costo se calcula en orden de inserción; (b) permitir carga retroactiva que recalcula el costo de todo lo posterior | (a) |
| D14 | Alcance de `catalog:write` | (a) productos solo con alcance tenant; con alcance de puntos, solo el precio de esos puntos; (b) cualquier `catalog:write` edita el catálogo central | (a). Consecuencia: el Manager de sistema (alcance de puntos) fija precios de sus puntos pero no crea productos |
| D15 | Punto archivado con stock | (a) admite salidas, ajustes y `transfer_out` desde él, pero no entradas ni `transfer_in`: su stock puede vaciarse; (b) bloquear el archivado mientras tenga stock: obliga a vaciar antes y cambia el flujo de SP2 | (a) |

## Permisos

Catálogo v1 + dos códigos nuevos (D9): **`catalog:view`** e **`inventory:view`**. Ninguno es administrativo (valen con alcance de puntos).

| Rol de sistema | Cambia |
|---|---|
| Owner | Recibe los dos nuevos (tiene todos) |
| Manager | + `catalog:view`, `inventory:view` |
| Cashier | + `catalog:view`, `inventory:view` |

Agregarlos sigue el procedimiento de `CLAUDE.md` ("Adding a permission"): `PERMISSIONS`, migración del `CHECK` de `role_permissions` con `db:generate`, `SYSTEM_ROLES`, etiquetas de la web (`PERMISSION_LABELS` y grupos en `apps/web/src/lib/permissions.ts`), regeneración de OpenAPI y del cliente, y la migración de datos de D11.

| Acción | Regla en el caso de uso |
|---|---|
| Listar o ver productos | Con `locationId`: `catalog:view` en ese punto (devuelve precios efectivos del punto). Sin `locationId`: `hasPermissionAnywhere(catalog:view)` (devuelve precios base) |
| Crear, editar o archivar un producto | `catalog:write` con alcance tenant (`authorize(actor, 'catalog:write')` sin punto) |
| Fijar el precio de un punto | `catalog:write` en ese punto |
| Ver stock y movimientos de un punto | `inventory:view` en ese punto |
| Ver el stock de un producto en todos los puntos | Se devuelven solo los puntos donde el actor tiene `inventory:view` |
| Entrada, salida, ajuste | `inventory:write` en el punto |
| Transferencia | `inventory:transfer` en el origen **y** en el destino (D7) |
| Revertir | El permiso del documento original en **cada** punto que tocó |
| Costos en la respuesta | `catalog:write` **o** `inventory:write` en ese alcance: cualquiera de los dos muestra los tres costos (`cost_price`, `average_cost` y `unit_cost`), según la opción (a) de D10 |

**Implicación de lectura (D9):** en cada caso de uso, `inventory:write` o `inventory:transfer` en un punto cuentan también como `inventory:view` en ese punto, y `catalog:write` como `catalog:view`. Así un rol personalizado (`roles.is_system = false`) que ya tenía `write` lee lo que escribe, sin migrar sus permisos. Un test de integración lo cubre con un rol personalizado.

**Enmascarado entre puntos:** en `GET /locations/:id/inventory-movements` y en el detalle de un documento, el nombre e id del **otro** punto de una transferencia se devuelven solo si el actor tiene `inventory:view` en él; si no, se muestra el movimiento propio con el otro punto como "otro punto" (sin id ni nombre).

Como en SP2: `@RequirePermission` en el controller es un chequeo grueso; **la autoridad es el caso de uso**. Un recurso de otro tenant da 404 (RLS + FK compuestas); un punto o producto del mismo tenant fuera del alcance da 403 genérico; RLS es la segunda barrera, no la primera.

## API (REST, contratos en `packages/contracts`)

Esquemas nuevos en `packages/contracts/src/catalog/` y `src/inventory/`, todos con `.meta({ id })`: `Quantity`, `SignedQuantity`, `AverageCost` (decimal sub-centavo, ADR 0002), `Product`, `ProductWithLocationPrice`, `CreateProductRequest`, `UpdateProductRequest`, `SetLocationPriceRequest`, `StockItem`, `ProductStockByLocation`, `InventoryDocument`, `InventoryMovement`, y un request por comando. Los listados usan `PaginationQuery` + `Paginated` con cursor opaco. La lista de tipos de movimiento la define `@monaco/domain`; `packages/contracts` (que hoy solo depende de `zod`) declara su enum y un test de la API verifica que las dos listas coinciden, igual que el `CHECK` de permisos.

| Método y ruta | Permiso (autoridad en el caso de uso) | Notas |
|---|---|---|
| `GET /products` | `catalog:view` | `?q`, `?category`, `?includeArchived`, `?locationId`, paginado por `(name, id)` |
| `GET /products/:id` | `catalog:view` | `?locationId` para el precio efectivo |
| `POST /products` | `catalog:write` (tenant) | |
| `PATCH /products/:id` | `catalog:write` (tenant) | No cambia `currency` si el producto ya tiene movimientos con costo |
| `POST /products/:id/archive` | `catalog:write` (tenant) | Idempotente, como `/locations/:id/archive` |
| `PUT /locations/:locationId/products/:productId/price` | `catalog:write` (punto) | `{ cashPrice: Money \| null, transferPrice: Money \| null }`; `null` quita el override |
| `GET /locations/:locationId/stock` | `inventory:view` (punto) | `?q`, `?lowStockOnly` (umbral con `getProductThreshold` del dominio), paginado |
| `GET /products/:id/stock` | `inventory:view` (por punto) | Solo los puntos visibles para el actor |
| `GET /locations/:locationId/inventory-movements` | `inventory:view` (punto) | `?productId`, `?kind`, `?from`, `?to`, paginado por `(created_at, id)` descendente |
| `GET /inventory/documents/:id` | `inventory:view` en al menos un punto del documento | Cabecera y líneas de los puntos visibles; el otro punto se enmascara |
| `POST /inventory/entries` | `inventory:write` (punto) | `{ id, locationId, occurredAt?, notes?, lines: [{ productId, quantity, unitCost: Money }] }` |
| `POST /inventory/exits` | `inventory:write` (punto) | `{ id, locationId, reason: 'shrinkage' \| 'owner_withdrawal', … lines: [{ productId, quantity }] }` |
| `POST /inventory/adjustments` | `inventory:write` (punto) | `lines: [{ productId, quantityDelta }]` con signo, ≠ 0 |
| `POST /inventory/transfers` | `inventory:transfer` (origen y destino) | `{ id, fromLocationId, toLocationId, … lines }` |
| `POST /inventory/documents/:id/reversal` | permiso del original en cada punto | `{ id, notes? }`; una sola vez por documento |

Los `POST` de inventario responden `201` con el `InventoryDocument` creado, o `200` con el existente si es un reintento idempotente. `unitCost` debe venir en la moneda del producto.

## Errores

`ErrorResponse` con códigos estables. Los errores de dominio nuevos extienden el patrón de `IamDomainError` y se mapean junto a los de `auth-http-errors.ts`.

| Situación | HTTP | `code` |
|---|---|---|
| Sin permiso o punto fuera del alcance | 403 | `FORBIDDEN` (genérico) |
| Producto, punto o documento de otro tenant, o inexistente (incluye 23503 por FK compuesta) | 404 | `NOT_FOUND` |
| El documento dejaría stock negativo | 409 | `INSUFFICIENT_STOCK`, con `details` por `productId` (sin revelar stock de puntos fuera del alcance: solo los del documento, que el actor ya puede ver) |
| Mismo `id` con otro contenido, o `id` de otro tenant | 409 | `IDEMPOTENCY_CONFLICT` |
| Documento ya revertido (incluye la violación 23505 de `UNIQUE (tenant_id, reverses_document_id)` con otro `id`), o revertir una reversión | 409 | `ALREADY_REVERSED` |
| Producto o punto archivado para esa operación (D15) | 409 | `ARCHIVED` |
| Moneda de `unitCost` distinta a la del producto | 422 | `CURRENCY_MISMATCH` |
| Transferencia con origen = destino, líneas repetidas, cantidad 0 | 400 | `VALIDATION_FAILED` (contrato) |
| Deadlock (`40P01`) o fallo de serialización inesperado | 409 | `CONFLICT` genérico; no debería ocurrir por el orden de locks, y un test lo vigila |

## Auditoría

Tipos nuevos en `AUDIT_EVENT_TYPES` (un evento por documento, no por línea; el libro ya es el detalle): `product_created`, `product_updated`, `product_archived`, `location_price_set`, `inventory_entry_recorded`, `inventory_exit_recorded`, `inventory_adjustment_recorded`, `inventory_transfer_recorded`, `inventory_document_reversed`. `targetType` es `product` o `inventory_document`; `metadata` lleva puntos, cantidad de líneas y motivo, nunca costos. Un reintento idempotente no genera un evento nuevo.

## Web (`apps/web`, UI en español)

Rutas en español, como las de SP2, dentro de `(backoffice)`; la navegación (`navItemsFor`) muestra cada entrada según `GET /me`:

- **Catálogo** (`/catalogo`): listado con búsqueda, categoría y archivados; alta y edición (con la propuesta del precio de transferencia vía `calculateTransferPrice`); archivar. Solo con `catalog:write` tenant se ven las acciones de producto.
- **Detalle de producto** (`/catalogo/[id]`): precios por punto (editar override con `catalog:write` en el punto) y stock por punto visible.
- **Inventario** (`/inventario`): selector de punto (solo los visibles), stock con alerta de bajo stock, costo promedio si corresponde.
- **Registrar** entrada, salida, ajuste y transferencia (`/inventario/entradas/nueva`, `/salidas/nueva`, `/ajustes/nuevo`, `/transferencias/nueva`): formularios con líneas. Cada formulario lleva el `id` del documento generado **al renderizar** (campo oculto), así un doble envío es un reintento idempotente.
- **Movimientos** (`/inventario/movimientos`): libro paginado con filtros, detalle del documento y acción **Revertir** con confirmación.
- Los 403, 404, 409 (`INSUFFICIENT_STOCK`, `ARCHIVED`, `ALREADY_REVERSED`, `IDEMPOTENCY_CONFLICT`) y 422 se muestran como mensajes claros en español.

Supuesto técnico: para generar UUIDv7 en la web, el generador se mueve de `apps/api/src/infrastructure/db/uuidv7.ts` a `packages/contracts` usando `globalThis.crypto.getRandomValues` (Node 24 y navegadores), y la API lo reexporta. Así no hay dos implementaciones.

## Tests

- **Unitarios (`packages/domain`, Vitest, umbrales actuales):** `movementDelta` por tipo; `assertStockNotNegative`; costo promedio en entrada, transferencia y reversión; mapeo de tipos de mobile; conversiones a unidades menores. Un **test de propiedades** genera libros aleatorios y comprueba que la suma de `movementDelta` coincide con `deriveStock` (con `salesQuantity = 0`) **solo para los tipos que mapean por `LEGACY_MOVEMENT_KIND`** (`entry`, `shrinkage`, `owner_withdrawal`, `adjustment`), porque `stockDelta` niega todo tipo fuera de `['entrada','ajuste']` y `transfer_in`/`reversal` no tienen equivalente en mobile; para los demás tipos se compara contra una suma de referencia independiente. Incluye el caso 0.1 + 0.2 − 0.3 (milésimas enteras) y que ninguna secuencia aceptada por `assertStockNotNegative` deja un prefijo negativo. La suite de mobile sigue en verde sin cambios.
- **Unitarios de la API:** casos de uso con fakes (autorización antes de tocar datos, idempotencia, orden de locks pedido al puerto, mapeo de errores) y controllers.
- **Integración (Testcontainers, rol `monaco_app`):**
  - guard de RLS + `FORCE` y FK compuestas en las cuatro tablas; `monaco_app` no puede `UPDATE` ni `DELETE` en el libro; la matriz de privilegios de `schema-guards.test.ts`;
  - la migración de D11 (idempotente): los roles de sistema de un tenant creado antes de SP3 reciben los permisos nuevos y `FORCE` sigue activo en `roles` y `role_permissions`; el `CHECK` de permisos coincide con el catálogo;
  - **fuga entre tenants:** el tenant A contra cada endpoint con ids de B da 404 y B queda intacto; un documento con un `id` que existe en B da 409 sin efecto;
  - **fuga entre puntos:** un usuario con permisos solo en el punto 1 recibe 403 al leer stock, movimientos o documentos del punto 2, al escribir en él y al transferir hacia o desde él; `GET /products/:id/stock` no incluye el punto 2; los costos no aparecen sin `inventory:write`;
  - **concurrencia:** N salidas concurrentes que juntas superan el stock: exactamente las que caben terminan bien y el stock final es ≥ 0; transferencias simultáneas A→B y B→A del mismo producto terminan sin deadlock; dos envíos del mismo `id` en paralelo crean un solo documento;
  - **reversión concurrente:** dos reversiones del mismo documento con `id` distintos en paralelo: una pasa y la otra da `ALREADY_REVERSED`; revertir una transferencia recalcula el costo del destino con `replayAverageCost`;
  - **roles:** un rol personalizado con `inventory:write` y sin `inventory:view` lee lo que escribe; un test falla si algún rol de sistema difiere de `SYSTEM_ROLES`; la migración D11 se puede correr dos veces; un punto 1 no ve el nombre del punto 2 en una transferencia;
  - **invariante movimiento/punto** (ver Notas del modelo) y punto archivado: salida, ajuste y `transfer_out` pasan, entrada y `transfer_in` dan `ARCHIVED`;
  - idempotencia (un reintento sin `occurredAt` da `200`), reversión (una sola vez, y rechazada si deja stock negativo), producto y punto archivados, costo promedio contra los valores del dominio.
- **E2E (Playwright, `apps/web/e2e`):** el Manager del seed (asignado al punto 1) registra una entrada en su punto; el Owner registra una transferencia y ve el stock resultante en los dos puntos; una salida que excede el stock muestra el error; el Cashier ve el stock de su punto y no ve acciones de escritura (y la API le da 403); revertir una entrada.

## Seguridad

- **Permiso + punto en cada caso de uso**, antes de tocar datos; el tenant sale siempre del `Actor`, nunca del cuerpo. RLS con `FORCE` y FK compuestas como segunda barrera.
- **Libro append-only a nivel de privilegios** (`INSERT`/`SELECT`), no solo por convención: ni un bug ni una inyección SQL con `monaco_app` pueden reescribir la historia.
- **Sin oráculos entre tenants:** 404 idéntico para inexistente y ajeno; `IDEMPOTENCY_CONFLICT` idéntico para un id ajeno o un payload distinto. Los ids de documento son UUIDv7 no adivinables.
- **Sin oráculos entre puntos:** `INSUFFICIENT_STOCK` solo informa de pares del propio documento, que el actor ya está autorizado a tocar.
- **Costos** solo para quien escribe catálogo o inventario en ese alcance (D10).
- **Límites:** 100 líneas por documento, `notes` ≤ 500 caracteres, cantidades y precios acotados por el contrato. Las operaciones de inventario no necesitan rate limit propio en SP3 (están autenticadas y auditadas); se revisa en SP4 con la demo pública.
- **Migración D11:** el `NO FORCE` vive solo dentro de la transacción de la migración; un test verifica que `FORCE` queda activo.

## Compatibilidad hacia adelante

- **SP4 (dashboard):** cada movimiento guarda `unit_cost`, `kind` y `occurred_at`, que alcanzan para valorar mermas, retiros y transferencias por punto y por fecha. El índice por `(location_id, created_at)` sirve a los listados; si los reportes lo piden, se agregan snapshots de stock como proyección sin cambiar el libro. El seed demo de SP3 deja productos y movimientos para los KPIs.
- **SP5 (sync offline):**
  - Las ventas entran al mismo libro como movimientos `sale` (negativos), escritos por la caja de su punto, bajo el mismo lock por (punto, producto). `deriveStock` ya admite las ventas aparte; el tipo `sale` se agrega al dominio en SP5.
  - **Único escritor por dato:** el catálogo lo escribe el back-office; cada movimiento tiene un único escritor (quien lo crea, con su id). La web y la caja pueden registrar movimientos del mismo punto sin conflicto porque nunca editan filas existentes; el stock es una suma.
  - Los documentos ya usan **ids UUIDv7 generados por el cliente** y son idempotentes por id + hash: el push del op-log reutiliza estos endpoints o sus casos de uso.
  - Mobile hoy edita y anula movimientos en el lugar; SP5 traduce eso a reversiones. El mapeo de tipos (`entrada` → `entry`, etc.) ya está en el dominio.
  - Ventas offline que lleven el stock bajo cero: la política (aceptar y marcar, o rechazar al sincronizar) la define SP5; SP3 mantiene la regla estricta para escrituras online.
  - El catálogo descargado de solo lectura sale de `GET /products?locationId=…` paginado.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Deadlocks o stock negativo bajo concurrencia | Orden global de locks, tests de concurrencia dedicados, regla en el dominio aplicada después del lock (ADR 0006) |
| La suma del stock se vuelve lenta | Índice cubriente; snapshots como proyección solo si `EXPLAIN` lo pide en SP4 |
| La migración D11 deja una tabla sin `FORCE` | Todo en una transacción y un test de integración que verifica `FORCE` después de migrar |
| Reglas de precio o costo duplicadas en la API | Todo cálculo pasa por `@monaco/domain`; revisión de PR y lint de fronteras de SP1 |
| SP3 cae sobre las fiestas (docs/20) | Las transferencias y reversiones son una tarea aparte (T6 del plan, con sus pantallas en T8b) que puede pasar al inicio de SP4 sin bloquear el resto |

## Entregables de documentación

- **ADR 0006** · Libro de inventario append-only, stock derivado, lock por (punto, producto) e idempotencia por id del cliente.
- Actualizar **ADR 0003** (tablas nuevas y su matriz de privilegios) y **ADR 0005** (`catalog:view`, `inventory:view`, alcance de `catalog:write`, procedimiento D11).
- `CLAUDE.md`: cómo agregar un tipo de movimiento.

## Gate de salida (de docs/20, detallado)

- Catálogo central con precio base y override por punto; CRUD de productos desde la web con `catalog:write` tenant, y precio por punto con `catalog:write` en ese punto.
- Stock por punto derivado del libro con `@monaco/domain`, sin columna de stock; test de propiedades del dominio y comparación con la suma en Postgres.
- Entradas, salidas, ajustes y transferencias entre puntos desde la web, atómicas e idempotentes; reversión de documentos.
- Stock no negativo garantizado bajo concurrencia, con test; sin deadlocks en transferencias cruzadas, con test.
- Permisos aplicados por punto en cada caso de uso: un Cashier del punto 1 ve el stock de su punto, recibe 403 en el punto 2 y en toda escritura; 404 en recursos de otro tenant. Test de fuga entre tenants y entre puntos por cada endpoint.
- Las tablas nuevas pasan el guard de RLS + `FORCE` y la matriz de privilegios (libro append-only). Los roles de sistema de tenants existentes reciben los permisos nuevos.
- `openapi.json` y `schema.d.ts` regenerados; CI verde, incluido el job `e2e` con los flujos de inventario; la suite financiera de mobile sin cambios y en verde.
