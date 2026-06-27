# ROADMAP — Mercado Mónaco MVP

**Sistema de Gestión de Inventario y Ventas · Yamile · Versión 1.0 · Offline-First**

| Total tareas | 23 | Días estimados | ~35 | Plataforma | App Móvil + Offline |
|---|---|---|---|---|---|

**Leyenda:** `ALTA` tarea MUST · `MEDIA` tarea SHOULD · `[ ]` pendiente · `[x]` completado

---

## T-00 · Scaffolding de librerías principales `ALTA` `2d`

> Instalar y configurar todas las dependencias clave antes de escribir código de dominio. Sin esto, T-01 en adelante no puede arrancar.

- [x] Instalar y configurar Uniwind + Tailwind CSS
  - [x] `pnpm add uniwind tailwindcss`
  - [x] Crear `tailwind.config.js` con content paths para `app/**` y `components/**`
  - [x] Agregar `global.css` con directivas `@tailwind`
  - [x] Configurar Uniwind en `metro.config.js` con `withUniwindConfig` (no babel plugin)
  - [x] Agregar import de `global.css` en `app/_layout.tsx`
  - [x] Verificar que className funciona: expo export bundla 1539 módulos sin errores
- [x] Componentes base bajo `components/ui/` (Button, Input, Text con variantes y className)
  - [x] Configurar alias `~/` en `tsconfig.json` (Metro lo resuelve nativamente)
  - [x] Crear `components/ui/button.tsx`, `input.tsx`, `text.tsx`
- [x] Instalar date-fns
  - [x] `pnpm add date-fns`
  - [x] Disponible para uso con locale `es` (sin verificación extra requerida)
- [x] Instalar expo-sqlite + Drizzle ORM
  - [x] `pnpm add expo-sqlite drizzle-orm`
  - [x] `pnpm add -D drizzle-kit`
  - [x] Crear `drizzle.config.ts` apuntando a `db/schema.ts`
  - [x] Crear carpeta `db/` con `schema.ts` vacío y `client.ts` que abre la conexión SQLite
- [x] Instalar expo-notifications
  - [x] `pnpm add expo-notifications`
  - [x] Agregar plugin `expo-notifications` en `app.json`
  - [x] Crear helper `lib/notifications.ts` con función `requestPermissions()`
- [x] Instalar expo-sharing + expo-file-system
  - [x] `pnpm add expo-sharing expo-file-system`
- [x] Instalar Zustand
  - [x] `pnpm add zustand`
  - [x] Crear `store/index.ts` con stores vacíos: `useDailySummaryStore`, `useCartStore`
- [x] Instalar react-hook-form + Zod
  - [x] `pnpm add react-hook-form zod @hookform/resolvers`
- [x] Smoke test: Metro bundló 1539 módulos para Android sin errores (`expo export` OK)

**Acepta si:** la app inicia sin crashes, NativeWind aplica estilos, la conexión SQLite no lanza errores en consola.

---

## M0 · Sistema base

### T-01 · Base de datos local y esquema de datos `ALTA` `2d`

> Crear el esquema SQLite completo con Drizzle. Todo el MVP depende de esto.

- [x] Crear tabla `productos` en `db/schema.ts`
  - Campos: `id`, `nombre`, `unidad_medida` (ud/kg/litro/caja), `categoria`, `precio_costo`, `precio_efectivo`, `precio_transferencia`, `costo_promedio`, `umbral_alerta`, `fecha_vencimiento`, `activo`
- [x] Crear tabla `movimientos_almacen`
  - Campos: `id`, `producto_id`, `tipo` (entrada/salida/merma/perdida/retiro_owner/ajuste), `cantidad`, `fecha`, `precio_costo_unitario` (obligatorio, sin default), `precio_venta`, `notas`
- [x] Crear tabla `ventas`
  - Campos: `id`, `producto_id`, `cantidad`, `precio_aplicado`, `metodo_pago` (efectivo/transferencia/costo), `costo_al_vender` (congelado al momento), `utilidad`, `fecha`, `descuento_pct`, `anulada` (bool)
- [x] Crear tabla `gastos`
  - Campos: `id`, `tipo` (salario/multa/onat/rebaja_liquidacion), `concepto`, `monto`, `fecha`
- [x] Crear tabla `configuracion`
  - Campos: `clave`, `valor`
