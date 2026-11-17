# ADR 0006 · Libro de inventario: append-only, stock derivado y lock por (punto, producto)

- **Estado:** propuesta (2026-11-16)
- **Contexto:** SP3, `apps/api` (módulo `inventory`), `packages/domain` y Postgres 17. Spec: [SP3](../superpowers/specs/2026-11-16-sp3-catalogo-inventario-design.md). Se apoya en el aislamiento del [ADR 0003](0003-aislamiento-tenants-rls.md) y en la autorización del [ADR 0005](0005-autorizacion.md).

## Contexto

El spec de la Etapa 2 pide stock por punto **derivado** de los movimientos ("suma de movimientos, nunca contador almacenado"), reglas de stock y costo reutilizadas desde `@monaco/domain`, y un dominio *append-mostly* para que el sync offline de SP5 no tenga conflictos. Al mismo tiempo, el inventario no puede quedar negativo, y dos escrituras concurrentes (dos salidas del mismo producto, o transferencias cruzadas entre dos puntos) no pueden leer el mismo stock y aprobarse las dos. Un stock derivado no se puede proteger con un `CHECK (stock >= 0)`, porque no hay columna que verificar.

Mobile resuelve esto en un solo dispositivo: suma en SQL con el signo de `POSITIVE_MOVEMENT_TYPES` (`apps/mobile/db/queries.ts`), y anula o edita movimientos en el lugar (`apps/mobile/db/movements.ts`). En un servidor multiusuario eso no alcanza.

## Decisión

1. **Libro append-only.** `inventory_documents` (cabecera) e `inventory_movements` (líneas). `monaco_app` solo tiene `INSERT` y `SELECT` sobre ellas, igual que sobre `audit_events`. Una corrección es un documento `reversal` cuyas líneas son el opuesto exacto de las del original; un documento se revierte como mucho una vez (`UNIQUE (tenant_id, reverses_document_id)`); su violación (23505 con otro `id`) se traduce a `409 ALREADY_REVERSED`.
2. **El signo lo decide el dominio, al escribir.** `@monaco/domain` define los tipos de movimiento y `movementDelta(kind, quantity)`; el caso de uso guarda el resultado en `quantity_delta`. El stock de un (punto, producto) es `SUM(quantity_delta)`. La aritmética de stock se hace en milésimas enteras, no en flotantes, para no dar falsos negativos (0.1 + 0.2 − 0.3). La regla del signo existe en un solo lugar; un `CHECK` de signo por tipo en la tabla es solo defensa en profundidad. Un test de propiedades del dominio comprueba que la suma coincide con `deriveStock`.
3. **Lock por (punto, producto) en orden global.** Cada par tiene una fila en `location_products` (que también guarda el override de precio y la proyección del costo promedio). Todo documento, dentro de `withTenant` y con `READ COMMITTED`:
   1. crea las filas que falten con `INSERT … ON CONFLICT DO NOTHING`, con los valores ordenados;
   2. las bloquea con `SELECT … FOR UPDATE` en orden `(location_id, product_id)`, también cuando el documento toca dos puntos (transferencias);
   3. recién entonces lee `SUM(quantity_delta)`, aplica `assertStockNotNegative` del dominio, escribe los movimientos y hace commit.

   Como cada escritor bloquea antes de leer y todos bloquean en el mismo orden, la suma leída no cambia hasta el commit y no hay ciclos de espera. Los productos y puntos se leen con `FOR SHARE` para que un archivado concurrente se serialice con el documento.
4. **Idempotencia por id del cliente.** El cliente genera el `id` (UUIDv7) del documento. `INSERT … ON CONFLICT (id) DO NOTHING` sobre la cabecera serializa dos envíos del mismo id; el segundo compara el `payload_hash` (SHA-256 del cuerpo tal como lo envió el cliente, antes de aplicar defaults del servidor como `occurredAt`): igual → devuelve el documento existente; distinto → `409 IDEMPOTENCY_CONFLICT`. Un id de otro tenant da la misma respuesta.
5. **El costo promedio es una proyección, no el stock.** `location_products.average_cost` se actualiza en la misma transacción con `blendAverageCost` (entradas y transferencias entrantes, con el stock vigente). La única recalculación es `replayAverageCost` del dominio: un replay determinista del libro del par (punto, producto) en orden de inserción, con el stock acumulado en cada punto, que mezcla en cada `entry` y `transfer_in` y excluye los documentos revertidos y sus reversiones. Se aplica al revertir un documento con `entry` o `transfer_in`; revertir una transferencia recalcula el costo del destino y deja intacto el del origen. `weightedAverageCost` no sirve para esto (ignora el consumo y las transferencias entrantes). El stock en sí nunca se almacena.
6. **Punto archivado.** Admite salidas, ajustes y `transfer_out` (para vaciarlo), no entradas ni `transfer_in`.

## Alternativas descartadas

- **Contador de stock almacenado con `CHECK (stock >= 0)`:** lo más simple y rápido de leer, pero contradice el spec de la Etapa 2, convierte cada movimiento en un `UPDATE` de una fila caliente y, en SP5, en un conflicto de sync entre dispositivos.
- **Aislamiento `SERIALIZABLE`:** detecta el conflicto sin locks explícitos, pero aborta transacciones (también por falsos positivos de predicado) y obliga a reintentar en cada caso de uso. El lock explícito es predecible y fácil de testear.
- **Locks consultivos (`pg_advisory_xact_lock(hash)`):** no necesitan una fila, pero el espacio de claves es global (no respeta RLS), un hash de 64 bits puede colisionar entre tenants y no se ven en el esquema.
- **Trigger que verifica la suma ≥ 0:** sería una tercera barrera, pero duplica la regla del dominio en PL/pgSQL (docs/20: "dominio único") y, sin el lock, igual tiene la carrera de dos transacciones que leen antes de que la otra haga commit.
- **Movimientos editables o con flag de anulado, como mobile:** pierden la historia y en SP5 generan conflictos de "último escritor gana" sobre la misma fila.
- **Idempotencia con un header `Idempotency-Key` y una tabla aparte:** duplica lo que ya da la PK del documento, y SP5 necesita igual ids generados en el dispositivo.

## Consecuencias

- Cada escritura de inventario sigue el mismo guion (validar, autorizar, idempotencia, lock ordenado, leer suma, regla del dominio, escribir). Las ventas de SP5 se escriben con ese mismo guion y el tipo `sale`.
- Leer el stock es un `GROUP BY` sobre el índice `(tenant_id, location_id, product_id) INCLUDE (quantity_delta)`. Si SP4 necesita más velocidad, se agregan snapshots periódicos como proyección, sin tocar el libro.
- Un deadlock (`40P01`) indicaría un caso de uso que no respeta el orden: se mapea a `409 CONFLICT` y un test de transferencias cruzadas lo vigila.
- Corregir un error de carga deja dos documentos (el original y su reversión). Es el precio de la historia completa.
- Agregar un tipo de movimiento exige: el tipo y su signo en `@monaco/domain`, el enum de contracts (un test verifica que coinciden), la ampliación del `CHECK` de `kind` con una migración y el mapeo con mobile si corresponde.
