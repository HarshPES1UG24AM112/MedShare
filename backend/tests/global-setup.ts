import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { connect, dropDatabase, migrate, recreateDatabase, seed } from '../scripts/lib/database.js';

const DB = 'medshare_api_test';

export async function setup() {
  loadEnv({ path: resolve(__dirname, '../../.env') });
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is not set');
  const url = await recreateDatabase(adminUrl, DB);
  const client = await connect(url, true);
  try {
    await migrate(client, { appPassword: process.env.MEDSHARE_APP_PASSWORD, quiet: true });
    await seed(client, true);
  } finally {
    await client.end();
  }
}

export async function teardown() {
  await dropDatabase(process.env.DATABASE_ADMIN_URL!, DB);
}
