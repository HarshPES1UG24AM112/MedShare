import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { ApiError } from './errors.js';

/** Wraps an async handler so rejections reach the error middleware. */
export const handler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

// Coerces query/path strings, but reports a missing value as "Required" rather than NaN.
export const id = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
  z.number({ required_error: 'Required', invalid_type_error: 'Must be a number' }).int().positive(),
) as unknown as z.ZodNumber;
export const idParam = (req: Request, name = 'id') => {
  const r = id.safeParse(req.params[name]);
  if (!r.success) throw new ApiError(400, 'BAD_REQUEST', `Invalid ${name}`);
  return r.data;
};

/** Idempotency-Key header (UUID) or null. */
export function idempotencyKey(req: Request): string | null {
  const v = req.header('Idempotency-Key');
  if (!v) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new ApiError(400, 'BAD_REQUEST', 'Idempotency-Key must be a UUID');
  }
  return v.toLowerCase();
}

export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional().transform((v) => v || undefined),
  sortBy: z.string().max(40).optional(),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});
export type ListQuery = z.infer<typeof listQuery>;

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Paginates an arbitrary SELECT in ONE round trip using count(*) OVER ().
 * The sort column is chosen from a whitelist (never interpolated from input).
 */
export async function paginate<T>(
  baseSql: string,
  params: unknown[],
  q: ListQuery,
  sortable: Record<string, string>,
  defaultSort: string,
  defaultDir: 'asc' | 'desc' = 'asc',
): Promise<{ data: T[]; meta: PageMeta }> {
  const sortKey = q.sortBy && sortable[q.sortBy] ? q.sortBy : defaultSort;
  const dir = q.sortBy && sortable[q.sortBy] ? q.sortDir : defaultDir;
  const order = `${sortable[sortKey]} ${dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`;
  const offset = (q.page - 1) * q.pageSize;
  const rows = await query<T & { totalCount: number }>(
    `SELECT t.*, count(*) OVER () AS total_count FROM (${baseSql}) t ORDER BY ${order}, 1 LIMIT ${q.pageSize} OFFSET ${offset}`,
    params,
  );
  const total = rows[0]?.totalCount ?? 0;
  const data = rows.map(({ totalCount: _t, ...r }) => r as unknown as T);
  return { data, meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) } };
}
