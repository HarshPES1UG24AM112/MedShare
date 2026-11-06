/**
 * node-postgres access for procedures, analytics and anything needing explicit
 * transactions or row locks. Connects as the least-privilege medshare_app role.
 */
import pg from 'pg';
import { config } from '../config.js';

// JSON-friendly type parsing: bigint ids/counts → number (all < 2^53),
// numeric → number, date → 'YYYY-MM-DD' string (never shifted by timezone).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 20, application_name: 'medshare-api' });

const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

export function camelize<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  return out as T;
}

type Queryable = pg.Pool | pg.PoolClient;

/** Runs a query and returns camelCased rows. */
export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = [], db: Queryable = pool): Promise<T[]> {
  const res = await db.query(sql, params);
  return res.rows.map((r) => camelize<T>(r));
}

export async function queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = [], db: Queryable = pool): Promise<T | undefined> {
  return (await query<T>(sql, params, db))[0];
}

type Isolation = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

/** Explicit transaction with chosen isolation level; rolls back on any error. */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  opts: { isolation?: Isolation; readOnly?: boolean } = {},
  db: pg.Pool = pool,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${opts.isolation ?? 'READ COMMITTED'}${opts.readOnly ? ' READ ONLY' : ''}`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Retries transient concurrency failures (40P01 deadlock, 40001 serialization).
 * Safe because every retried operation is a whole transaction, and stock
 * operations additionally accept idempotency keys.
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (i + 1 >= attempts || (code !== '40P01' && code !== '40001')) throw e;
      await new Promise((r) => setTimeout(r, 20 * 2 ** i + Math.random() * 50));
    }
  }
}