- [x] Aplicar índices en `producto_id` y `fecha` para cálculo rápido de stock derivado
- [x] Crear función SQL/Drizzle `calcularStock(productoId)`: `SUM(entradas+ajuste) - SUM(salidas+ventas+mermas+retiros)` (en `db/queries.ts`)
- [x] Crear función `recalcularCostoPromedio(productoId, cantidadNueva, costoNuevo)`: promedio ponderado (verificado: 4u×100 + 10u×130 → 121.43)
- [x] Ejecutar migration inicial: `drizzle-kit generate` (`drizzle/0000_dark_payback.sql`) + `useMigrations` en `app/_layout.tsx`; bundle Android OK (1684 módulos)
- [ ] Test: datos persisten después de cerrar y reabrir la app (pendiente: requiere device/emulador)

**Depende de:** T-00

**Acepta si:** tablas existen, stock se calcula de movimientos (no contador), costo promedio ponderado correcto en simulación de dos entradas con costos distintos.

---

### T-02 · Estructura de navegación y configuración inicial `ALTA` `1d`

> App navegable de extremo a extremo. MVP: un solo usuario (Yamile/Admin).

- [x] Reemplazar tabs del starter por navegación principal: Inicio, Inventario, Ventas, Gastos, Reportes (Configuración como pantalla de stack vía engranaje en Inicio)
- [x] Crear pantalla de inicio (`app/(tabs)/index.tsx`) con widget de resumen del día
  - Mostrar: total efectivo, total transferencia, total/utilidad, alertas de stock bajo (`resumenDelDia` + `contarStockBajo` en `db/queries.ts`)
  - Datos reales desde DB (aunque estén vacíos al inicio)
- [x] Crear pantalla de Configuración (`app/configuracion.tsx`)
  - Campos: nombre del negocio, % descuento por efectivo (default 10%), umbral de stock general (default 5) — umbrales por categoría se refinan en T-07
  - Persistir en tabla `configuracion` (`db/config.ts`: getConfig/setConfig/getAllConfig + react-hook-form + zod)
- [x] Navegación fluida: cualquier módulo accesible desde inicio en ≤2 toques
- [x] Aplicar NativeWind + colores del tema a layouts base
- [x] Limpieza del starter: eliminados explore, modal, hello-wave, parallax, external-link, collapsible

**Depende de:** T-01

**Acepta si:** configuración persiste al cerrar app, resumen del día visible al abrir. *(persistencia/navegación runtime pendiente de verificación en device/emulador; tsc + lint + bundle Android OK)*

---

## M1 · Catálogo y precios

### T-03 · Catálogo de productos — alta y edición `ALTA` `2d`

> Pantalla para crear y editar los 20-50 productos del mercado.

- [ ] Pantalla lista de productos (`app/catalogo/index.tsx`)
  - Buscador por nombre
  - Filtro por categoría
  - Mostrar stock actual calculado junto a cada producto
- [ ] Formulario nuevo/editar producto (`app/catalogo/[id].tsx`)
  - Campos: nombre (texto), unidad de medida (selector), categoría (selector), umbral de alerta de stock
  - Validar con Zod: nombre no vacío, umbral > 0
  - Integrar con react-hook-form
- [ ] Opción archivar/desactivar producto (soft delete — `activo = false`)
  - Producto archivado no aparece en ventas pero sí en historial
- [ ] Botón editar en cada ítem de la lista

**Depende de:** T-01, T-02

**Acepta si:** crear producto con todos los campos, archivar sin perder historial, lista muestra stock actual.

---

### T-04 · Gestión de precios de los productos `ALTA` `1d`

> Tres precios por producto. Transferencia se calcula solo. Solo Yamile puede modificar.

- [ ] Agregar campos al formulario de producto: `precio_costo` y `precio_efectivo`
- [ ] Cálculo automático en tiempo real del `precio_transferencia`: `efectivo × 1.10` redondeado al múltiplo de 5 más cercano
  - Función: `Math.round(result / 5) * 5`
- [ ] Mostrar los tres precios calculados antes de guardar
- [ ] Guardar los tres precios en tabla `productos`
- [ ] Test de redondeo: efectivo=47 → transferencia=50; efectivo=20 → transferencia=20

**Depende de:** T-03

**Acepta si:** transferencia se actualiza en vivo al cambiar efectivo, redondeo correcto en ambos casos de prueba.

---

