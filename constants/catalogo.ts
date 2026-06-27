/** Unidades de medida soportadas por un producto. */
export const UNIDADES_MEDIDA = [
  { label: 'Unidad', value: 'ud' },
  { label: 'Kg', value: 'kg' },
  { label: 'Litro', value: 'litro' },
  { label: 'Caja', value: 'caja' },
] as const;

export type UnidadMedida = (typeof UNIDADES_MEDIDA)[number]['value'];

/** Categorías predefinidas del catálogo (editables en código). */
export const CATEGORIAS = [
  'Bebidas',
  'Granos',
  'Lácteos',
  'Cárnicos',
  'Limpieza',
  'Aseo personal',
  'Snacks',
  'Otros',
] as const;

export type Categoria = (typeof CATEGORIAS)[number];

/** Opciones de categoría listas para usar en un Select. */
export const CATEGORIA_OPTIONS = CATEGORIAS.map((c) => ({ label: c, value: c }));
