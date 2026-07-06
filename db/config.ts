import { eq } from 'drizzle-orm';

import { db } from './client';
import { configuration } from './schema';

export const CONFIG_KEYS = {
  businessName: 'nombre_negocio',
  cashDiscountPercent: 'descuento_efectivo_pct',
  generalStockThreshold: 'umbral_stock_general',
  stagnantDiscountPercent: 'descuento_estancado_pct',
} as const;

export const CONFIG_DEFAULTS: Record<string, string> = {
  [CONFIG_KEYS.businessName]: '',
  [CONFIG_KEYS.cashDiscountPercent]: '10',
  [CONFIG_KEYS.generalStockThreshold]: '5',
  [CONFIG_KEYS.stagnantDiscountPercent]: '15',
};

export async function getConfig(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: configuration.value })
    .from(configuration)
    .where(eq(configuration.key, key));
  return row?.value ?? null;
}

export async function setConfig(key: string, value: string): Promise<void> {
  await db
    .insert(configuration)
    .values({ key, value })
    .onConflictDoUpdate({ target: configuration.key, set: { value } });
}

export async function getAllConfig(): Promise<Record<string, string>> {
  const rows = await db.select().from(configuration);
  const result: Record<string, string> = { ...CONFIG_DEFAULTS };
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}