### T-05 · Sugerencia de precio óptimo (costo + 30%) `MEDIA` `1d`

> Orientativo. Yamile puede ignorarlo o aceptarlo.

- [ ] Mostrar badge junto a campo `precio_efectivo`: `≈ Precio sugerido: X (costo +30%)`
- [ ] Botón "Usar sugerido" que rellena el campo con `costo × 1.30`
- [ ] La sugerencia no se aplica automáticamente — requiere acción de Yamile
- [ ] Si Yamile escribe un precio diferente, la sugerencia no lo sobreescribe

**Depende de:** T-04

**Acepta si:** costo=100 → sugerencia=130; botón aplica valor; escritura manual no es sobreescrita.

---

## M2 · Inventario de almacén

### T-06 · Registro de entradas al almacén `ALTA` `2d`

> Yamile registra cada compra. Costo siempre obligatorio.

- [ ] Pantalla nueva entrada (`app/inventario/entrada.tsx`)
  - Selector de producto (búsqueda por nombre)
  - Campo cantidad
  - Mostrar precios actuales del producto (costo, efectivo, transferencia)
  - Opción de actualizar precios en el mismo formulario
- [ ] Campo `precio_costo_unitario`: pre-rellenado con último costo del producto, pero Yamile debe confirmar o corregir antes de guardar (no tiene `default`, es obligatorio)
- [ ] Campo fecha (default hoy, editable)
- [ ] Campo notas (opcional)
- [ ] Al confirmar: insertar movimiento tipo `entrada`, recalcular `costo_promedio` del producto (promedio ponderado), stock sube automáticamente
- [ ] Si se actualiza precio de venta en la entrada → actualizar catálogo
- [ ] Historial de entradas (`app/inventario/historial.tsx`): filtrable por producto y fecha, mostrando costo de cada entrada

**Depende de:** T-03, T-04

**Acepta si:** no se puede guardar sin costo, stock sube tras entrada, costo promedio ponderado correcto (4u×100 + 10u×130 → promedio=121.4).

---

### T-07 · Stock en tiempo real y alertas de stock bajo `ALTA` `1d`

> El inventario es la pantalla operativa diaria de Yamile.

- [ ] Pantalla de inventario (`app/inventario/index.tsx`)
  - Lista todos los productos con stock actual (calculado), costo promedio, valor por producto (`stock × costo_promedio`)
  - Total del valor del inventario al pie
- [ ] Indicador visual (rojo/ícono) para productos bajo umbral
- [ ] Umbrales por defecto: bebidas enlatadas ≤24, granos ≤6, resto ≤5 (respetando umbral por producto si está configurado)
- [ ] Filtro rápido "Solo stock bajo"
- [ ] Stock se recalcula en tiempo real sin recargar manualmente

**Depende de:** T-06

**Acepta si:** stock correcto, valor total coincide con suma, producto bajo umbral diferenciado visualmente, umbral personalizado respetado.

---

### T-08 · Control de fecha de vencimiento y alertas de producto estancado `MEDIA` `1d`

> Detectar el picadillo de la historia.

- [ ] Agregar campo opcional `fecha_vencimiento` al formulario de producto/entrada
- [ ] Lógica "producto estancado": sin venta en últimos 7 días O movimiento lento vs. stock actual
- [ ] Alerta visible en pantalla de inventario: productos próximos a vencer (<7 días) o estancados
- [ ] Al tocar producto estancado: mostrar opción "Sugerir rebaja" con botón de aprobación de Yamile
- [ ] Si Yamile aprueba: registrar nuevo `precio_efectivo`, recalcular `precio_transferencia` automáticamente

**Depende de:** T-07

**Acepta si:** sin ventas en 7d → marcado estancado, vencimiento próximo destacado, rebaja no se aplica sola.

---

## M3 · Registro de ventas

### T-09 · Registro de ventas en lote (entrada rápida de fin de día) `ALTA` `3d`

> Pantalla principal de uso diario. Diseño decide si la app se usa o se abandona.

- [ ] Pantalla de captura en lote (`app/ventas/nueva-sesion.tsx`)
  - Buscador de producto siempre visible arriba
  - Lista de ventas de la sesión en curso abajo
  - Total acumulado en vivo: efectivo / transferencia / total
