import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

/** Error with an HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, string[]>,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'You do not have permission to perform this action') => new ApiError(403, 'FORBIDDEN', message);

/** Database errors raised by MedShare routines: SQLSTATE class → HTTP, HINT → code. */
const MS_STATUS: Record<string, number> = { MS403: 403, MS404: 404, MS409: 409, MS422: 422 };

/** Named constraints that have a better business code than the generic one. */
const CONSTRAINT_CODES: Record<string, [number, string, string]> = {
  ck_inventory_available_nonneg: [422, 'INSUFFICIENT_STOCK', 'Not enough available stock'],
  ck_inventory_reserved_nonneg: [409, 'RESERVATION_MISSING', 'Reservation is inconsistent'],
  ck_inventory_damaged_nonneg: [422, 'INSUFFICIENT_STOCK', 'Not enough damaged stock'],
  ck_settings_min_le_reorder: [422, 'VALIDATION', 'Minimum stock level must not exceed the reorder threshold'],
  ck_settings_safety_le_reorder: [422, 'VALIDATION', 'Safety stock must not exceed the reorder threshold'],
  uq_batch_lot: [409, 'DUPLICATE_BATCH', 'This batch already exists'],
  ex_agreement_no_overlap: [409, 'OVERLAPPING_AGREEMENT', 'An agreement for these organisations already covers this period'],
  ck_agreement_canonical_pair: [422, 'VALIDATION', 'Invalid organisation pair'],
  users_email_key: [409, 'EMAIL_TAKEN', 'An account with this email already exists'],
  facilities_code_key: [409, 'DUPLICATE_CODE', 'Facility code already in use'],
  medicines_code_key: [409, 'DUPLICATE_CODE', 'Medicine code already in use'],
  organizations_name_key: [409, 'DUPLICATE_NAME', 'Organisation name already in use'],
  organizations_registration_number_key: [409, 'DUPLICATE_CODE', 'Registration number already in use'],
};

type PgLike = { code?: string; hint?: string; message: string; constraint?: string; detail?: string };

export function fromDatabaseError(e: PgLike): ApiError | null {
  if (!e.code) return null;
  if (MS_STATUS[e.code]) return new ApiError(MS_STATUS[e.code], e.hint || 'ERROR', e.message);
  if (e.constraint && CONSTRAINT_CODES[e.constraint]) {
    const [status, code, msg] = CONSTRAINT_CODES[e.constraint];
    return new ApiError(status, code, msg);
  }
  switch (e.code) {
    case '23505': return new ApiError(409, 'CONFLICT', 'A record with these values already exists');
    case '23503': return new ApiError(422, 'INVALID_REFERENCE', 'A referenced record does not exist');
    case '23514': return new ApiError(422, 'VALIDATION', `Value violates a rule (${e.constraint ?? 'check'})`);
    case '23P01': return new ApiError(409, 'CONFLICT', 'Overlaps an existing record');
    case '22P02': return new ApiError(400, 'BAD_REQUEST', 'Malformed value');
    case '40P01':
    case '40001': return new ApiError(503, 'CONCURRENCY_RETRY_EXHAUSTED', 'The system is busy; please retry');
    case '42501': return new ApiError(403, 'FORBIDDEN', 'Operation not permitted');
    default: return null;
  }
}

function fromPrismaError(e: unknown): ApiError | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const target = (e.meta?.target as string[] | string | undefined) ?? '';
    if (e.code === 'P2002') {
      const t = Array.isArray(target) ? target.join(',') : target;
      if (t.includes('email')) return new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
      return new ApiError(409, 'CONFLICT', `Duplicate value for ${t || 'a unique field'}`);
    }
    if (e.code === 'P2003') return new ApiError(422, 'INVALID_REFERENCE', 'A referenced record does not exist');
    if (e.code === 'P2025') return new ApiError(404, 'NOT_FOUND', 'Record not found');
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError || e instanceof Prisma.PrismaClientUnknownRequestError) {
    // Constraint / trigger errors surface as text; recover the constraint or SQLSTATE.
    const m = /constraint "([^"]+)"/.exec(e.message);
    if (m && CONSTRAINT_CODES[m[1]]) {
      const [status, code, msg] = CONSTRAINT_CODES[m[1]];
      return new ApiError(status, code, msg);
    }
    if (m) return new ApiError(422, 'VALIDATION', `Value violates a rule (${m[1]})`);
  }
  return null;
}

export const notFoundHandler: RequestHandler = (req, _res, next) =>
  next(new ApiError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let api: ApiError | null = null;
  if (err instanceof ApiError) api = err;
  else if (err instanceof ZodError) {
    const details: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      (details[key] ??= []).push(issue.message);
    }
    api = new ApiError(422, 'VALIDATION', 'Request validation failed', details);
  } else if (err?.type === 'entity.parse.failed') api = new ApiError(400, 'BAD_REQUEST', 'Malformed JSON body');
  else api = fromDatabaseError(err) ?? fromPrismaError(err);

  if (!api) {
    console.error(`[${req.requestId}] unhandled error`, err);
    api = new ApiError(500, 'INTERNAL', 'Unexpected server error');
  }
  res.status(api.status).json({ error: { code: api.code, message: api.message, details: api.details, requestId: req.requestId } });
};
