# Architecture Decision Records

Decisiones de arquitectura de la Etapa 2, una por archivo, con formato corto: contexto, decisión, alternativas descartadas y consecuencias.

| # | Decisión | Estado |
|---|---|---|
| [0001](0001-arquitectura-hexagonal-api.md) | Arquitectura hexagonal por módulo en la API (NestJS) | Aceptada |
| [0002](0002-contratos-zod-openapi.md) | Contratos con Zod 4 como fuente de verdad → OpenAPI → clientes generados | Aceptada |
| [0003](0003-aislamiento-tenants-rls.md) | Aislamiento de tenants: esquema compartido + `tenant_id` + RLS forzado, alcance por transacción y rol de aplicación separado | Aceptada |
| [0005](0005-autorizacion.md) | Autorización: permisos en código, roles por tenant con alcance, no escalada de privilegios y Owner protegido | Aceptada |
