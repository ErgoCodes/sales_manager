import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

export type DbClient = BaseSQLiteDatabase<'sync', any, any>;
type ExpoDb = ReturnType<typeof drizzle>;

let activeDb: DbClient | undefined;
let activeExpoDb: ExpoDb | undefined;

export function createDbClient(name = 'db.sqlite'): ExpoDb {
  return drizzle(openDatabaseSync(name));
}

export function initDb(name = 'db.sqlite'): ExpoDb {
  const db = createDbClient(name);
  activeDb = db;
  activeExpoDb = db;
  return db;
}

export function setDb(instance: DbClient): void { activeDb = instance; }
export function getDb(): DbClient {
  if (!activeDb) throw new Error('Database client has not been initialized.');
  return activeDb;
}
export function getExpoDb(): ExpoDb {
  if (!activeExpoDb) throw new Error('Expo database client has not been initialized.');
  return activeExpoDb;
}
