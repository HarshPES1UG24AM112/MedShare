import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, facilityScope } from '../auth/auth.js';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { handler, id } from '../http/helpers.js';

export const router = Router();
router.use(['/dashboard', '/analytics'], authenticate);

/** $1 = facility scope (int[] or NULL = network). */
const inScope = (col: string) => `($1::int[] IS NULL OR ${col} = ANY($1::int[]))`;
const transferInScope = `($1::int[] IS NULL OR t.source_facility_id = ANY($1::int[]) OR t.destination_facility_id = ANY($1::int[]))`;

router.get(
  '/dashboard/summary',
  handler(async (req, res) => {
    const q = z.object({ facilityId: id.optional() }).parse(req.query);
    const scope = facilityScope(req, q.facilityId);
    const row = await queryOne(
      `SELECT
         (SELECT count(*) FROM facilities WHERE is_active AND ${inScope('id')})                                              AS total_facilities,
         (SELECT count(*) FROM medicines WHERE is_active)                                                                    AS registered_medicines,
         (SELECT count(DISTINCT medicine_id) FROM v_inventory_detail WHERE is_usable AND qty_available > 0 AND ${inScope('facility_id')}) AS medicines_in_stock,
         (SELECT coalesce(sum(qty_available), 0) FROM v_inventory_detail WHERE is_usable AND ${inScope('facility_id')})     AS total_inventory_units,
         (SELECT count(*) FROM v_shortage_status WHERE stock_status = 'CRITICAL' AND ${inScope('facility_id')})              AS critical_shortages,
         (SELECT count(*) FROM v_shortage_status WHERE stock_status = 'LOW' AND ${inScope('facility_id')})                   AS low_stock,
         (SELECT count(*) FROM v_inventory_detail WHERE days_to_expiry BETWEEN 0 AND 30 AND qty_available + qty_reserved > 0 AND ${inScope('facility_id')}) AS expiring_batches_30d,
         (SELECT count(*) FROM v_inventory_detail WHERE days_to_expiry < 0 AND qty_available > 0 AND ${inScope('facility_id')}) AS expired_batches_on_hand,
         (SELECT count(*) FROM transfer_requests t WHERE t.status = 'PENDING' AND ${transferInScope})                       AS pending_transfers,
         (SELECT count(*) FROM transfer_requests t WHERE t.status = 'APPROVED' AND ${transferInScope})                      AS awaiting_dispatch,
         (SELECT count(*) FROM transfer_requests t WHERE t.status = 'DISPATCHED' AND ${transferInScope})                    AS in_transit,
         (SELECT count(*) FROM redistribution_recommendations r JOIN inventory i ON i.id = r.source_inventory_id
            WHERE r.status = 'OPEN' AND ($1::int[] IS NULL OR i.facility_id = ANY($1::int[]) OR r.destination_facility_id = ANY($1::int[]))) AS open_recommendations,
         (SELECT count(*) FROM stock_requests WHERE status = 'OPEN' AND ${inScope('requesting_facility_id')})               AS open_stock_requests,
         (SELECT count(*) FROM notifications WHERE recipient_user_id = $2 AND read_at IS NULL)                              AS unread_notifications`,
      [scope, currentUser(req).id],
    );
    res.json({ ...row, scope: scope === null ? 'NETWORK' : scope });
  }),
);

/**
 * Analytics overview. Every query is SQL (CTEs, window functions, recursive
 * region rollups, GROUP BY/HAVING, the monthly-consumption materialized view)
 * and runs in one REPEATABLE READ READ ONLY snapshot so the figures agree.
 */
