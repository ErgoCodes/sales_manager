# Etapa 2 · Plataforma multi-negocio — diseño

> Resultado del brainstorm del 2026-07-11 sobre `docs/12-vision-multiplataforma.md`. Define la descomposición en sub-proyectos y el diseño de SP1+SP2. **La implementación sigue gateada por el cierre de la Etapa 1** (tests sobre lógica financiera y validación en dispositivo real como mínimo); este spec existe para que el diseño no se pierda y SP1 pueda arrancar sin re-discutir todo.

## Decisiones de producto (respuestas del brainstorm)

- **Motivación:** visión de producto propio para negocios pequeños, sin cliente concreto aún. **Cuba primero, LATAM después** — el modelo de datos no debe hardcodear nada cubano nuevo; la regla efectivo/transferencia (+10% redondeado a 5) queda como configuración del punto.
- **Operación:** VPS propio (~5-10 USD/mes), sin dependencia de free tiers ni SaaS de sync. Docker Compose + Caddy.
- **Jerarquía de usuarios:** `owner` (visión global de todos los puntos del negocio) → `admin` (gestión completa de uno o varios puntos) → `vendedor` (varios por punto, normalmente alternándose).
- **Concurrencia:** hoy basta **1 caja activa por punto**; el modelo debe permitir varias simultáneas mañana sin migración dolorosa. (De ahí: UUIDs y op-log append-only desde el día 1.)
- **Catálogo:** **por punto de venta, independiente** — cada punto gestiona su catálogo, precios y stock como la app actual. Hallazgo estructural: *punto de venta ≈ la base de datos completa de la app actual*; el tenant real es el punto, y el negocio es una capa de agrupación y permisos encima. La app existente casi no cambia conceptualmente.
- **Offline-first se conserva:** el sync jamás bloquea una venta; la app funciona idéntica sin conexión.

## Descomposición (cada sub-proyecto con su propio ciclo spec → plan → código)

| # | Sub-proyecto | Entrega | Depende de |
|---|---|---|---|
| SP1 | Base local sync-ready | La app genera UUIDs y registra cada escritura en un op-log local. Sin backend; comportamiento visible idéntico. | Etapa 1 cerrada |
| SP2 | Backend núcleo | Auth + negocio/puntos/roles + sync push/pull con 1 escritor por punto + restore en teléfono nuevo + onboarding/migración de Yamile. | SP1 |
| SP3 | Vista global del owner | Reportes agregados cross-punto, solo lectura, servidos desde las tablas materializadas del servidor. | SP2 |
| SP4 | Multi-caja por punto | Varios vendedores despachando a la vez en el mismo punto. | SP2 + demanda real |

## Enfoque de sync elegido: log de operaciones propio (opción A)

Cada escritura de la app es una operación append-only replicada a un servidor propio. Alternativas descartadas: **(B)** motores de réplica self-hosted (ElectricSQL/PowerSync) — infra pesada para el VPS, self-hosting inmaduro, y su last-write-wins por fila encaja peor que ops append con el dominio; **(C)** respaldo continuo de archivo (estilo Litestream por dispositivo) — solo da backup/restore, sin vista global del owner y callejón sin salida para multi-caja.

Por qué A es barato aquí: el diseño existente de **stock derivado (nunca contador almacenado)** hace el dominio append-mostly — ventas y movimientos son inserts que se suman; las ediciones de catálogo (raras, del admin) toleran last-write-wins a nivel de fila. Con 1 escritor por punto, sync = replicación ordenada, trivialmente correcta.

## SP1 · Base local sync-ready

1. **PKs a UUIDv7** en las tablas sincronizables (`productos`, `movimientos_almacen`, `ventas`, `gastos`): TEXT generado en JS, v7 por ser ordenado por tiempo (índices sanos). Migración de recreación de tablas en SQLite — barata hoy con un solo dispositivo real, carísima después. Descartada la columna `guid` paralela: dejaría dos sistemas de identidad para siempre.
2. **Tabla `operaciones` local:** `id` (UUIDv7), `entity`, `entityId`, `type` (`upsert` | `delete`), `payload` (snapshot JSON completo de la fila tras el cambio), `createdAt`, `synced`. Semántica **snapshot/upsert, no event-sourcing de comandos**: el replay es aplicar upserts en orden, sin lógica de dominio.
3. **Punto de enganche: los repositorios `db/*.ts`** (ya son el único punto de escritura). Cada función de escritura añade sus ops dentro de la transacción que ya tiene. Cero cambios en pantallas.
4. **`configuracion` se parte:** lista blanca de claves sincronizables (nombre del negocio, umbrales, % rebaja); claves de dispositivo (`weeklyReminderScheduled`, `lastBackup`) quedan locales.

