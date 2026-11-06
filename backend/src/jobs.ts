/**
 * Time-driven jobs (they react to the clock, not to row changes, so they are
 * scheduled functions rather than triggers). Run daily when JOBS_ENABLED=true,
 * or on demand via POST /api/v1/admin/jobs/:job.
 */
import { query, withTransaction } from './db/pool.js';
import { syncGraph } from './graph/sync.js';

export const JOBS = {
  'expiry-alerts': async () => ({ newAlerts: (await query<{ n: number }>('SELECT fn_generate_expiry_alerts() AS n'))[0].n }),
  'shortage-alerts': async () => ({ openAlerts: (await query<{ n: number }>('SELECT fn_refresh_shortage_alerts() AS n'))[0].n }),
  recommendations: async (actorId: number | null = null) => ({
    generated: await withTransaction(async (c) => (await c.query('SELECT fn_generate_recommendations($1) AS n', [actorId])).rows[0].n as number, {
      isolation: 'REPEATABLE READ',
    }),
  }),
  'analytics-refresh': async () => {
    await query('SELECT fn_refresh_analytics()');
    return { refreshed: 'mv_monthly_consumption' };
  },
  // Last, so the graph picks up the alerts and recommendations the jobs above just produced.
  'graph-sync': async () => {
    const r = await syncGraph();
    return { syncedAt: r.syncedAt, nodes: r.nodes, relationships: r.relationships };
  },
} as const;

export type JobName = keyof typeof JOBS;

export async function runAllJobs() {
  const results: Record<string, unknown> = {};
  for (const name of Object.keys(JOBS) as JobName[]) {
    try {
      results[name] = await JOBS[name]();
    } catch (e) {
      results[name] = { error: (e as Error).message };
    }
  }
  return results;
}

export function startScheduler(intervalMs = 24 * 60 * 60 * 1000) {
  const tick = () =>
    runAllJobs()
      .then((r) => console.log(`[jobs] ${new Date().toISOString()}`, JSON.stringify(r)))
      .catch((e) => console.error('[jobs] failed', e));
  void tick();
  return setInterval(tick, intervalMs);
}
