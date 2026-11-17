# ADR 0010 · Migración de los ids de mobile a UUIDv7 por SQL con copia previa

- **Estado:** propuesta (2026-11-16)
- **Contexto:** SP5, `apps/mobile` (`db/`, `drizzle/`, `lib/backup.ts`). Spec: [SP5](../superpowers/specs/2026-11-16-sp5-sync-offline-design.md). Relacionado con el [ADR 0003](0003-aislamiento-tenants-rls.md) (UUIDv7 en el servidor) y el [ADR 0009](0009-protocolo-sync-mobile.md) (protocolo de sync).

## Contexto

Las tablas de mobile usan ids enteros autoincrementales (`apps/mobile/db/schema.ts`). El servidor usa UUIDv7 y la idempotencia del sync se basa en ids generados por el dispositivo (ADR 0006 §4), así que los ids locales tienen que ser UUIDv7. La app ya está instalada con datos reales de un negocio; la migración tiene que conservar cada venta, movimiento y gasto, reescribir las FKs (`ventas.producto_id`, `ventas.sesion_id`, `movimientos_almacen.producto_id`), seguir abriendo respaldos viejos y dejar la suite financiera en verde (docs/20). Las apps no se pueden desactualizar desde las tiendas, así que no hay rollback de código, solo de datos.

## Decisión

1. **Una migración SQL pura** (`0004_uuid_ids.sql`) aplicada por `useMigrations` al arrancar y por `db/__tests__/test-db.ts` en los tests: reconstruye cada tabla con `id text` UUIDv7, conserva `legacy_id`, reescribe las FKs por *join*, recrea los índices y agrega `ventas.ticket_id` y `occurred_at`. Los UUIDv7 se generan en SQL (`printf` + `randomblob`), con el timestamp tomado de la fecha de negocio de la fila.
2. **Verificación dentro de la transacción:** `PRAGMA foreign_key_check` y conteos por tabla; cualquier diferencia aborta y deja el esquema viejo.
3. **Copia previa automática** de `db.sqlite` a `db.pre-uuid.sqlite` antes de migrar, conservada 30 días y restaurable desde Configuración. Sin copia, no se migra.
4. **Respaldos:** un respaldo con el esquema viejo se restaura como hoy y se migra en el siguiente arranque, porque el journal de Drizzle viaja en el archivo. Un respaldo nuevo no se abre en una versión vieja de la app.
5. **Ids nuevos en la app:** generador UUIDv7 de `@monaco/contracts/ids` (sin Zod), con el polyfill de `crypto.getRandomValues` que indique la doc de Expo 54.

Los supuestos sobre expo-sqlite 16 (transacción por migración, `foreign_keys` apagado, `journal_mode`, `synchronous`, funciones SQL disponibles) los confirma el spike T1 del plan de SP5, que registra aquí los valores medidos.

## Alternativas descartadas

- **Migración en JavaScript** (leer filas, generar ids con el generador de la app, reescribir): ids generados con la misma función que el resto, pero fuera del migrador de Drizzle, con estado intermedio que hay que reanudar si la app muere, y los tests no la aplicarían solos.
- **Columna `uuid` paralela conservando el id entero como PK:** evita reconstruir tablas, pero deja dos identidades para siempre y cada consulta y cada FK tendría que elegir cuál usar.
- **No migrar y mapear ids en el op-log:** el sync tendría que traducir ids en cada operación y en cada pull; un mapeo perdido corrompe la historia.
- **Migrar solo las tablas que se sincronizan:** `productos`, `ventas` y `movimientos_almacen` se sincronizan, pero `sesiones_venta` y `gastos` comparten respaldos y reportes; dos esquemas de ids en la misma base complican todo para ahorrar poco.

## Consecuencias

- Todas las firmas de `db/*.ts`, `CartItem.productId` y las pantallas pasan de `number` a `string`; la lógica financiera no cambia.
- La migración es irreversible en código; la vuelta atrás es restaurar `db.pre-uuid.sqlite` (30 días) o un respaldo.
- El primer arranque tras actualizar tarda lo que mida T1 (se muestra un indicador).
- Las filas viejas conservan `legacy_id`, útil para soporte y para comparar con respaldos anteriores.
