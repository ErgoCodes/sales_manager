# 12 · Visión: plataforma multi-negocio (Etapa 2)

**Prioridad: BAJA (visión a futuro) · Estado: sin trabajo iniciado — solo documento de visión**

> Este doc registra hacia dónde se quiere escalar la app, para que la visión no viva solo en la cabeza del desarrollador. **No es un plan de ejecución**. Tracking en Notion: proyecto "Mercado Mónaco — Plataforma multi-negocio" en el Centro de Proyectos.
>
> **Actualización 2026-07-11:** el brainstorm formal ya se hizo — las preguntas abiertas de abajo tienen respuesta en [el spec de la Etapa 2](superpowers/specs/2026-07-11-etapa2-plataforma-multinegocio-design.md) (descomposición SP1-SP4, sync por op-log propio, jerarquía owner/admin/vendedor, catálogo por punto, stack NestJS+Drizzle+Postgres en VPS). Las secciones siguientes se conservan como registro del razonamiento original; la fuente de verdad del diseño es el spec.

## Las dos etapas

1. **Etapa 1 — MVP multiplataforma (en curso):** consolidar la app actual para un solo negocio en las plataformas que Expo ya cubre (iOS, Android, Web). Es el proyecto activo en Notion; sus 15 tareas están verificadas contra el código a 2026-07-11.
2. **Etapa 2 — Plataforma multi-negocio (este doc):** evolucionar de app single-tenant offline-first a una plataforma de gestión de puntos de venta e inventarios que sirva a varios negocios, con backend, cuentas y sincronización.

**Prerrequisito explícito:** no arrancar la Etapa 2 hasta que la Etapa 1 esté cerrada (deuda crítica saldada, tests sobre la lógica financiera, validación en dispositivo real). Construir multi-tenant sobre una base sin tests ni validación en runtime multiplicaría el riesgo.

## Qué cambia conceptualmente

| Hoy (Etapa 1) | Plataforma (Etapa 2) |
|---|---|
| 1 usuaria (Yamile), 1 negocio, 1 dispositivo | N negocios, cada uno con 1+ usuarios y 1+ dispositivos |
| Sin cuentas ni auth | Registro, login, roles (dueño/empleado) |
| Todo vive en `db.sqlite` local | SQLite local sigue siendo la verdad inmediata (offline-first se conserva), pero sincroniza con un backend |
| Respaldo manual exportando el `.db` | Respaldo implícito por sincronización + export manual como fallback |
| Configuración = tabla `configuracion` local | Configuración por negocio en el backend, cacheada localmente |

**Decisión de identidad que se conserva:** offline-first no es negociable. El caso de uso real (mercados pequeños, conectividad intermitente en Cuba) hace que "la app funciona igual sin internet y sincroniza cuando puede" sea la ventaja competitiva, no una limitación.

## Preguntas abiertas de diseño

Cada una de estas debe resolverse en el spec formal de la Etapa 2; se listan para que no se pierdan:

### Modelo de datos multi-tenant
- ¿`business_id` en cada tabla (esquema compartido) o base de datos por negocio? El esquema actual (stock derivado, costo promedio ponderado, costo congelado al vender) se conserva — la pregunta es solo cómo se particiona.
- ¿Qué pasa con las claves autoincrementales locales cuando dos dispositivos del mismo negocio crean filas offline? (Probable: UUIDs o IDs compuestos dispositivo+secuencia.)

### Sincronización offline-first
- Estrategia: ¿CRDT, log de operaciones con reconciliación en servidor, o sync por tabla con last-write-wins + resolución manual de conflictos?
- Los conflictos reales del dominio son pocos pero delicados: dos dispositivos vendiendo el mismo stock, ediciones concurrentes de una venta (T-22), recálculo de costo promedio con entradas fuera de orden.
- Candidatos a evaluar cuando toque: réplica SQLite (Turso/libSQL embedded replicas, PowerSync, ElectricSQL) vs. sync propio sobre un log de operaciones. No casarse con ninguno antes del spec.

### Backend y auth
- Alcance mínimo: auth + almacenamiento de operaciones + fan-out a dispositivos del mismo negocio. Nada de lógica de negocio en el servidor al principio (la app ya la tiene toda).
- Elección de stack pospuesta al spec. Restricción a considerar: costo de operación cercano a cero mientras haya pocos negocios.

### Producto
- ¿Roles desde el día 1 (dueño ve reportes, empleado solo registra ventas) o un solo rol por negocio al inicio?
- ¿La captura de ventas en lote (el flujo estrella de T-09) cambia en algo con múltiples cajas simultáneas?
- Precios en CUP con la regla efectivo/transferencia (+10% redondeado a 5) están hardcodeados como regla de negocio de un mercado cubano — ¿se generaliza (reglas de precio configurables por negocio) o se acepta el nicho?

### Migración
- La instalación actual de Yamile debe migrar sin pérdida: su `db.sqlite` se convierte en el primer tenant. Diseñar la migración como parte del spec, no como afterthought.

## Qué NO es la Etapa 2

- No es reescribir la app: el frontend Expo, el esquema de dominio y la lógica financiera se conservan.
- No es SaaS público con onboarding self-service (eso sería una Etapa 3, si algún día tiene sentido).
- No es añadir features de venta nuevas — las features de dominio (fiado, etc.) viven en la Etapa 1 o en su propio análisis.
