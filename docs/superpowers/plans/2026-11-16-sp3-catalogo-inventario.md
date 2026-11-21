# SP3 · Catálogo e inventario: plan de implementación

> **Para agentes:** el diseño completo, las decisiones abiertas con su default y las reglas de seguridad están en el [spec de SP3](../specs/2026-11-16-sp3-catalogo-inventario-design.md). **Ese spec manda**: este plan solo ordena el trabajo y define el "Hecho cuando" de cada tarea. La estrategia de concurrencia está en el [ADR 0006](../../adr/0006-libro-de-inventario.md); el aislamiento, en el ADR 0003; la autorización, en el ADR 0005. Antes de escribir código hay que consultar la doc vigente de NestJS, Drizzle, `nestjs-zod`, Vitest y Next 16 (`node_modules/next/dist/docs/`). Cada tarea va en un PR contra `main` con CI en verde. **Ninguna regla de precio, stock o costo se escribe en `apps/api` ni en `apps/web`: va a `packages/domain`.**

**Antes de T1:** confirmar o cambiar los defaults de la sección "Decisiones abiertas" del spec (D1–D15). Si alguno cambia, se actualiza el spec y las tareas afectadas antes de empezar.

**Gate de salida:** el del spec de SP3 (sección "Gate de salida").

**Tareas críticas de seguridad o datos** (revisión más estricta, tests de integración obligatorios): **T2** (permisos y migración de roles de sistema), **T3** (esquema, RLS, privilegios), **T4** (autorización del catálogo), **T5a**, **T5b** y **T6** (libro, concurrencia, stock no negativo).

**Orden y paralelismo**

```
T1 (domain) ─────────────┐
                         ├─> T3 (DB) ─┬─> T4 (catalog API) ──> T7 (web catálogo) ─────┐
T2 (contracts + perms) ──┘            │                                               ├─> T8a (web inventario) ─┐
                                      └─> T5a (writes) ─> T5b (reads) ────────────────┘                         ├─> T9 (seed + e2e + docs)
                                              └─> T6 (transfer + reversal) ─> T8b (web transferencias/reversión) ┘
```

- **T1 ∥ T2:** superficies disjuntas (`packages/domain` + `apps/api/package.json`/`pnpm-lock.yaml` frente a `packages/contracts`, IAM, `apps/api/drizzle`, `apps/web/src/lib/permissions.ts`).
- **T4 ∥ T5a:** módulos disjuntos (`apps/api/src/modules/catalog/` frente a `.../inventory/`). Los únicos archivos compartidos son el registro en `app.module.ts` (una línea) y los generados `packages/contracts/openapi.json` y `apps/web/src/lib/api/schema.d.ts`: **el segundo PR en mergear hace rebase y los regenera**; nunca se editan a mano.
- **T7 ∥ T5a/T5b/T6:** T7 solo toca `apps/web`; T5a, T5b y T6 solo `apps/api`.
- **T8a** depende de T5b y T7; **T8b** depende de T6 y T8a. Si T6 se desliza a SP4, T8a y T9 siguen, y el e2e de transferencias y reversión se mueve a T8b.

---

### T1 · Reglas de inventario en `@monaco/domain` `M` · `Media` (en paralelo con T2)

- [ ] `packages/domain/src/inventory.ts`: `INVENTORY_MOVEMENT_KINDS` (`entry`, `shrinkage`, `owner_withdrawal`, `adjustment`, `transfer_out`, `transfer_in`, `reversal`), `movementDelta(kind, quantity)` (signo fijo por tipo; `adjustment` y `reversal` con signo, ≠ 0) y `LEGACY_MOVEMENT_KIND` (mapeo con `entrada`, `merma`, `retiro_owner`, `ajuste` de mobile).
- [ ] `assertStockNotNegative(current, deltas)` por par y su error de dominio (sin dependencias de Nest).
- [ ] Costo promedio: `averageCostAfterEntry` (sobre `blendAverageCost`), costo de una transferencia entrante y `replayAverageCost` (replay determinista del libro, entradas y `transfer_in` con el stock en cada punto, excluyendo documentos revertidos y sus reversiones) como única recalculación. Sin reimplementar las funciones existentes.
- [ ] Aritmética de stock en milésimas enteras (`assertStockNotNegative` y sumas), sin flotantes.
- [ ] Importes: `toMinorUnits` / `fromMinorUnits` y la variante de `calculateTransferPrice` en unidades menores, sin cambiar la firma de la existente (mobile la usa).
- [ ] Tests unitarios de todo lo anterior y **test de propiedades**: la suma de `movementDelta` es igual a `deriveStock(…, 0)` solo para los tipos que mapean por `LEGACY_MOVEMENT_KIND` (y contra una suma de referencia para `transfer_in`/`reversal`); ninguna secuencia aceptada deja un prefijo negativo; caso 0.1 + 0.2 − 0.3; el replay de costo coincide con la proyección incremental sin reversiones.
- [ ] `apps/api/package.json` depende de `@monaco/domain` (`workspace:*`); la API compila contra `dist/`.

