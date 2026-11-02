/**
 * Derived views over the mock database. These approximate the business logic
 * Agent 1 owns on the backend; they exist only so the UI can be built and demoed.
 */
import type {
  Batch,
  ExpiringBatch,
  ExpiryWindow,
  Facility,
  Recommendation,
  Shortage,
} from '../types';
import { parseDate } from '@/lib/format';
import { batches, consumption, DAY, FACILITY_SCALE, facilities, medicines, TODAY, transfers } from './seed';

export const daysUntil = (dateStr: string) => Math.round((parseDate(dateStr).setHours(0, 0, 0, 0) - TODAY) / DAY);
export const isExpired = (b: Batch) => daysUntil(b.expiryDate) < 0;

export function usableStock(facilityId: string, medicineId: string) {
  return batches
    .filter((b) => b.facility.id === facilityId && b.medicine.id === medicineId && !isExpired(b))
    .reduce((s, b) => s + b.quantityAvailable, 0);
}

/** One pass over all batches: usable stock per `${facilityId}:${medicineId}` (key present = ever stocked). */
function stockIndex() {
  const idx = new Map<string, number>();
  for (const b of batches) {
    const k = `${b.facility.id}:${b.medicine.id}`;
    idx.set(k, (idx.get(k) ?? 0) + (isExpired(b) ? 0 : b.quantityAvailable));
  }
  return idx;
}

export function thresholdsFor(facility: Facility, medicineId: string) {
  const m = medicines.find((x) => x.id === medicineId)!;
  const scale = FACILITY_SCALE[facility.type];
  return { reorder: Math.round(m.reorderThreshold * scale), critical: Math.round(m.criticalThreshold * scale) };
}

export function computeShortages(idx = stockIndex()): Shortage[] {
  const out: Shortage[] = [];
  for (const f of facilities) {
    if (f.type === 'WAREHOUSE') continue;
    for (const m of medicines) {
      // Medicines a facility has never stocked are outside its formulary, not shortages.
      const stock = idx.get(`${f.id}:${m.id}`);
      if (stock === undefined) continue;
      const { reorder, critical } = thresholdsFor(f, m.id);
      if (stock >= reorder) continue;
      const daily = consumption.get(`${f.id}:${m.id}`) ?? 0;
      out.push({
        id: `${f.id}:${m.id}`,
        medicine: { id: m.id, name: m.name, strength: m.strength, unit: m.unit, category: m.category },
        facility: { id: f.id, name: f.name, code: f.code },
        currentStock: stock,
        reorderThreshold: reorder,
        criticalThreshold: critical,
        avgDailyConsumption: Math.round(daily * 10) / 10,
        daysRemaining: daily > 0 ? Math.floor(stock / daily) : null,
        severity: stock < critical ? 'CRITICAL' : 'LOW',
      });
    }
  }
  return out;
}

export function expiringBatches(window: ExpiryWindow): ExpiringBatch[] {
  return batches
    .map((b) => ({ ...b, daysToExpiry: daysUntil(b.expiryDate) }))
    .filter((b) => b.quantityAvailable + b.quantityReserved > 0)
    .filter((b) => {
      if (window === 'expired') return b.daysToExpiry < 0;
      return b.daysToExpiry >= 0 && b.daysToExpiry <= Number(window);
    });
}

function haversineKm(a: Facility, b: Facility) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  // ×1.3 approximates road distance from great-circle distance.
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 1.3 * 10) / 10;
}

/** Recommendations that already have an open transfer are hidden. */
function openTransferRecIds() {
  return new Set(
    transfers
      .filter((t) => t.recommendationId && ['PENDING', 'APPROVED', 'DISPATCHED'].includes(t.status))
      .map((t) => t.recommendationId!),
  );
}