- [ ] Flujo sin cambiar de pantalla: producto → cantidad → [Efectivo | Transferencia] → cae a lista → foco vuelve al buscador
- [ ] Al elegir método de pago:
  - Efectivo → precio base
  - Transferencia → `precio_base × 1.10` redondeado
  - Capturar `costo_promedio` vigente como `costo_al_vender`
  - Calcular `utilidad = (precio_aplicado - costo_al_vender) × cantidad`
- [ ] Botón quitar línea antes de guardar sesión (corrección inmediata)
- [ ] Campo fecha de sesión (default hoy, editable — para registrar día pasado)
- [ ] Botón "Guardar sesión": descuenta stock de cada producto, persiste todas las ventas con fecha elegida
- [ ] Validación: advertir (sin bloquear) si venta dejaría stock negativo

**Depende de:** T-06, T-07

**Acepta si:** 30+ ventas seguidas sin volver al menú, total efectivo/transferencia correcto en vivo, stock baja al guardar, fecha pasada funciona.

---

### T-10 · Registro de venta a trabajadores (precio de costo) `MEDIA` `1d`

> Botón especial en pantalla de venta. Utilidad siempre 0.

- [ ] Toggle visible "¿Venta a trabajador?" en pantalla de registro
- [ ] Al activar: precio aplicado cambia a `precio_costo`, utilidad muestra 0
- [ ] Método de pago sigue siendo seleccionable (efectivo o transferencia)
- [ ] Venta a trabajador queda etiquetada (`metodo_pago = 'costo'`) en historial

**Depende de:** T-09

**Acepta si:** precio cambia a costo al activar, utilidad=0, diferenciado en historial.

---

### T-11 · Resumen del día: efectivo vs. transferencia `ALTA` `1d`

> El problema principal que Yamile quiere resolver.

- [ ] Widget prominente en pantalla de inicio con resumen del día en curso
  - Total efectivo del día
  - Total transferencia del día
  - Total general del día
  - Utilidad total del día
- [ ] Opción de ver desglose por producto del día
- [ ] Selector de fecha para ver resumen de cualquier día pasado
- [ ] Historial de ventas (`app/ventas/historial.tsx`): buscador por fecha y producto (base para T-22)

**Depende de:** T-09

**Acepta si:** totales correctos y actualizados al registrar venta, resumen del día visible al abrir app, consulta de días anteriores funciona.

---

### T-12 · Descuentos de marketing en ventas `MEDIA` `1d`

> Descuento puntual sin modificar precio base del catálogo.

- [ ] Campo opcional `% descuento` en pantalla de registro de venta
- [ ] Al introducir porcentaje, precio final se recalcula en pantalla antes de confirmar
- [ ] Descuento guardado como campo separado en `ventas.descuento_pct`
- [ ] Precio base del catálogo no se modifica

**Depende de:** T-09, T-10

**Acepta si:** descuento no cambia catálogo, queda registrado en historial, precio final correcto.

---

## M4 · Pérdidas y gastos

### T-13 · Registro de retiros del Owner y mermas `ALTA` `1d`

> Salidas de inventario sin ingreso. Incluye ajuste de inventario físico.

- [ ] Pantalla nueva salida no-venta (`app/gastos/salida.tsx`)
  - Selector de producto, cantidad, tipo (`retiro_owner` / `merma` / `ajuste`), fecha, notas
- [ ] Al confirmar: descontar del stock (movimiento con tipo correspondiente)
- [ ] `retiro_owner` y `merma` → pérdida contable (no ingreso)
- [ ] `ajuste` → cuadra sistema con conteo físico (puede ser positivo o negativo)
- [ ] Historial de pérdidas filtrable por tipo y fecha

**Depende de:** T-07

**Acepta si:** retiro Owner descuenta stock en tiempo real, merma registrada con tipo correcto, ajuste corrige en ambas direcciones.

---

### T-14 · Registro de salarios, multas y ONAT `MEDIA` `1d`

> Gastos periódicos que reducen la utilidad real.

- [ ] Pantalla nuevo gasto (`app/gastos/nuevo.tsx`)
  - Tipo: salario / multa / onat
  - Concepto (texto libre)
  - Monto, fecha
- [ ] ONAT: monto manual que Yamile introduce cuando paga (no % automático por venta)
- [ ] Historial de gastos filtrable por tipo y fecha
- [ ] Gastos se suman en reportes como partida negativa

**Depende de:** T-01

