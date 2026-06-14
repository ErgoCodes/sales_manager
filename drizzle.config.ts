import type { Config } from 'drizzle-kit';

export default {
  schema: './db/schema.ts',
  driver: 'expo',
  dbCredentials: {
    database: 'db.sqlite',
  },
} satisfies Config;
