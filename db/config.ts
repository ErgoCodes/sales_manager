import { eq } from 'drizzle-orm';

import { db } from './client';
import { configuracion } from './schema';

/** Claves de configuración del negocio y sus valores por defecto (como texto). */
export const CONFIG_KEYS = {
  nombreNegocio: 'nombre_negocio',
  descuentoEfectivoPct: 'descuento_efectivo_pct',
  umbralStockGeneral: 'umbral_stock_general',
} as const;

export const CONFIG_DEFAULTS: Record<string, string> = {
  [CONFIG_KEYS.nombreNegocio]: '',
  [CONFIG_KEYS.descuentoEfectivoPct]: '10',
  [CONFIG_KEYS.umbralStockGeneral]: '5',
};

/** Lee un valor de configuración; devuelve null si no existe. */
export async function getConfig(clave: string): Promise<string | null> {
  const [row] = await db
    .select({ valor: configuracion.valor })
    .from(configuracion)
    .where(eq(configuracion.clave, clave));
  return row?.valor ?? null;
}

/** Inserta o actualiza un valor de configuración (upsert por clave). */
export async function setConfig(clave: string, valor: string): Promise<void> {
  await db
    .insert(configuracion)
    .values({ clave, valor })
    .onConflictDoUpdate({ target: configuracion.clave, set: { valor } });
}

/** Devuelve todas las claves con sus valores, aplicando defaults a las ausentes. */
export async function getAllConfig(): Promise<Record<string, string>> {
  const rows = await db.select().from(configuracion);
  const result: Record<string, string> = { ...CONFIG_DEFAULTS };
  for (const row of rows) {
    result[row.clave] = row.valor;
  }
  return result;
}