**Acepta si:** los tres tipos registrables, ONAT no descuenta automáticamente, aparecen en reportes como pérdida.

---

### T-15 · Registro de rebajas por liquidación `MEDIA` `1d`

> Al aprobar rebaja de T-08, registrar automáticamente la pérdida potencial.

- [ ] Al aprobar rebaja desde T-08: insertar gasto tipo `rebaja_liquidacion` automáticamente
  - Campos: producto, `diferencia_precio × stock_disponible`, fecha
- [ ] Mostrar en historial de gastos con producto y monto de pérdida potencial
- [ ] Ventas posteriores al precio rebajado usan nuevo precio; pérdida ya contabilizada al aprobar

**Depende de:** T-08, T-14

**Acepta si:** rebaja aprobada → gasto aparece solo, ventas siguientes usan precio rebajado, reporte de pérdidas incluye rebajas como partida separada.

---

## M5 · Reportes

### T-16 · Reporte diario de ventas `ALTA` `2d`

> Diseñado para mostrarse en pantalla al jefe.

- [ ] Pantalla reporte diario (`app/reportes/diario.tsx`) con selector de fecha
- [ ] Tabla de ventas del día: nombre, cantidad, método de pago, importe, `costo_al_vender`, utilidad real
- [ ] Resumen al tope: total efectivo / total transferencia / total general / utilidad total
- [ ] Sección de inventario actual: productos con stock y alertas de stock bajo
- [ ] Diseño limpio y legible en pantalla sin exportar

**Depende de:** T-11, T-13

**Acepta si:** totales correctos, estado de inventario al momento de ver el reporte, legible directamente en el móvil.

---

### T-17 · Reporte semanal y mensual `ALTA` `2d`

> El reporte mensual es el que Yamile comparte con Pupo.

- [ ] Pantalla de reportes con selector de período: semana actual / semana anterior / mes actual / mes anterior / rango personalizado
- [ ] Vista semanal: misma estructura que diario pero agregado por día
- [ ] Vista mensual: ingresos totales, utilidades, pérdidas desglosadas por categoría; transferencias destacadas visualmente
- [ ] Notificación local los lunes a las 9 a.m.: "Genera y comparte el reporte semanal con Pupo"
  - Usar `expo-notifications` configurado en T-00
  - Programar notificación recurrente al primer uso

**Depende de:** T-16, T-14

**Acepta si:** semanal suma correctamente los 7 días, mensual incluye ingresos+utilidades+pérdidas, notificación llega lunes 9am con app cerrada.

---

### T-18 · Rankings de productos (más vendidos y mayor utilidad) `ALTA` `1d`

> Saber qué vende más y qué genera más.

- [ ] Pantalla de rankings (`app/reportes/rankings.tsx`) con selector de período
- [ ] Ranking 1 "Más vendidos": por unidades vendidas → nombre, cantidad total, importe generado
- [ ] Ranking 2 "Más rentables": por utilidad acumulada → nombre, utilidad total, margen %
- [ ] Visualización clara: lista ordenada numerada con indicador proporcional

**Depende de:** T-16

**Acepta si:** ranking unidades coincide con suma real, ranking utilidad = `(precio_venta - precio_costo) × cantidad` acumulado, ambos para distintos períodos.

---

### T-19 · Reporte de pérdidas y gastos desglosado `MEDIA` `1d`

> Todas las pérdidas agrupadas por categoría.

- [ ] Pantalla reporte pérdidas (`app/reportes/perdidas.tsx`) con selector de período
- [ ] Agrupar por: Retiros Owner / Mermas / Salarios / Multas / ONAT / Rebajas
- [ ] Subtotal por categoría + total general
- [ ] Lista de registros individuales expandible por categoría

**Depende de:** T-13, T-14, T-15

**Acepta si:** todas las categorías presentes, subtotales correctos, total = suma de categorías.

---

### T-20 · Exportar y compartir reportes por WhatsApp `ALTA` `2d`

> Desde cualquier reporte, un toque para compartir.

- [ ] Botón "Compartir" en todos los reportes: diario, semanal, mensual, rankings, pérdidas
- [ ] Generar imagen del reporte (screenshot de la vista usando `react-native-view-shot` o similar) o PDF simple
- [ ] Llamar al share sheet nativo (`expo-sharing`) con el archivo generado
- [ ] Archivo legible en pantalla de móvil sin zoom excesivo
- [ ] Nombre de archivo con fecha: `reporte_diario_2025-06-01.pdf`
- [ ] Flujo funciona offline (generación es local; WhatsApp necesita internet para enviar)

