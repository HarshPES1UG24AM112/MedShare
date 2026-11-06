import { config as loadEnv, parse } from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
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
  await restoreDevelopmentGraph();
}

// The network tests rebuild the single Neo4j graph from the test database; put the
// development graph back so the running app keeps showing its own data.
async function restoreDevelopmentGraph() {
  const env = parse(readFileSync(resolve(__dirname, '../../.env')));
  if (!env.NEO4J_URL || !env.DATABASE_URL) return;
  const [{ syncGraph }, { closeGraph }, { pool }] = await Promise.all([
    import('../src/graph/sync.js'),
    import('../src/graph/neo4j.js'),
    import('../src/db/pool.js'),
  ]);
  const dev = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 });
  try {
    await syncGraph(dev);
  } catch (e) {
    console.warn(`Development graph not restored (${(e as Error).message}); run \`npm run graph:sync\`.`);
  } finally {
    await Promise.allSettled([dev.end(), pool.end(), closeGraph()]);
  }
}
