import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

const database = openDatabaseSync('db.sqlite');
export const db = drizzle(database);