**Hecho cuando:** los umbrales de cobertura de `packages/domain` se mantienen, `apps/api` importa `@monaco/domain` en un test trivial, y la suite financiera de mobile (`pnpm test:coverage`) pasa sin cambios en `apps/mobile`.

### T2 · Contratos, permisos nuevos y migración de roles de sistema `M` · `Difícil` · **crítica de seguridad** (en paralelo con T1)

- [ ] `packages/contracts/src/catalog/` y `src/inventory/`: todos los esquemas de la sección "API" del spec, con `.meta({ id })`; `Quantity` (≤ 3 decimales), `SignedQuantity`, `AverageCost`; límites (100 líneas, `notes` ≤ 500, productos no repetidos, origen ≠ destino). Enum de tipos de movimiento (la API verificará en T5a que coincide con el del dominio).
- [ ] **Todos los códigos de error de SP3** (`INSUFFICIENT_STOCK`, `IDEMPOTENCY_CONFLICT`, `ALREADY_REVERSED`, `ARCHIVED`, `CURRENCY_MISMATCH`, `CONFLICT`) como constante compartida en `packages/contracts` (`ErrorResponse.code` es hoy un `string` libre), para que T4 y T5a no toquen el mismo archivo.
- [ ] `uuidv7()` movido a `packages/contracts` con `globalThis.crypto.getRandomValues`; `apps/api/src/infrastructure/db/uuidv7.ts` lo reexporta y sus tests siguen pasando.
- [ ] `PERMISSIONS` + `catalog:view` e `inventory:view`; `SYSTEM_ROLES` (Manager y Cashier los reciben); `PERMISSION_LABELS` y `PERMISSION_GROUPS` en `apps/web/src/lib/permissions.ts`; `AUDIT_EVENT_TYPES` con los tipos nuevos del spec.
- [ ] Migración del `CHECK` de `role_permissions` con `pnpm --filter api db:generate`.
- [ ] Migración de datos D11 (custom), **idempotente y re-ejecutable**: en una transacción, `NO FORCE` en `roles` y `role_permissions`, inserción de los permisos que falten en los roles de sistema de cada tenant (`ON CONFLICT DO NOTHING`), `FORCE` de nuevo.
- [ ] Implicación de lectura en `can`/casos de uso: `inventory:write`/`inventory:transfer` ⇒ `inventory:view` y `catalog:write` ⇒ `catalog:view` (sin backfill de roles personalizados), con test unitario.
- [ ] Tests: contratos (casos límite de cantidades y líneas); `auth-db.test.ts` (el `CHECK` coincide con el catálogo); integración de la migración D11 sobre una base con un tenant creado antes (recibe los permisos) comprobación de que `roles` y `role_permissions` siguen con `FORCE`, segunda ejecución sin efecto, y un test que falla si algún rol de sistema difiere de `SYSTEM_ROLES`.
- [ ] ADR 0005: permisos nuevos, alcance de `catalog:write` (D14) y procedimiento D11.
- [ ] `pnpm openapi:generate` y `pnpm --filter web api:generate` si cambian (los enums de permisos y auditoría aparecen en `/me` y `/audit-events`).

**Hecho cuando:** CI verde (incluido `openapi-drift`), la migración aplica sobre una base limpia y sobre una con datos de SP2, y el usuario Cashier del seed ve `catalog:view` e `inventory:view` en `GET /me`.

