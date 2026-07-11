# Registro del roadmap en Notion + visión multiplataforma

> Diseño de dónde y cómo queda registrado el trabajo pendiente del proyecto, para que implementar sea lo único que quede por hacer. No es una feature de la app — es organización de trabajo.

## Contexto

El proyecto (Mercado Mónaco, app de inventario/ventas para un solo negocio) ya tiene 14/23 tareas del `ROADMAP.md` hechas y 11 documentos de análisis en `docs/` que cubren tanto el roadmap pendiente (`02-plan-roadmap-pendiente.md`) como deuda técnica transversal (`03` a `09`) y dos features nuevas ya diseñadas pero no implementadas (`10`, `11`). Nada de esto está hoy en un sistema de tareas — vive solo como markdown en el repo.

El usuario quiere escalar la app hacia una herramienta multiplataforma de gestión de punto de venta e inventarios, en dos etapas:

1. **Etapa 1 (accionable ya):** consolidar el MVP actual de un solo negocio en las plataformas que Expo ya cubre (iOS, Android, Web).
2. **Etapa 2 (visión a futuro, sin trabajo iniciado):** evolucionar a una plataforma multi-negocio/multi-tenant con backend propio.

Ya existe un espacio de trabajo en Notion ("🗂️ Centro de Proyectos") con dos bases de datos conectadas — **Proyectos** (`Objetivo`, `Estado`, `Prioridad`, `Área`, `Periodo`, rollups de puntos) y **Tareas** (`Size` XS-XL → puntos Fibonacci, `Dificultad`, `Prioridad`, `Etiquetas`, `Fecha límite`, `Notas`, relación a `Proyecto`) — que ya sigue exactamente el patrón que este proyecto necesita.

## Decisión: Notion para tareas, `docs/` para specs técnicas

Notion es el tablero de estado (qué está pendiente/en curso/hecho, prioridad, tamaño). `docs/` sigue siendo la fuente técnica detallada (referencias `archivo:línea`, planes paso a paso, criterios de aceptación) que ya se usa bien en este repo. Cada tarea de Notion referencia su doc en el campo `Notas` en vez de duplicar el contenido — evita que las dos fuentes diverjan.

## Estructura en Notion

Dos filas nuevas en **Proyectos**, no una: separan "lo que se toca esta semana" de "visión a 6+ meses", evitando que el tablero semanal se ensucie con algo que no es accionable todavía.

| Campo | Mercado Mónaco — MVP multiplataforma | Mercado Mónaco — Plataforma multi-negocio |
|---|---|---|
| Objetivo | Consolidar la app actual (iOS/Android/Web vía Expo) para un solo negocio: cerrar deuda crítica, terminar el roadmap M5-M7, y validarla en dispositivo real. | Evolucionar de app single-tenant a plataforma con backend, cuentas y sincronización para múltiples puntos de venta. |
| Estado | In progress | Not started |
| Prioridad | Alta | Baja |
| Área | Cliente | Cliente |
| Periodo | (sin fecha fija) | (sin fecha fija) |
| Tareas | ~21 filas (ver abajo) | ninguna todavía |

El proyecto de Etapa 2 existe solo para que la visión quede escrita en algún lado con dueño y prioridad — no dispara tareas ni fechas hasta que se decida priorizarlo.

## Tareas de Etapa 1

Todas ligadas al proyecto "MVP multiplataforma", con `Size`/`Prioridad` tomados de las tablas ya existentes en `docs/README.md` y `docs/02-plan-roadmap-pendiente.md`, y `Notas` apuntando al doc y sección exactos.

**Roadmap pendiente** (`docs/02-plan-roadmap-pendiente.md`) — 9 tareas: T-12 (descuentos), T-15 (rebaja→gasto), T-16 (reporte diario), T-17 (reporte semanal/mensual + notificación), T-18 (rankings), T-19 (pérdidas desglosadas), T-20 (exportar/compartir), T-21 (respaldo/restauración), T-22 (editar/anular ventas).

**Deuda técnica transversal** (`docs/03` a `docs/09`) — 7 tareas: testing + CI, consistencia de estilos, manejo de errores, rendimiento, calidad de datos (date picker), limpieza de código, accesibilidad.

**Features ya diseñadas, no implementadas** (`docs/10`, `docs/11`) — 4 tareas: método de pago en venta a costo (accionable), ventas fiadas/deuda (diseño futuro, no roadmap inmediato — igual se registra para no perder el análisis ya hecho), editar/eliminar gastos, bloquear fecha futura en gastos.

**Admin** — 3 tareas: smoke-test en dispositivo real (nada se ha validado fuera de `tsc`/lint/bundle), corregir rutas obsoletas en `ROADMAP.md` (español → inglés), reemplazar el `README.md` boilerplate de `create-expo-app` por uno real.

Total: 23 tareas. `Estado` de cada una arranca en "Not started" salvo que ya haya trabajo iniciado.

## En `docs/` del repo

- **Nuevo `docs/12-vision-multiplataforma.md`**: documenta la Etapa 2 (multi-tenant, backend, sincronización) con las preguntas de diseño abiertas (auth, modelo de datos por negocio, estrategia de sync offline-first). Es lo que el proyecto de Notion "Plataforma multi-negocio" referencia en su `Objetivo`.
- **`docs/README.md`**: se añade una fila al índice para el doc 12, y una nota de que el tracking de tareas vive ahora en Notion (con link).
- Los docs `02`-`11` no se tocan en contenido — siguen siendo la spec técnica de cada tarea. Único cambio: corregir las rutas obsoletas en `ROADMAP.md` que ya están señaladas como deuda en `docs/01-estado-del-proyecto.md`.

## Fuera de alcance

- No se migra contenido técnico existente de `docs/` a Notion (duplicaría la fuente de verdad).
- No se crea ninguna tarea para la Etapa 2 — es solo el proyecto contenedor de la visión.
- No se decide aquí el diseño técnico de multi-tenant (auth, backend, sync) — eso es contenido de `docs/12`, no de este spec.

## Ejecución

Sin código de por medio: la "implementación" de este spec es directamente crear las filas en Notion (2 proyectos + 23 tareas) y escribir `docs/12-vision-multiplataforma.md` + actualizar `docs/README.md`. Se ejecuta directo tras aprobar este spec, sin pasar por plan formal de implementación.