export function computeRecommendations(): Recommendation[] {
  const recs: Recommendation[] = [];
  const taken = openTransferRecIds();
  const facById = new Map(facilities.map((f) => [f.id, f]));
  const idx = stockIndex();

  // 1. Cover shortages from facilities holding surplus, preferring earlier-expiring batches.
  for (const s of computeShortages(idx)) {
    const dest = facById.get(s.facility.id)!;
    let deficit = s.reorderThreshold - s.currentStock;
    const sources = batches
      .filter((b) => b.medicine.id === s.medicine.id && b.facility.id !== dest.id && b.quantityAvailable > 0)
      .map((b) => ({ b, days: daysUntil(b.expiryDate), src: facById.get(b.facility.id)! }))
      .filter((x) => x.days >= 14)
      .map((x) => {
        const { reorder } = thresholdsFor(x.src, s.medicine.id);
        const surplus = (idx.get(`${x.src.id}:${s.medicine.id}`) ?? 0) - (x.src.type === 'WAREHOUSE' ? 0 : reorder);
        return { ...x, surplus, km: haversineKm(x.src, dest) };
      })
      .filter((x) => x.surplus > 0)
      .sort((a, b) => a.days - b.days || a.km - b.km);

    for (const x of sources.slice(0, 2)) {
      if (deficit <= 0) break;
      const qty = Math.min(deficit, x.surplus, x.b.quantityAvailable);
      if (qty <= 0) continue;
      deficit -= qty;
      const id = `rec-${x.b.id}-${dest.id}`;
      if (taken.has(id)) continue;
      const severityPts = s.severity === 'CRITICAL' ? 55 : 30;
      const expiryPts = x.days <= 60 ? 20 : x.days <= 120 ? 10 : 0;
      const distPts = Math.max(0, 25 - x.km / 4);
      const daysTxt = s.daysRemaining === null ? 'no recent consumption' : `${s.daysRemaining} day${s.daysRemaining === 1 ? '' : 's'} of stock left`;
      recs.push({
        id,
        sourceFacility: x.b.facility,
        destinationFacility: s.facility,
        medicine: x.b.medicine,
        batch: { id: x.b.id, batchNumber: x.b.batchNumber, quantityAvailable: x.b.quantityAvailable },
        suggestedQuantity: qty,
        expiryDate: x.b.expiryDate,
        distanceKm: x.km,
        reasonCode: 'SHORTAGE_COVER',
        reason: `${s.facility.name} is ${s.severity === 'CRITICAL' ? 'below critical level' : 'below reorder level'} (${daysTxt}); ${x.src.name} holds ${x.surplus.toLocaleString()} surplus units.`,
        priorityScore: Math.min(100, Math.round(severityPts + expiryPts + distPts)),
      });
    }
  }

  // 2. Move near-expiry stock that will not be consumed in time to the highest-consuming nearby site.
  for (const b of batches) {
    const days = daysUntil(b.expiryDate);
    if (days < 14 || days > 75 || b.quantityAvailable < 20) continue;
    const src = facById.get(b.facility.id)!;
    const daily = consumption.get(`${src.id}:${b.medicine.id}`) ?? 0;
    const willUse = Math.floor(daily * days);
    const excess = b.quantityAvailable - willUse;
    if (excess < 20) continue;
    const dest = facilities
      .filter((f) => f.id !== src.id && f.type !== 'WAREHOUSE')
      .map((f) => ({ f, rate: consumption.get(`${f.id}:${b.medicine.id}`) ?? 0, km: haversineKm(src, f) }))
      .filter((x) => x.rate * days > excess * 0.5 && x.km < 90)
      .sort((a, b2) => b2.rate / (1 + b2.km / 30) - a.rate / (1 + a.km / 30))[0];
    if (!dest) continue;
    const id = `rec-${b.id}-${dest.f.id}`;
    if (taken.has(id) || recs.some((r) => r.id === id)) continue;
    const qty = Math.min(excess, Math.floor(dest.rate * days * 0.8));
    if (qty < 10) continue;
    recs.push({
      id,
      sourceFacility: b.facility,
      destinationFacility: { id: dest.f.id, name: dest.f.name, code: dest.f.code },
      medicine: b.medicine,
      batch: { id: b.id, batchNumber: b.batchNumber, quantityAvailable: b.quantityAvailable },
      suggestedQuantity: qty,
      expiryDate: b.expiryDate,
      distanceKm: dest.km,
      reasonCode: 'NEAR_EXPIRY_SURPLUS',
      reason: `Batch expires in ${days} days; ${src.name} is projected to use only ${willUse.toLocaleString()} of ${b.quantityAvailable.toLocaleString()} units before expiry. ${dest.f.name} consumes ~${Math.round(dest.rate)}/day.`,
      priorityScore: Math.min(100, Math.round(40 + (75 - days) / 2 + Math.max(0, 15 - dest.km / 6))),
    });
  }

  return recs.sort((a, b) => b.priorityScore - a.priorityScore);
}