### T3 · Esquema de catálogo e inventario en Postgres `L` · `Difícil` · **crítica de datos y seguridad** (depende de T1, porque los `CHECK` de unidades y categorías se generan desde `@monaco/domain`, y de T2, porque las migraciones van en serie)

- [ ] Esquema Drizzle de `products`, `location_products`, `inventory_documents` e `inventory_movements` según el modelo del spec: `tenant_id`, `tenantIsolationPolicy`, `UNIQUE (id, tenant_id)`, FK compuestas (incluida la de movimientos hacia `location_products`), `CHECK`s de forma, signo por tipo, `kind`, `currency`, unidades y categorías (generados desde `@monaco/domain`, como el de permisos), `UNIQUE (tenant_id, reverses_document_id)` e índices (el cubriente de la suma incluido).
- [ ] Migración custom con `FORCE ROW LEVEL SECURITY` en las cuatro tablas y los privilegios de `monaco_app`: libro solo `INSERT`/`SELECT`; `products` y `location_products` sin `DELETE`.
- [ ] Tests de integración:
  - el guard de RLS + `FORCE` y `schema.test.ts` cubren las tablas nuevas;
  - matriz de privilegios de `schema-guards.test.ts` ampliada (`monaco_app` no puede `UPDATE` ni `DELETE` en el libro);
  - las FK compuestas impiden referenciar productos, puntos o documentos de otro tenant (mismo error que un id inexistente);
  - los `CHECK` rechazan un signo imposible, un `kind` desconocido y una segunda reversión del mismo documento.
- [ ] Test de integración del invariante: todo movimiento está en un punto del documento (ver spec, Notas del modelo); lo usan T5a y T6.
- [ ] ADR 0003: tablas nuevas y su matriz de privilegios.

**Hecho cuando:** las migraciones aplican sobre una base limpia y sobre una con el esquema de T2, y todos los tests de arriba pasan en `test:integration`.

### T4 · API de catálogo `L` · `Media` · **crítica de seguridad** (depende de T1 y T3; en paralelo con T5)

- [ ] Módulo hexagonal `apps/api/src/modules/catalog/` (copiando la forma de `locations`): puerto `CatalogUnitOfWork` sobre `withTenant`, repositorios de productos y precios por punto.
- [ ] Endpoints `GET/POST/PATCH /products`, `GET /products/:id`, `POST /products/:id/archive` y `PUT /locations/:locationId/products/:productId/price`, con la semántica del spec (paginación por `(name, id)`, filtros, precio efectivo con `?locationId`, archivado idempotente, `currency` inmutable con movimientos).
- [ ] Autorización en cada caso de uso antes de tocar datos: `catalog:write` tenant para productos, `catalog:write` en el punto para precios, `catalog:view` para lecturas; costos solo con `catalog:write`/`inventory:write` (D10).
- [ ] Auditoría (`product_*`, `location_price_set`) y mapeo de errores propio del módulo (`ARCHIVED`, `CURRENCY_MISMATCH`, 404/403 genéricos, con los códigos definidos en T2).
- [ ] Tests unitarios de casos de uso y controller; integración:
  - matriz cross-tenant (cada endpoint con ids de otro tenant da 404 y no cambia nada);
  - Manager con `catalog:write` por puntos: fija el precio de su punto, 403 en otro punto y al crear o editar productos;
  - Cashier: lee catálogo de su punto sin costos y recibe 403 en escrituras.
- [ ] `openapi.json` y `schema.d.ts` regenerados.

**Hecho cuando:** pasan los tests, la cobertura de la API sigue sobre sus umbrales y `/docs` muestra los endpoints de catálogo.

### T5a · API de inventario: entradas, salidas y ajustes (escrituras y concurrencia) `L` · `Difícil` · **crítica de datos y seguridad** (depende de T1 y T3; en paralelo con T4)

