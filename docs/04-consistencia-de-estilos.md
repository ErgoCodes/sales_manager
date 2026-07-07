# 04 · Consistencia de estilos

**Prioridad: MEDIA · Esfuerzo: 1-2 días**

## Estado actual

Conviven **dos sistemas de estilos**:

1. **Estilos inline con hex hardcodeados** en las 4 pantallas de tabs: [app/(tabs)/index.tsx](<../app/(tabs)/index.tsx>), `inventory.tsx`, `sales.tsx`, `expenses.tsx`, más [app/(tabs)/_layout.tsx](<../app/(tabs)/_layout.tsx>) (p. ej. `#FFFFFF`, `#E2E8F0`/`#F1F5F9` en `_layout.tsx:27`, y decenas de objetos `style={{…}}` con `#0F172A`, `#94A3B8`, `rgba(255,255,255,0.08)` en `index.tsx`).
2. **uniwind `className`** en el resto: catálogo, formularios, historiales, ProductPicker y todos los `components/ui/*`.

Además:

- **`formatCurrency` duplicado en 4 archivos** con el locale `'es-CU'` hardcodeado cada vez: [index.tsx:15](<../app/(tabs)/index.tsx#L15>), `inventory.tsx:24`, `sales.tsx:18`, `expenses.tsx:35`.
- **Modo oscuro definido pero muerto:** `constants/theme.ts` tiene paleta `dark` completa y existen `hooks/use-theme-color.ts` + `use-color-scheme.ts`, pero nada en `app/` los usa; `app.json` fuerza `userInterfaceStyle: "light"` y `app/_layout.tsx` usa siempre `DefaultTheme`.

## Problema / impacto

- Cambiar un color de marca exige tocar decenas de literales repartidos por 5 archivos.
- Dos lenguajes visuales → deriva de diseño entre tabs y formularios (radios, sombras y grises ligeramente distintos).
- La infra de dark mode muerta confunde: parece soportado y no lo está.

## Plan de mejora

### Paso 1 — `formatCurrency` compartido (30 min, hacerlo ya)

Crear `lib/format.ts`:

```ts
const LOCALE = 'es-CU';

export function formatCurrency(value: number, opts?: { compact?: boolean }): string {
  if (opts?.compact) return `$${value.toLocaleString(LOCALE, { maximumFractionDigits: 0 })}`;
  return `$${value.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
```

Borrar las 4 copias e importar desde `@/lib/format`. Los reportes de M5 lo van a necesitar también — hacerlo **antes** de empezar T-16 evita una quinta copia.

### Paso 2 — Tokens en Tailwind (medio día)

Definir en `tailwind.config.js` los colores que hoy son literales (`primary`, `surface`, `text-strong`/`text-muted`, `border`, y los tonos semánticos de `Semantic` en `constants/theme.ts`), de modo que `className="bg-surface text-strong"` sustituya a `style={{ backgroundColor: '#FFFFFF', color: '#0F172A' }}`. `constants/theme.ts` queda como única fuente para lo que react-navigation necesita como objeto JS (tab bar, headers).

### Paso 3 — Migrar los 4 tabs a uniwind (1 día)

Una pantalla por commit, empezando por la más simple (`expenses.tsx`) y dejando `index.tsx` (la más grande) para el final. Regla práctica: `style` inline solo queda permitido para valores dinámicos (anchos proporcionales, colores calculados en runtime); todo lo estático pasa a `className`. Verificación visual lado a lado en el emulador tras cada pantalla (no hay tests de UI).

### Paso 4 — Decisión sobre dark mode

**Recomendación: eliminar la infra muerta ahora.** La app es para una sola usuaria, `app.json` fija light, y mantener una paleta paralela sin usar es coste sin beneficio. Borrar `Colors.dark`, `hooks/use-color-scheme*.ts`, `hooks/use-theme-color.ts`, `components/themed-text.tsx` y `themed-view.tsx` (ver [08-limpieza-de-codigo.md](08-limpieza-de-codigo.md)).

Alternativa si se quiere dark mode de verdad: hacerlo **después** del paso 3 (con tokens, es cambiar los valores de las variables en un solo sitio: `dark:` variants de Tailwind + quitar `userInterfaceStyle: light`). Hacerlo antes de la migración duplicaría el trabajo.

## Criterio de hecho

- `grep -rn "toLocaleString('es-CU'" app/` devuelve 0 resultados fuera de `lib/format.ts`.
- Ningún hex literal en `app/(tabs)/*.tsx` (los colores viven en `tailwind.config.js` / `constants/theme.ts`).
- Las 4 pantallas de tabs se ven igual que antes (comparación visual).
- No queda código de theming sin usar (o el dark mode funciona de verdad, según la decisión).
