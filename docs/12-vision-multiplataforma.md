# 12 · Visión: plataforma multi-location POS SaaS (Etapa 2)

**Estado: diseño de alto nivel aprobado (2026-11-04) · implementación sin iniciar**

> **Actualización 2026-11-04:** la visión original (producto para negocios pequeños en Cuba, tenant = punto de venta, VPS mínimo, Cuba/global y monetización) quedó **superada**. El proyecto pasa a ser una **pieza de portafolio fullstack con énfasis en arquitectura**. La fuente de verdad del diseño es [el spec de la Etapa 2](superpowers/specs/2026-07-11-etapa2-plataforma-multinegocio-design.md); este doc solo resume la visión.

## Las dos etapas

1. **Etapa 1 — app mobile de un solo negocio (completa):** app Expo offline-first sobre SQLite local, con tests de lógica financiera, monorepo y `packages/domain` extraído (ver [19-preparacion-etapa2.md](19-preparacion-etapa2.md)).
2. **Etapa 2 — plataforma multi-location POS SaaS (este doc):** un backend propio, un back-office web y la app mobile como caja offline-first que sincroniza con el servidor.

## Qué cambia conceptualmente

| Hoy (Etapa 1) | Plataforma (Etapa 2) |
|---|---|
| 1 negocio, 1 dispositivo, sin cuentas | N negocios (tenants), cada uno con N puntos de venta, usuarios y dispositivos |
| Solo app mobile (Expo) | Back-office web en Next.js + caja mobile en Expo + API en NestJS/Drizzle/Postgres |
| Sin auth | Auth propia con refresh token por dispositivo y RBAC con roles personalizables |
| Todo vive en `db.sqlite` local | SQLite local sigue siendo la verdad inmediata en la caja y sincroniza con el servidor por op-log |
| Catálogo local | Catálogo central del negocio, con stock y precio por punto |
| Reportes locales | Dashboard completo en la web y vista "Hoy" en mobile |

**Decisión de identidad que se conserva:** offline-first en la caja. Vender jamás depende de la red; el sync ocurre cuando puede.

## Sub-proyectos

SP1 Fundaciones → SP2 Identidad y tenancy → SP3 Catálogo e inventario → SP4 Dashboard → SP5 Sync offline de mobile. El detalle, las dependencias y los riesgos están en el spec.

## Qué NO es la Etapa 2

- No es reescribir la lógica de dominio: precios, stock derivado y costo promedio se reutilizan desde `packages/domain`.
- No incluye cobros, planes, registro público self-service ni variantes por país.