- [ ] Módulo hexagonal `apps/api/src/modules/inventory/`: puerto `InventoryUnitOfWork` con operaciones explícitas para el guion del ADR 0006 (cabecera idempotente, `FOR SHARE` de productos y puntos, alta perezosa ordenada y `FOR UPDATE` ordenado de `location_products`, suma de stock, inserción de movimientos, actualización del costo promedio).
- [ ] Casos de uso `RecordEntry`, `RecordExit`, `RecordAdjustment`: validar → autorizar (`inventory:write` en el punto) → idempotencia (`payload_hash` del cuerpo antes de defaults) → lock → regla del dominio → escribir → auditar. Ningún cálculo de signo, stock o costo fuera de `@monaco/domain`. Punto archivado (D15): salidas y ajustes pasan, entradas dan `ARCHIVED`.
- [ ] Mapeo de errores del módulo (`INSUFFICIENT_STOCK` con `details`, `IDEMPOTENCY_CONFLICT`, `ARCHIVED`, `CURRENCY_MISMATCH`, `40P01` → 409), con los códigos de T2.
- [ ] Test que verifica que el enum de tipos de contracts coincide con `INVENTORY_MOVEMENT_KINDS` del dominio.
- [ ] Tests de integración:
  - N salidas concurrentes que superan el stock: solo pasan las que caben y el stock final es ≥ 0;
  - dos envíos concurrentes del mismo `id`: un documento; mismo `id` con otro contenido: 409; `id` de otro tenant: 409 sin efecto; reintento sin `occurredAt`: 200;
  - costo promedio y `unit_cost` iguales a los del dominio tras varias entradas;
  - fuga entre puntos (escrituras en el punto 2 con permisos del punto 1 dan 403) y entre tenants (404);
  - punto o producto archivado; invariante movimiento/punto.

**Hecho cuando:** pasan los tests (incluidos los de concurrencia, sin flakiness en 20 corridas locales), la cobertura sigue sobre sus umbrales y `openapi.json`/`schema.d.ts` están regenerados.

### T5b · API de inventario: lecturas y visibilidad de costos `M` · `Media` · **crítica de seguridad** (depende de T5a)

- [x] `GET /locations/:locationId/stock` (bajo stock con `getProductThreshold`), `GET /products/:id/stock` (solo puntos visibles), `GET /locations/:locationId/inventory-movements`, `GET /inventory/documents/:id`.
- [x] Autorización con la implicación de lectura de T2; costos solo con `catalog:write`/`inventory:write` en el alcance (D10); enmascarado del otro punto de una transferencia cuando el actor no tiene `inventory:view` en él.
- [x] Tests de integración: fuga entre puntos y entre tenants en cada lectura; los costos no aparecen sin `inventory:write`; un rol personalizado con `inventory:write` lee lo que escribe; el punto 1 no ve el nombre del punto 2 en una transferencia.

**Hecho cuando:** pasan los tests, la cobertura sigue sobre sus umbrales y `openapi.json`/`schema.d.ts` están regenerados.

### T6 · Transferencias y reversiones `L` · `Difícil` · **crítica de datos** (depende de T5a)

- [x] `POST /inventory/transfers`: un documento, `transfer_out` + `transfer_in` por línea, `inventory:transfer` en origen y destino, locks de los dos puntos en el orden global, costo promedio del destino mezclando el del origen (`transfer_in`). `transfer_out` desde un punto archivado pasa; `transfer_in` hacia uno archivado da `ARCHIVED` (D15).
- [x] `POST /inventory/documents/:id/reversal`: líneas opuestas en todos los puntos del original, permiso del original en cada punto, una sola vez (`ALREADY_REVERSED`, incluida la violación 23505 con otro `id`), regla de stock no negativo y recálculo con `replayAverageCost` al revertir entradas o transferencias (el costo del destino queda como si la transferencia no hubiera existido).
- [x] Auditoría (`inventory_transfer_recorded`, `inventory_document_reversed`).
- [x] Tests de integración:
  - transferencias simultáneas A→B y B→A del mismo producto: sin deadlock y con stock final correcto;
  - transferencia sin permiso en el destino: 403 y sin efectos;
  - transferencia que dejaría el origen negativo: 409 y nada se mueve (atomicidad);
  - dos reversiones concurrentes del mismo documento con `id` distintos: una pasa y la otra da `ALREADY_REVERSED`;
  - revertir una transferencia recalcula el costo del destino y deja el del origen;
  - revertir una entrada ya consumida: 409; revertir dos veces: 409; revertir una transferencia restituye ambos puntos.