router.get(
  '/analytics/overview',
  handler(async (req, res) => {
    const q = z.object({ facilityId: id.optional(), months: z.coerce.number().int().min(3).max(24).default(6), medicineId: id.optional() }).parse(req.query);
    const scope = facilityScope(req, q.facilityId);
    const p = [scope, q.months];

    const result = await withTransaction(
      async (c) => {
        const run = (sql: string, params: unknown[] = p) => query(sql, params, c);
        // One connection runs one query at a time; keep them sequential inside the snapshot.
        const sequential = async (thunks: (() => Promise<unknown[]>)[]) => {
          const out: unknown[][] = [];
          for (const t of thunks) out.push(await t());
          return out;
        };
        const [
          inventoryDistribution, expiryTrend, shortageRisk, recurringShortages, transferStats, transferStatus, transferTiming,
          movementTrend, stockByCategory, availabilityByRegion, expiryRisk, wastage, redistribution, consumption, topConsumed, demandBasis,
        ] = await sequential([
          // Network comparison (aggregate totals are tier-2 visibility).
          () => run(`SELECT facility_id, code AS facility_code, name AS facility_name, organization_name, usable_units AS available, reserved_units AS reserved, damaged_units AS damaged
               FROM v_facility_inventory_summary ORDER BY code`, []),
          () => run(`SELECT to_char(m, 'YYYY-MM') AS month,
                      coalesce(sum(v.qty_available + v.qty_reserved), 0) AS units, count(v.inventory_id) AS batches,
                      coalesce(round(sum((v.qty_available + v.qty_reserved) * v.unit_cost), 2), 0) AS value
               FROM generate_series(date_trunc('month', fn_today()) - interval '2 months', date_trunc('month', fn_today()) + interval '9 months', interval '1 month') m
               LEFT JOIN v_inventory_detail v ON date_trunc('month', v.expiry_date) = m AND v.qty_available + v.qty_reserved > 0 AND ${inScope('v.facility_id')}
               GROUP BY m ORDER BY m`, [scope]),
          () => run(`SELECT medicine_id, medicine_name, count(*) AS facilities_affected,
                      count(*) FILTER (WHERE stock_status = 'CRITICAL') AS critical_count, min(days_of_inventory) AS min_days_remaining,
                      sum(reorder_threshold - usable) AS total_deficit
               FROM v_shortage_status WHERE stock_status <> 'OK' AND ${inScope('facility_id')}
               GROUP BY medicine_id, medicine_name ORDER BY critical_count DESC, facilities_affected DESC, total_deficit DESC LIMIT 10`, [scope]),
          () => run(`SELECT f.id AS facility_id, f.code AS facility_code, f.name AS facility_name, count(*) AS alerts,
                      count(DISTINCT a.medicine_id) AS medicines, count(*) FILTER (WHERE a.severity = 'CRITICAL') AS critical,
                      rank() OVER (ORDER BY count(*) DESC) AS rank
               FROM shortage_alerts a JOIN facilities f ON f.id = a.facility_id
               WHERE a.detected_at >= fn_today() - make_interval(months => $2) AND ${inScope('a.facility_id')}
               GROUP BY f.id HAVING count(*) >= 2 ORDER BY alerts DESC LIMIT 10`),
          () => run(`SELECT to_char(m, 'YYYY-MM') AS month,
                      (SELECT count(*) FROM transfer_requests t WHERE date_trunc('month', t.created_at) = m AND ${transferInScope}) AS requested,
                      (SELECT count(*) FROM transfer_status_history h JOIN transfer_requests t ON t.id = h.transfer_id
                       WHERE h.to_status = 'RECEIVED' AND date_trunc('month', h.changed_at) = m AND ${transferInScope}) AS received,
                      (SELECT count(*) FROM transfer_status_history h JOIN transfer_requests t ON t.id = h.transfer_id
                       WHERE h.to_status IN ('REJECTED', 'CANCELLED') AND date_trunc('month', h.changed_at) = m AND ${transferInScope}) AS rejected_or_cancelled
               FROM generate_series(date_trunc('month', fn_today()) - make_interval(months => $2 - 1), date_trunc('month', fn_today()), interval '1 month') m
               ORDER BY m`),
          () => run(`SELECT status, count(*) AS count FROM transfer_requests t WHERE ${transferInScope} GROUP BY status ORDER BY status`, [scope]),
          () => run(`SELECT count(*) FILTER (WHERE t.status = 'RECEIVED') AS received,
                      count(*) FILTER (WHERE t.status IN ('RECEIVED', 'REJECTED', 'CANCELLED')) AS closed,
                      round(avg(extract(epoch FROM (h.changed_at - t.created_at)) / 3600) FILTER (WHERE t.status = 'RECEIVED')::numeric, 1) AS avg_lead_time_hours
               FROM transfer_requests t
               LEFT JOIN transfer_status_history h ON h.transfer_id = t.id AND h.to_status = 'RECEIVED'
               WHERE ${transferInScope}`, [scope]),
          () => run(`SELECT to_char(m, 'YYYY-MM') AS month,
                      coalesce(sum(mv.quantity) FILTER (WHERE mv.movement_type IN ('RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN')), 0) AS inbound,
                      coalesce(sum(mv.quantity) FILTER (WHERE mv.movement_type IN ('DISPENSE', 'TRANSFER_OUT')), 0) AS outbound,
                      coalesce(sum(mv.quantity) FILTER (WHERE mv.movement_type IN ('DAMAGE', 'TRANSIT_DAMAGE', 'EXPIRY_WRITE_OFF', 'ADJUSTMENT_OUT')), 0) AS losses
               FROM generate_series(date_trunc('month', fn_today()) - make_interval(months => $2 - 1), date_trunc('month', fn_today()), interval '1 month') m
               LEFT JOIN inventory_movements mv ON date_trunc('month', mv.created_at) = m
                    AND (${'$1'}::int[] IS NULL OR mv.inventory_id IN (SELECT id FROM inventory WHERE facility_id = ANY($1::int[])))
               GROUP BY m ORDER BY m`),
          () => run(`SELECT root.name AS category, coalesce(sum(v.qty_available), 0) AS units, count(DISTINCT v.medicine_id) AS medicines
               FROM v_inventory_detail v
               JOIN medicines md ON md.id = v.medicine_id
               JOIN v_category_tree ct ON ct.id = md.category_id
               JOIN medicine_categories root ON root.id = ct.root_id
               WHERE v.is_usable AND ${inScope('v.facility_id')}
               GROUP BY root.name ORDER BY units DESC`, [scope]),
          // Recursive rollup of every facility to all its ancestor regions (taluk → district → state).
          () => run(`WITH RECURSIVE ancestors AS (
                   SELECT f.id AS facility_id, r.id AS region_id, r.parent_id FROM facilities f JOIN regions r ON r.id = f.region_id WHERE f.is_active
                   UNION ALL
                   SELECT a.facility_id, r.id, r.parent_id FROM ancestors a JOIN regions r ON r.id = a.parent_id
               ), facility_units AS (
                   SELECT facility_id, sum(usable) AS usable FROM v_facility_stock WHERE ($1::int IS NULL OR medicine_id = $1) GROUP BY facility_id
               ), facility_short AS (
                   SELECT facility_id, count(*) FILTER (WHERE stock_status = 'CRITICAL') AS critical
                   FROM v_shortage_status WHERE ($1::int IS NULL OR medicine_id = $1) GROUP BY facility_id
               )
               SELECT rt.id AS region_id, rt.name AS region, rt.level, rt.depth, rt.path,
                      count(DISTINCT a.facility_id) AS facilities, coalesce(sum(fu.usable), 0) AS usable_units,
                      coalesce(sum(fs.critical), 0) AS critical_shortages
               FROM ancestors a
               JOIN v_region_tree rt ON rt.id = a.region_id
               LEFT JOIN facility_units fu ON fu.facility_id = a.facility_id
               LEFT JOIN facility_short fs ON fs.facility_id = a.facility_id
               WHERE rt.depth <= 2
               GROUP BY rt.id, rt.name, rt.level, rt.depth, rt.path
               ORDER BY rt.depth, usable_units DESC`, [q.medicineId ?? null]),
          () => run(`SELECT medicine_id, medicine_name, sum(qty_available + qty_reserved) AS units,
                      round(sum((qty_available + qty_reserved) * unit_cost), 2) AS value, min(days_to_expiry) AS soonest_days, count(*) AS batches
               FROM v_inventory_detail
               WHERE days_to_expiry BETWEEN 0 AND 60 AND qty_available + qty_reserved > 0 AND ${inScope('facility_id')}
               GROUP BY medicine_id, medicine_name ORDER BY value DESC LIMIT 10`, [scope]),
          () => run(`SELECT mv.movement_type, sum(mv.quantity) AS units, round(sum(mv.quantity * b.unit_cost), 2) AS value
               FROM inventory_movements mv JOIN inventory i ON i.id = mv.inventory_id JOIN medicine_batches b ON b.id = i.batch_id
               WHERE mv.movement_type IN ('EXPIRY_WRITE_OFF', 'DISPOSAL', 'DAMAGE', 'TRANSIT_DAMAGE')
                 AND mv.created_at >= fn_today() - make_interval(months => $2) AND ${inScope('i.facility_id')}
               GROUP BY mv.movement_type ORDER BY value DESC`),
          () => run(`SELECT count(*) AS open_recommendations, coalesce(sum(r.recommended_quantity), 0) AS units,
                      coalesce(sum(r.projected_shortage_reduction), 0) AS shortage_units_covered,
                      count(DISTINCT (r.destination_facility_id, b.medicine_id)) FILTER (WHERE r.reason_code = 'SHORTAGE_COVER') AS shortages_addressed,
                      coalesce(round(sum(r.recommended_quantity * b.unit_cost) FILTER (WHERE r.reason_code = 'NEAR_EXPIRY_SURPLUS'), 2), 0) AS near_expiry_value_rescuable
               FROM redistribution_recommendations r JOIN inventory i ON i.id = r.source_inventory_id JOIN medicine_batches b ON b.id = i.batch_id
               WHERE r.status = 'OPEN' AND ($1::int[] IS NULL OR i.facility_id = ANY($1::int[]) OR r.destination_facility_id = ANY($1::int[]))`, [scope]),
          () => run(`SELECT to_char(month, 'YYYY-MM') AS month, sum(units_dispensed) AS units, sum(dispense_events) AS events
               FROM mv_monthly_consumption
               WHERE month >= date_trunc('month', fn_today()) - make_interval(months => $2 - 1) AND ${inScope('facility_id')}
               GROUP BY month ORDER BY month`),
          // Month-over-month change per medicine with LAG() over the materialized view.
          () => run(`WITH monthly AS (
                   SELECT medicine_id, month, sum(units_dispensed) AS units FROM mv_monthly_consumption
                   WHERE ${inScope('facility_id')} AND month >= date_trunc('month', fn_today()) - interval '2 months'
                   GROUP BY medicine_id, month
               ), ranked AS (
                   SELECT medicine_id, month, units, units - LAG(units) OVER (PARTITION BY medicine_id ORDER BY month) AS change_vs_previous,
                          ROW_NUMBER() OVER (PARTITION BY medicine_id ORDER BY month DESC) AS rn
                   FROM monthly WHERE month < date_trunc('month', fn_today())   -- last complete month only
               )
               SELECT r.medicine_id, m.name AS medicine_name, to_char(r.month, 'YYYY-MM') AS month, r.units, r.change_vs_previous
               FROM ranked r JOIN medicines m ON m.id = r.medicine_id WHERE r.rn = 1 ORDER BY r.units DESC LIMIT 10`, [scope]),
          () => run(`SELECT demand_basis, count(*) AS policies FROM v_demand d WHERE ${inScope('d.facility_id')} GROUP BY demand_basis`, [scope]),
        ]);
        return {
          inventoryDistribution, expiryTrend, shortageRisk, recurringShortages, transferStats, transferStatusBreakdown: transferStatus,
          transferTiming: transferTiming[0], movementTrend, stockByCategory, availabilityByRegion, expiryRisk, wastage, redistribution: redistribution[0],
          monthlyConsumption: consumption, topConsumedLastMonth: topConsumed, demandBasis,
        };
      },
      { isolation: 'REPEATABLE READ', readOnly: true },
    );

    const timing = result.transferTiming as { received: number; closed: number };
    const synthetic = await queryOne<{ synthetic: boolean }>('SELECT bool_or(is_synthetic) AS synthetic FROM facilities');
    res.json({
      ...result,
      transferCompletionRate: timing.closed ? Number((timing.received / timing.closed).toFixed(3)) : null,
      meta: {
        months: q.months,
        scope: scope === null ? 'NETWORK' : scope,
        generatedAt: new Date().toISOString(),
        synthetic: !!synthetic?.synthetic,
        note: synthetic?.synthetic
          ? 'Figures are computed from synthetic demonstration data and do not describe real facilities or outcomes.'
          : undefined,
        consistency: 'All figures come from one REPEATABLE READ snapshot.',
      },
    });
  }),
);
