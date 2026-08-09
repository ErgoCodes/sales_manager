import { Palette, type ColorScheme } from "@/drizzle/constants/theme";

/**
 * Returns the flattened light palette (base colors + semantic tokens).
 */
export function useAppColors(): (typeof Palette)[ColorScheme] & {
  scheme: ColorScheme;
} {
  return { ...Palette.light, scheme: "light" };
}
