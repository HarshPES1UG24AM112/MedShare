import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

loadEnv({ path: resolve(__dirname, '../.env') });

// API tests run against a dedicated, freshly migrated + seeded PostgreSQL
// database (never SQLite, never the development database).
const testDb = new URL(process.env.DATABASE_URL ?? 'postgres://medshare_app@localhost:5433/medshare');
testDb.pathname = '/medshare_api_test';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    setupFiles: ['./tests/setup.ts'],
    env: { NODE_ENV: 'test', DATABASE_URL: testDb.toString() },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
