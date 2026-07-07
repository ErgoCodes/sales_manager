import { Palette, type ColorScheme } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Returns the active scheme's flattened palette (base colors + semantic
 * tokens) plus the resolved scheme name. Use this in inline-styled screens
 * instead of referencing `Colors.light.*` / `Semantic.*` directly, so they
 * adapt to light/dark. The className layer uses `dark:` variants instead.
 *
 * Example:
 *   const c = useAppColors();
 *   <View style={{ backgroundColor: c.surface }}>
 */
export function useAppColors(): (typeof Palette)[ColorScheme] & { scheme: ColorScheme } {
  const scheme: ColorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { ...Palette[scheme], scheme };
}