**Depende de:** T-16, T-17, T-18, T-19

**Acepta si:** botón en todos los reportes, share sheet nativo abre, archivo contiene toda la info del reporte.

---

## M6 · Respaldo de datos

### T-21 · Respaldo y restauración de la base de datos `ALTA` `2d`

> La red de seguridad del MVP. Sin esto, perder el teléfono = perder el negocio.

- [ ] Función exportar: empaquetar DB local en archivo de respaldo con fecha → `respaldo_monaco_2025-06-10.db`
  - Usar `expo-file-system` para leer el archivo SQLite
- [ ] Compartir archivo de respaldo con share sheet nativo (`expo-sharing`)
- [ ] Función restaurar: seleccionar archivo de respaldo → reemplazar DB local
  - Diálogo de confirmación previo (acción irreversible)
- [ ] Recordatorio local semanal (ej. domingos por la noche) para hacer respaldo
  - Reutilizar infraestructura de notificaciones de T-17
- [ ] Mostrar fecha del último respaldo en pantalla de Configuración

**Depende de:** T-01, T-20

**Acepta si:** backup generado en <3 toques, restaurar en teléfono limpio recupera todo, fecha del último respaldo visible, recordatorio semanal funciona con app cerrada.

---

## M7 · Corrección de datos

### T-22 · Editar y anular ventas registradas `MEDIA` `2d`

> Corregir errores de días atrás. Edición directa estilo Excel, sin libro de correcciones.

- [ ] Historial de ventas (de T-11) con buscador por fecha y producto; tocar una venta abre opciones editar/borrar
- [ ] Editar venta guardada: cambiar producto, cantidad o método de pago; recalcular utilidad; stock derivado se ajusta solo
- [ ] Borrar venta con confirmación previa
- [ ] Función "deshacer" para último borrado o edición (protección contra dedo gordo)
- [ ] Devoluciones: se manejan borrando o reduciendo la venta original (mismo mecanismo)
- [ ] Totales del día y reportes se recalculan en vivo tras cualquier corrección

**Depende de:** T-09, T-11

**Acepta si:** venta de días atrás encontrable y editable, stock se ajusta automáticamente (gracias a stock derivado de T-01), borrado pide confirmación y puede deshacerse, reportes reflejan corrección.

---

## Orden de ejecución recomendado

| Semana | Tarea | Al terminar puedes… |
|---|---|---|
| 1 | T-00 | App levanta con todas las librerías configuradas |
| 1 | T-01 | Estructura de datos funcionando |
| 1 | T-02 | App navegable de extremo a extremo |
| 1 | T-03 | Crear productos reales del mercado |
| 2 | T-04 | Ver los tres precios calcularse solos |
| 2 | T-05 | Ver la sugerencia del 30% en acción |
| 2 | T-06 | Registrar la primera compra real |
| 3 | T-07 | Ver qué productos están bajo mínimo |
| 3 | T-08 | Detectar el picadillo de la historia |
| 3–4 | T-09 | Registrar 30+ ventas seguidas como hace Yamile |
| 4 | T-10 | Aplicar precio de costo con un botón |
| 4 | T-11 | Resolver el problema principal de Yamile |
| 4 | T-12 | Aplicar descuentos sin tocar el catálogo |
| 5 | T-13 | Registrar el primer retiro del Owner (Pupo) |
| 5 | T-14 | Tener todos los gastos registrados |
| 5 | T-15 | Vincular rebaja con gasto automático |
| 6 | T-16 | Ver el primer reporte completo del día |
| 6 | T-17 | Compartir el primer reporte con Pupo |
| 7 | T-18 | Saber qué vende más y qué genera más |
| 7 | T-19 | Ver cuánto se pierde y por qué |
| 7 | T-20 | Yamile envía el reporte a Pupo por WhatsApp |
| 8 | T-21 | Proteger el negocio contra pérdida del teléfono |
| 8 | T-22 | Corregir errores de días atrás sin pelear con la app |

---

*Estimación: ~35 días de desarrollo (23 tareas). Con margen del 30-40% por setup de Expo development build y depuración: **9 a 10 semanas** para un solo desarrollador.*
