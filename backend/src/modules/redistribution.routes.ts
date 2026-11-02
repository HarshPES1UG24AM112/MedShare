import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, facilityScope } from '../auth/auth.js';
import { query, queryOne, withRetry, withTransaction } from '../db/pool.js';
import { ApiError, notFound } from '../http/errors.js';
import { handler, id, idempotencyKey, idParam, listQuery, paginate } from '../http/helpers.js';

export const router = Router();
router.use('/redistribution', authenticate);

const recommendationSelect = `
  SELECT r.id, r.generated_at, r.reason_code, r.status, r.recommended_quantity, r.projected_shortage_reduction,
         r.priority_score, r.explanation, r.source_inventory_id,
         json_build_object('id', s.id, 'code', s.code, 'name', s.name) AS source_facility,
         json_build_object('id', d.id, 'code', d.code, 'name', d.name) AS destination_facility,
         json_build_object('id', m.id, 'code', m.code, 'name', m.name, 'strengthLabel', fn_strength_label(m.id)) AS medicine,
         json_build_object('id', b.id, 'batchNumber', b.batch_number, 'expiryDate', b.expiry_date, 'quantityAvailable', i.qty_available) AS batch,
         b.expiry_date, (b.expiry_date - fn_today()) AS days_to_expiry, fn_distance_km(s.id, d.id) AS distance_km,
         (s.organization_id <> d.organization_id) AS cross_organization,
         -- the engine's snapshot may have aged: flag it rather than hide it
         (r.recommended_quantity > i.qty_available OR b.status <> 'ACTIVE') AS stale
  FROM redistribution_recommendations r
  JOIN inventory i ON i.id = r.source_inventory_id
  JOIN medicine_batches b ON b.id = i.batch_id
  JOIN medicines m ON m.id = b.medicine_id
  JOIN facilities s ON s.id = i.facility_id
  JOIN facilities d ON d.id = r.destination_facility_id`;

router.get(
  '/redistribution/recommendations',
  handler(async (req, res) => {
    const q = listQuery
      .extend({ facilityId: id.optional(), reasonCode: z.enum(['SHORTAGE_COVER', 'NEAR_EXPIRY_SURPLUS']).optional(), status: z.enum(['OPEN', 'ACCEPTED', 'DISMISSED', 'SUPERSEDED']).default('OPEN') })
      .parse(req.query);
    const scope = facilityScope(req, q.facilityId);
    const base = `
      SELECT x.* FROM (${recommendationSelect}) x
      WHERE x.status = $1::recommendation_status
        AND ($2::int[] IS NULL OR (x.source_facility->>'id')::int = ANY($2::int[]) OR (x.destination_facility->>'id')::int = ANY($2::int[]))
        AND ($3::recommendation_reason IS NULL OR x.reason_code = $3)
        AND ($4::text IS NULL OR x.medicine->>'name' ILIKE '%' || $4 || '%' OR x.source_facility->>'name' ILIKE '%' || $4 || '%'
             OR x.destination_facility->>'name' ILIKE '%' || $4 || '%')`;
    res.json(
      await paginate(base, [q.status, scope, q.reasonCode ?? null, q.search ?? null], q,
        { priorityScore: 'priority_score', distanceKm: 'distance_km', expiryDate: 'expiry_date', quantity: 'recommended_quantity', reduction: 'projected_shortage_reduction' },
        'priorityScore', 'desc'),
    );
  }),
);

// Runs the engine under REPEATABLE READ so it sees one consistent snapshot.
// Permission (organisation- or platform-level recommendation:manage) is enforced in the function.
router.post(
  '/redistribution/run',
  handler(async (req, res) => {
    const generated = await withRetry(() =>
      withTransaction(async (c) => (await c.query('SELECT fn_generate_recommendations($1) AS n', [currentUser(req).id])).rows[0].n as number, {
        isolation: 'REPEATABLE READ',
      }),
    );
    res.json({ generated, generatedAt: new Date().toISOString() });
  }),
);

// Accepting creates a PENDING transfer (never executes it). The transfer then follows normal approval.
router.post(
  '/redistribution/recommendations/:id/accept',
  handler(async (req, res) => {
    const recId = idParam(req);
    const b = z.object({ quantity: z.number().int().positive().optional(), notes: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    const rec = await queryOne<{ sourceFacilityId: number; destinationFacilityId: number; batchId: number; recommendedQuantity: number; status: string; explanation: string }>(
      `SELECT i.facility_id AS source_facility_id, r.destination_facility_id, i.batch_id, r.recommended_quantity, r.status, r.explanation
       FROM redistribution_recommendations r JOIN inventory i ON i.id = r.source_inventory_id WHERE r.id = $1`,
      [recId],
    );
    if (!rec) throw notFound('Recommendation');
    if (rec.status !== 'OPEN') throw new ApiError(409, 'RECOMMENDATION_NOT_OPEN', `Recommendation is ${rec.status.toLowerCase()}`);
    const items = [{ batch_id: rec.batchId, quantity: b.quantity ?? rec.recommendedQuantity }];
    const [row] = await query<{ id: number }>('SELECT fn_create_transfer_request($1, $2, $3, $4::jsonb, $5, $6, $7) AS id', [
      currentUser(req).id, rec.sourceFacilityId, rec.destinationFacilityId, JSON.stringify(items),
      b.notes ?? `Redistribution recommendation: ${rec.explanation}`.slice(0, 500), recId, idempotencyKey(req),
    ]);
    res.status(201).json({ transferId: row.id, recommendationId: recId });
  }),
);

router.post(
  '/redistribution/recommendations/:id/dismiss',
  handler(async (req, res) => {
    const recId = idParam(req);
    const b = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body ?? {});
    await query('SELECT fn_dismiss_recommendation($1, $2, $3)', [currentUser(req).id, recId, b.reason]);
    res.json(await queryOne(`${recommendationSelect} WHERE r.id = $1`, [recId]));
  }),
);
