export const UNITS_OF_MEASURE = [{ label: 'Unidad', value: 'ud' }, { label: 'Kg', value: 'kg' }, { label: 'Litro', value: 'litro' }, { label: 'Caja', value: 'caja' }] as const;
export type UnitOfMeasure = (typeof UNITS_OF_MEASURE)[number]['value'];
export const CATEGORIES = ['Bebidas', 'Granos', 'Lácteos', 'Cárnicos', 'Limpieza', 'Aseo personal', 'Snacks', 'Otros'] as const;
export type Category = (typeof CATEGORIES)[number]; export const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ label: c, value: c })); export const CATEGORY_THRESHOLDS: Record<string, number> = { Bebidas: 24, Granos: 6 };
export function getProductThreshold(product: { lowStockThreshold: number | null; category: string | null }, generalThreshold: number): number { if (product.lowStockThreshold != null) return product.lowStockThreshold; if (product.category && CATEGORY_THRESHOLDS[product.category] != null) return CATEGORY_THRESHOLDS[product.category]; return generalThreshold; }
export function isUnitOfMeasure(value: string): value is UnitOfMeasure { return UNITS_OF_MEASURE.some((unit) => unit.value === value); }
export function isCategory(value: string): value is Category { return (CATEGORIES as readonly string[]).includes(value); }
