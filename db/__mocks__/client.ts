import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';

// Create an in-memory database for testing
const sqlite = new Database(':memory:');

import { readdirSync } from 'fs';

// Read all migration files
const drizzlePath = join(__dirname, '../../drizzle');
const files = readdirSync(drizzlePath)
  .filter(f => f.endsWith('.sql'))
  .sort();

for (const file of files) {
  const migrationSql = readFileSync(join(drizzlePath, file), 'utf8');
  sqlite.exec(migrationSql);
}

export const db = drizzle(sqlite);
