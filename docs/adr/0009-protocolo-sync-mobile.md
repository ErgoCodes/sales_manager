# ADR 0009 · Protocolo de sync de mobile: op-log de comandos, push idempotente, pull por instantánea y lease de permisos

- **Estado:** propuesta (2026-11-16)
- **Contexto:** SP5, `apps/mobile`, `packages/sync` (nuevo), `apps/api` (módulos `sync`, `sales`, `inventory`, `iam`) y `packages/contracts`. Spec: [SP5](../superpowers/specs/2026-11-16-sp5-sync-offline-design.md). Se apoya en el libro de inventario del [ADR 0006](0006-libro-de-inventario.md), las ventas del [ADR 0007](0007-ventas-y-modelo-de-reportes.md), la autenticación del [ADR 0004](0004-autenticacion.md) y la autorización del [ADR 0005](0005-autorizacion.md).

## Contexto

La caja mobile tiene que vender sin red (docs/12: "vender jamás depende de la red") y el servidor tiene que ser la autoridad final al sincronizar (spec de la Etapa 2). Mobile hoy edita y anula en el lugar (`UPDATE` sobre `ventas` y `movimientos_almacen`), mientras que el servidor es un libro append-only con idempotencia por id del cliente (ADR 0006). Varias cajas y la web escriben en el mismo punto. El gate de docs/20 exige además una política explícita para operaciones hechas con permisos que se revocaron mientras la caja estaba offline.

## Decisión

1. **Op-log de comandos, no de filas.** Cada acción de negocio local escribe, en la misma transacción SQLite, una operación con id UUIDv7 (= id del documento en el servidor = clave de idempotencia) y un `payload` congelado. Las ediciones y anulaciones locales se traducen a "revertir la versión vigente y registrar la nueva" en el servidor. La coalescencia solo actúa sobre operaciones nunca enviadas.
2. **Push por lotes** (`POST /sync/push`, ≤ 100 operaciones / 256 KB), una transacción por operación, resultado por operación (`applied`, `duplicate`, `rejected`, `not_processed`), corte en el primer error reintentable para conservar el orden y `DEPENDENCY_REJECTED` para las dependientes de una rechazada. Idempotencia por id + `payload_hash` (ADR 0006 §4).
3. **Pull por instantánea completa del punto** (`GET /sync/pull`, `ETag`/`304`): catálogo con archivados, precios efectivos, stock derivado, *lease* y zona horaria. Sin tombstones: el servidor no borra catálogo. La caja muestra `stock del servidor + operaciones locales no incluidas en la instantánea`, comparando horas del servidor.
4. **Conflictos por regla, no por "último escritor gana":** una venta la escribe solo su caja (la web no revierte documentos `sale`); las ventas que llegan con stock insuficiente **se aceptan y se marcan** (`stock_shortfall`); los demás documentos mantienen la regla estricta de stock no negativo; el precio aplicado de la venta lo pone la caja; el costo lo calcula el servidor; `occurred_at` futuro se recorta a `now()` con `clock_adjusted`.
5. **Lease de permisos firmado.** El pull entrega un JWT EdDSA (`typ: perm-lease+jwt`, `aud: monaco-mobile-lease`, 7 días) con los permisos efectivos por punto. Política de permisos revocados offline: una **venta** hecha con un *lease* válido se acepta si llega antes de `exp` + 7 días según el reloj del servidor (`authorized_by_lease`); todo lo demás (anulaciones, correcciones, inventario) se autoriza con los permisos **actuales**. Lo rechazado no se borra: un usuario con el permiso lo adopta (auditado) o se descarta localmente con confirmación. Un dispositivo revocado o un usuario desactivado detiene el sync, pero el op-log se conserva para que un Owner o Manager lo adopte desde un dispositivo nuevo.
6. **Motor puro en `packages/sync`** con puertos de almacenamiento, transporte y reloj, para probarlo con propiedades, con una simulación determinista de dos dispositivos y contra la API real con Testcontainers.

## Alternativas descartadas

- **Sync de filas con "último escritor gana" (CRDT o timestamps):** contradice el libro append-only y pierde la historia; con relojes de dispositivo no confiables, el ganador sería arbitrario.
- **Llamar a los endpoints existentes de a uno:** una petición por operación, sin orden garantizado entre ellas y sin un lugar para la política de *lease* ni para los resultados parciales.
- **Rechazar ventas que dejan stock negativo:** respeta la regla de SP3 pero pierde ventas ya cobradas, que es exactamente lo que el sync tiene que evitar.
- **Usar siempre los permisos actuales:** simple, pero una venta legítima hecha antes de un cambio de rol se rechazaría al llegar.
- **Aceptar todo lo que manda un dispositivo autenticado:** un Cashier sin permiso podría seguir anulando ventas hasta reconectarse.
- **Pull incremental por cursor desde el primer día:** exige una secuencia transaccional por tabla y eventos de archivado; con catálogos chicos, la instantánea con `ETag` alcanza y se puede cambiar sin tocar el push.
- **Motor dentro de `apps/mobile/lib`:** sin simulación ni integración contra la API real fuera de Jest/Expo.

## Consecuencias

- El ADR 0006 se enmienda: la regla "el inventario no puede quedar negativo" tiene una excepción explícita y marcada para ventas sincronizadas, y un documento `sale` no se revierte desde el endpoint de inventario.
- El ADR 0004 se enmienda con el *lease* (nunca aceptado como bearer) y el throttler `device`.
- La utilidad de una venta en la caja (costo `precio_costo`, docs/13) y en la web (`effectiveUnitCost`, SP4) puede diferir: se explica en la UI.
- Los totales de un día pasado cambian cuando llega una venta tardía (ya previsto en el ADR 0007).
- El servidor guarda `sync_flags`, `author_user_id` y `adopted_by` en `sales`; los flags se fijan al insertar y el libro sigue sin `UPDATE`.
- Si el catálogo de un tenant supera ~5.000 productos, se pasa a pull incremental (D5 del spec) sin cambiar el push.
