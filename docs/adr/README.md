# Architecture Decision Records

Decisiones de arquitectura de la Etapa 2, una por archivo, con formato corto: contexto, decisión, alternativas descartadas y consecuencias.

| # | Decisión | Estado |
|---|---|---|
| [0001](0001-arquitectura-hexagonal-api.md) | Arquitectura hexagonal por módulo en la API (NestJS) | Aceptada |
| [0002](0002-contratos-zod-openapi.md) | Contratos con Zod 4 como fuente de verdad → OpenAPI → clientes generados | Aceptada |
| [0003](0003-aislamiento-tenants-rls.md) | Aislamiento de tenants: esquema compartido + `tenant_id` + RLS forzado, alcance por transacción y rol de aplicación separado | Aceptada |
| [0004](0004-autenticacion.md) | Autenticación: JWT EdDSA, refresh rotativo con detección de reuso, verificación por petición, IP firmada y rate limiting en Postgres | Aceptada |
| [0005](0005-autorizacion.md) | Autorización: permisos en código, roles por tenant con alcance, no escalada de privilegios y Owner protegido | Aceptada |
| [0006](0006-libro-de-inventario.md) | Libro de inventario append-only, stock derivado de los movimientos, lock por (punto, producto) en orden global e idempotencia por id del cliente | Aceptada |
| [0007](0007-ventas-y-modelo-de-reportes.md) | Ventas dentro del libro de inventario (escritas por `RecordSale`) y KPIs por consultas en vivo, por moneda y por día local del tenant, sin cache | Propuesta |
| [0008](0008-despliegue-demo-publica.md) | Despliegue de la demo pública: proveedor con `BYPASSRLS` (default Fly.io + Neon, a confirmar), migraciones fuera del runtime, tenant de solo lectura, reset nocturno e IP real detrás del proxy | Propuesta |
| [0009](0009-protocolo-sync-mobile.md) | Protocolo de sync de mobile: op-log de comandos, push por lotes idempotente, pull por instantánea, conflictos por regla y lease de permisos para operaciones hechas offline | Propuesta |
| [0010](0010-migracion-ids-mobile-uuidv7.md) | Migración de los ids de mobile a UUIDv7 con una migración SQL pura, verificación dentro de la transacción y copia previa de 30 días | Propuesta |
