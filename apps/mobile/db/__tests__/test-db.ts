import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { setDb } from '../client';

const sqlite = new Database(':memory:');

const drizzlePath = join(__dirname, '../../drizzle');
const migrationFiles = readdirSync(drizzlePath)
  .filter((f) => f.endsWith('.sql'))
  .sort();

for (const file of migrationFiles) {
  sqlite.exec(readFileSync(join(drizzlePath, file), 'utf8'));
}

setDb(drizzle(sqlite));