SP1 se shippea antes de que exista el servidor: la app queda dejando el log listo. Prerrequisito de protección: los tests de lógica financiera de la Etapa 1.

## SP2 · Backend núcleo

**Stack:** NestJS + Drizzle + Postgres en Docker Compose sobre el VPS, Caddy para TLS. Drizzle (no Prisma) para compartir ORM y estilo de esquema con la app. El servidor **no contiene lógica de negocio** (precios/stock/utilidad viven en la app): solo auth, permisos, log ordenado y materialización.

**Esquema (UUIDv7 en todo):**

| Tabla | Campos clave | Notas |
|---|---|---|
| `users` | email, password_hash, nombre | Auth email+contraseña; JWT access + refresh por device |
| `negocios` | nombre, owner_user_id | |
| `puntos` | negocio_id, nombre, active_device_id | El tenant de los datos |
| `role_bindings` | user_id, negocio_id, punto_id (NULL = todos), role | `owner` \| `admin` \| `vendedor` |
| `devices` | user_id, punto_id, nombre, last_seen | Un refresh token por device |
| `operaciones` | punto_id, seq (monotónico **por punto**, asignado en el ingest — no un bigserial global; cómo se implementa se decide en el plan), client_op_id UNIQUE, entity, payload, created_at | Log autoritativo, mismo formato que el local |
| `productos`/`ventas`/`movimientos`/`gastos` + `punto_id` | espejo relacional | Materializadas al ingerir cada op → SP3 es puro SQL |

**Protocolo (2 endpoints):**

- **Push:** el device manda ops con `synced = false` en lotes; el servidor appendea (idempotente por `client_op_id` — reintentos nunca duplican), materializa y ackea; el device marca `synced = true`.
- **Pull:** "ops del punto después de seq N". Restaurar teléfono nuevo = pull desde 0 + replay local.

**Escritor único = candado advisory, no regla de correctitud.** `active_device_id` define la caja activa; push de otro device se rechaza con error claro y la app ofrece "Tomar la caja" (mismo usuario o admin). Ops tardías del escritor anterior (ventas hechas offline antes del takeover) **se aceptan al reconectar**: son hechos, no conflictos — el stock derivado las absorbe, igual que hoy absorbe el sobregiro como advertencia. El candado previene el uso concurrente accidental; nunca pierde datos.

**Onboarding = migración.** Flujo en la app "Conectar a la nube": crear cuenta → negocio + punto → la app sintetiza ops `upsert` de todas las filas existentes (productos primero; luego movimientos/ventas/gastos por fecha) → push normal. Los datos actuales de Yamile entran por el mismo camino que cualquier negocio futuro con historial previo.

**Errores de sync:** silenciosos y reintentables; badge "N operaciones sin subir" en Configuración. El sync jamás bloquea una operación local.

## Fuera de alcance de SP1+SP2

- Reportes cross-punto (SP3) y multi-caja simultánea (SP4).
- Panel web de administración; alta de negocios self-service pública (el alta la hace el desarrollador al principio).
- Cobro/planes/billing del producto.
- Notificaciones push del servidor.

## Riesgos señalados

- **SP2 es XL:** al llegar a su plan de implementación hay que partirlo (auth/tenancy · protocolo sync · onboarding) en tareas independientes.
- La migración UUIDv7 (SP1) toca todas las FKs del código local — es el paso más delicado; hacerla con la suite de tests de la Etapa 1 ya verde.
- Bloqueo de plataformas de pago/hosting operando desde Cuba: mitigado por VPS propio, pero verificar proveedor de VPS y pasarela de pago antes de comprometerse.