**Hecho cuando:** pasan los tests y el gate de transferencias del spec se cumple por API. Si el calendario se aprieta (riesgo de fiestas de docs/20), esta tarea y T8b pueden pasar al inicio de SP4 sin bloquear T7, T8a ni T9.

### T7 · Web: catálogo `L` · `Media` (depende de T4; en paralelo con T5a, T5b y T6)

- [x] Pantallas `/catalogo` (listado, búsqueda, filtros, archivados) y `/catalogo/[id]` (detalle, edición, archivar, precios por punto), con Server Actions y el cliente tipado.
- [x] Propuesta del precio de transferencia con la función de `@monaco/domain` (la web pasa a depender de `@monaco/domain`); la API sigue siendo la autoridad.
- [x] Navegación: entrada "Catálogo" en `navItemsFor` según `catalog:view`; acciones de producto solo con `catalog:write` tenant; edición de precio solo en los puntos permitidos.
- [x] Errores 403, 404, 409 y 422 como mensajes en español.
- [x] Tests de componentes de los formularios de producto y de precio por punto.

**Hecho cuando:** el Owner del seed crea, edita y archiva un producto y fija un precio por punto desde la web; un Cashier ve el catálogo de su punto sin acciones de escritura ni costos.

### T8a · Web: inventario (stock, entradas, salidas, ajustes y movimientos) `L` · `Media` (depende de T5b y T7)

- [x] `/inventario` (selector de punto visible, stock, bajo stock, costo promedio si corresponde).
- [x] Formularios con líneas para entrada, salida y ajuste; el `id` del documento se genera al renderizar el formulario (campo oculto) con `uuidv7()` de contracts.
- [x] `/inventario/movimientos`: libro paginado con filtros y detalle del documento (sin acción de revertir; llega en T8b).
- [x] Navegación según `inventory:view`; acciones según `inventory:write` en el punto. Mensajes en español para `INSUFFICIENT_STOCK`, `ARCHIVED` e `IDEMPOTENCY_CONFLICT`.
- [x] Tests de componentes: formulario de líneas (agregar, quitar, validación) y doble envío (el mismo `id`).

**Hecho cuando:** el Manager del seed registra una entrada y una salida en su punto y ve el stock resultante; un doble clic en "Guardar" crea un solo documento.

### T8b · Web: transferencias y reversión `M` · `Media` (depende de T6 y T8a)

- [ ] Formulario de transferencia (`/inventario/transferencias/nueva`) con el mismo manejo de `id` y de errores.
- [ ] Acción **Revertir** con confirmación en el detalle del documento; mensaje en español para `ALREADY_REVERSED`.
- [ ] Acciones según `inventory:transfer` en origen y destino.
- [ ] Tests de componentes: formulario de transferencia (origen ≠ destino) y confirmación de revertir.

**Hecho cuando:** el Owner del seed registra una transferencia entre los dos puntos, ve el stock resultante en ambos y puede revertir una entrada.

### T9 · Seed demo, E2E y cierre de documentación `M` · `Media` (depende de T8a; el e2e de transferencias y reversión depende de T8b)

- [ ] `db:seed` (idempotente) agrega productos demo, precios por punto y movimientos en los dos puntos (base para los KPIs de SP4). El Manager demo sigue asignado solo al punto 1, así que con D7 el e2e de transferencias (T8b) usa al Owner.
- [ ] Playwright en `apps/web/e2e`: entrada con stock resultante; salida que excede el stock muestra el error; Cashier ve solo el stock de su punto y no ve escrituras. Con T8b: transferencia con stock resultante en ambos puntos y revertir una entrada.
- [ ] `docs/20` (estado de SP3), `README` (flujo demo de inventario), `CLAUDE.md` (módulos `catalog` e `inventory`, cómo agregar un tipo de movimiento) y ADR 0006 pasa a "Aceptada".
- [ ] Marcar SP3 en Notion (lo hace el orquestador).

**Hecho cuando:** el job `e2e` pasa en CI y se cumple cada punto del gate de salida del spec.
