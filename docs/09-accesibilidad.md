# 09 · Accesibilidad

**Prioridad: MEDIA · Esfuerzo: medio día-1 día (incremental)**

## Estado actual

Hay una base parcial: los botones de icono del header sí tienen `accessibilityLabel` ([app/(tabs)/_layout.tsx:15-33](<../app/(tabs)/_layout.tsx#L15-L33>)) y `hitSlop`. Pero el patrón no se extendió al resto:

- **Pressables sin rol ni etiqueta:** las quick actions del Home ([app/(tabs)/index.tsx:30-45](<../app/(tabs)/index.tsx#L30-L45>)), los chips de filtro de inventario/catálogo/historiales, los botones de método de pago (Efectivo/Transferencia/A costo) en new-session, las filas tocables de las listas (producto → editar, venta → detalle) y las opciones del `ProductPicker` ([components/ui/product-picker.tsx:76-84](../components/ui/product-picker.tsx#L76-L84)). Un lector de pantalla los anuncia como texto suelto, sin indicar que son botones ni cuál está activo.
- **Checkboxes que son glifos de texto:** los toggles tipo "Mostrar archivados", "¿Venta a trabajador?" o "Actualizar precios del catálogo" se renderizan como `☑/☐` dentro de un Pressable, sin `accessibilityRole="checkbox"` ni `accessibilityState={{ checked }}`.
- **Estado no comunicado:** los filtros activos (chip seleccionado, toggle "Solo stock bajo") solo cambian visualmente; sin `accessibilityState={{ selected }}` un usuario de TalkBack no sabe qué filtro está aplicado.
- **Objetivos táctiles:** varios controles pequeños (el ✕ de quitar línea del carrito, chips) pueden quedar por debajo de los 44×44 pt recomendados; el `hitSlop={10}` del header es el patrón correcto a replicar.

La usuaria objetivo es una sola persona, pero la accesibilidad aquí no es solo lectores de pantalla: **roles, estados y áreas táctiles grandes hacen la app más usable para cualquiera** que registra 30 ventas seguidas con prisa al final del día.

## Plan de mejora

### Paso 1 — Arreglarlo una vez, en los componentes compartidos

La mayor parte del problema se corrige en `components/ui/` y se propaga solo:

- `Button` ([components/ui/button.tsx](../components/ui/button.tsx)): `accessibilityRole="button"` por defecto + `accessibilityState={{ disabled }}`.
- Crear `components/ui/chip.tsx` (hoy cada pantalla fabrica sus chips con Pressable ad hoc): `accessibilityRole="button"` + `accessibilityState={{ selected }}` + `minHeight: 44` de área táctil. Migrar los filtros de inventario, catálogo e historiales.
- Crear `components/ui/checkbox.tsx` que sustituya los glifos `☑/☐`: `accessibilityRole="checkbox"`, `accessibilityState={{ checked }}`, label tocable completo. Migrar los 3-4 toggles existentes.
- `ProductPicker`: `accessibilityRole="button"` y label `"{nombre}, stock {n}"` en cada opción.

### Paso 2 — Barrido de pantallas

Con los componentes listos, pasada rápida por pantalla para los Pressables restantes (quick actions, botones de pago, filas de lista, ✕ del carrito): rol + label + `hitSlop` donde el control sea menor de 44 pt. Regla simple para el futuro: **ningún `Pressable` nuevo sin `accessibilityRole`** (y `accessibilityLabel` si su contenido no es texto descriptivo).

### Paso 3 — Verificación en dispositivo

- Activar TalkBack (Android) y recorrer los 3 flujos críticos: registrar una venta, registrar una entrada, consultar el resumen del día. Cada control debe anunciar qué es y su estado.
- Revisar contrastes de los textos secundarios sobre fondos claros (los grises tipo `#94A3B8` sobre blanco rondan el límite AA para texto pequeño) durante la migración de estilos de [04-consistencia-de-estilos.md](04-consistencia-de-estilos.md).

## Criterio de hecho

- `grep -rn "<Pressable" app/ components/ | wc -l` vs. los que tienen rol: todo Pressable interactivo declara `accessibilityRole` (o está envuelto en un componente ui que lo hace).
- No queda ningún `☑`/`☐` textual en el código.
- El flujo de venta completo es operable con TalkBack anunciando roles y estados correctos.
