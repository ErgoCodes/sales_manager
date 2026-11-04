# Etapa 2 · Plataforma multi-location POS SaaS — diseño

> **Reescrito el 2026-11-04.** Reemplaza el diseño del 2026-07-11 (enfoque Cuba/LATAM, tenant = punto de venta, VPS mínimo, monetización). El objetivo cambió: el proyecto pasa a ser una **pieza de portafolio fullstack con énfasis en arquitectura**. Las decisiones previas que no aparecen aquí quedan descartadas.

## Objetivo

Construir un **multi-location POS SaaS multi-tenant**: un punto de venta centralizado para negocios con varios locales, con back-office web, caja mobile offline-first y un backend propio que consumen ambos clientes. El criterio de cada decisión es demostrar buen juicio de ingeniería (fronteras claras, dominio compartido, contratos tipados, seguridad, tests), no minimizar costo operativo ni atender un mercado concreto.

Términos de referencia de la categoría: *multi-location POS*, *multi-store POS*, *multi-tenant POS SaaS*, *retail management system*, *offline-first POS*.

## Decisiones

| Tema | Decisión |
|---|---|
| Rol objetivo del portafolio | Fullstack con refuerzo en arquitectura |
| Tenant | El **negocio** (organización), con N puntos de venta (*locations*) |
| Web | **Next.js** en `apps/web`: back-office (catálogo, inventario, usuarios, roles, puntos) + dashboard completo |
| Mobile | **Expo** en `apps/mobile`: caja del punto de venta (Android/iOS) |
| Backend | **NestJS + Drizzle + Postgres** en `apps/api`, arquitectura hexagonal |
| Mobile y servidor | **Offline-first completo con sync** por op-log: SQLite local como verdad inmediata, push/pull con el servidor |
| Catálogo | **Central del negocio**, con stock y precio opcional **por punto**. Cada dato tiene un único escritor: el catálogo lo escribe el back-office; ventas y movimientos los escribe la caja de su punto |
| Autorización | **RBAC con permisos**: cada acción de la aplicación es un permiso |
| Dashboard | Completo en la web; vista compacta "Hoy" en mobile. Mismos endpoints, protegidos por `reports:view` |
| Autenticación | Propia en NestJS: email + contraseña (argon2), JWT de acceso corto y refresh token rotativo **por dispositivo**, revocable |

### RBAC

- **Permisos = código:** catálogo fijo y versionado (`sales:create`, `sales:void`, `catalog:write`, `reports:view`, …). No se crean desde la UI.
- **Roles = datos por tenant:** cada negocio recibe tres roles por defecto y puede crear roles nuevos combinando permisos.

| Rol por defecto | Alcance típico | Puede |
|---|---|---|
| Owner | Todo el negocio | Todo, más gestionar usuarios, puntos y configuración del negocio. Protegido: un negocio nunca queda sin owner |
| Manager | Uno o varios puntos | Catálogo y precios, inventario, transferencias, dashboard de sus puntos, anular ventas |
| Cashier | Un punto | Vender, ver el stock de su punto y su propio cierre de caja |

- **Asignación = usuario + rol + alcance** (todo el negocio o una lista de puntos). La API valida *permiso + punto*, nunca el nombre del rol.
- **Offline:** mobile cachea los permisos efectivos del usuario para decidir sin red; el servidor es la autoridad final al sincronizar.

### Supuestos (pendientes de confirmar en el spec de cada sub-proyecto)

- Sin cobros, planes ni registro público: un tenant demo con datos sembrados.
- Los datos locales actuales de la app mobile no se migran.
- Aislamiento entre tenants: esquema compartido con `tenant_id` + **Row-Level Security de Postgres** como segunda barrera.
- Se reutiliza `packages/domain` (precios, stock derivado, costo promedio) en el backend. El stock derivado (suma de movimientos, nunca contador almacenado) mantiene el dominio *append-mostly* y reduce los conflictos de sync.

## Descomposición

Cada sub-proyecto sigue su propio ciclo spec → plan → código. Mientras tanto, la app mobile sigue funcionando como hoy. El sync va último y aislado, para que exista un producto demostrable de punta a punta antes de abordar la parte más riesgosa.

| # | Sub-proyecto | Entrega | Depende de |
|---|---|---|---|
| SP1 | Fundaciones | `apps/api` y `apps/web` en el monorepo, `packages/contracts` (esquemas Zod compartidos), Postgres en Docker Compose, CI | — |
| SP2 | Identidad y tenancy | Auth por dispositivo, tenants, puntos de venta, RBAC completo y su gestión desde la web | SP1 |
| SP3 | Catálogo e inventario | Catálogo central, precio y stock por punto, movimientos y transferencias (API + web) | SP2 |
| SP4 | Dashboard | KPIs en la web y vista "Hoy" en mobile, sobre datos demo sembrados | SP3 |
| SP5 | Sync offline de mobile | UUIDv7, op-log local, push/pull idempotente, catálogo descargado de solo lectura, ventas offline | SP3 |

## Fuera de alcance

- Cobros, planes, billing y registro self-service público.
- Variantes por país o región (Cuba/global).
- Notificaciones push del servidor.

## Riesgos

- **SP5 (sync) es el más difícil:** idempotencia, orden, conflictos y migración de IDs. Se mitiga con el principio de un único escritor por dato y con el dominio append-mostly.
- **Permisos revocados mientras una caja está offline:** el spec de SP5 debe definir qué pasa con las operaciones hechas con permisos que ya no tiene el usuario.
- **Migración a UUIDv7 en mobile:** toca todas las FKs locales; hacerla con la suite de tests financieros en verde.
