import type { Request } from 'express';
import type pg from 'pg';
import { pool } from '../db/pool.js';

/** API-level audit entry (actions not already audited inside the database). */
export async function audit(
  req: Request,
  action: string,
  entityType: string,
  entityId: string | number | null,
  facilityId: number | null = null,
  oldValues: unknown = null,
  newValues: unknown = null,
  db: pg.Pool | pg.PoolClient = pool,
) {
  await db.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, facility_id, old_values, new_values, request_id, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      req.user?.id ?? null,
      action,
      entityType,
      entityId === null ? null : String(entityId),
      facilityId,
      oldValues === null ? null : JSON.stringify(oldValues),
      newValues === null ? null : JSON.stringify(newValues),
      req.requestId,
      req.ip?.replace(/^::ffff:/, '') || null,
    ],
  );
}
