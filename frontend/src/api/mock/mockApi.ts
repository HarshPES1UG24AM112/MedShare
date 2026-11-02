/**
 * MOCK SERVICE IMPLEMENTATION — for UI development only.
 * Satisfies the same MedShareApi interface as services/http.ts, backed by the
 * synthetic in-memory database in ./seed.ts. Mutations persist until page reload.
 */
import { ApiError } from '../client';
import { tokenStore } from '@/auth/tokenStore';
import { config } from '@/lib/config';
import type { MedShareApi } from '../services/types';
import type {
  AnalyticsOverview,
  AuditEntity,
  AuditLog,
  Batch,
  InventoryMovement,
  ListParams,
  Medicine,
  MovementType,
  Paginated,
  Transfer,
  TransferAction,
  TransferStatus,
  User,
} from '../types';
import {
  ACTION_BY_STATUS,
  auditLogs,
  batches,
  DAY,
  facilities,
  medicines,
  movements,
  nextAuditId,
  nextBatchSeq,
  nextMovementId,
  nextTransferCode,
  TODAY,
  transfers,
  users,
  type MockUser,
} from './seed';
import { computeRecommendations, computeShortages, daysUntil, expiringBatches, isExpired } from './derive';

/* ----------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

const delay = <T>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), config.mockLatencyMs * (0.6 + Math.random() * 0.8)));

const fail = (message: string, status: number, code = 'ERROR', details?: Record<string, string[]>): never => {
  throw new ApiError(message, status, code, details);
};

function currentUser(): MockUser {
  const token = tokenStore.get();
  const id = token?.startsWith('mock.') ? token.slice(5) : null;
  const user = users.find((u) => u.id === id);
  if (!user) fail('Your session has expired. Please sign in again.', 401, 'UNAUTHORIZED');
  return user!;
}

const publicUser = ({ password: _pw, ...u }: MockUser): User => u;

function paginate<T>(items: T[], params: ListParams, sorters: Record<string, (x: T) => string | number> = {}): Paginated<T> {
  let list = items;
  const sorter = params.sortBy ? sorters[params.sortBy] : undefined;
  if (sorter) {
    const dir = params.sortDir === 'desc' ? -1 : 1;
    list = [...list].sort((a, b) => {
      const va = sorter(a);
      const vb = sorter(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
  }
  const pageSize = Math.min(Math.max(params.pageSize ?? 20, 1), 100);
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(params.page ?? 1, 1), totalPages);
  return { data: list.slice((page - 1) * pageSize, page * pageSize), meta: { page, pageSize, total, totalPages } };
}

const matches = (needle: string | undefined, ...hay: (string | null | undefined)[]) => {
  if (!needle) return true;
  const n = needle.trim().toLowerCase();
  return hay.some((h) => h?.toLowerCase().includes(n));
};

const byFacility = (facilityId: string | undefined, id: string) => !facilityId || facilityId === id;

function audit(user: MockUser, action: string, entityType: AuditEntity, entityId: string | null, description: string, facilityId?: string | null) {
  const f = facilities.find((x) => x.id === facilityId);
  const log: AuditLog = {
    id: nextAuditId(),
    user: { id: user.id, name: user.name, role: user.role },
    action,
    entityType,
    entityId,
    description,
    facility: f ? { id: f.id, name: f.name, code: f.code } : null,
    timestamp: new Date().toISOString(),
  };
  auditLogs.push(log);
}

function recordMovement(user: MockUser, batch: Batch, type: MovementType, quantity: number, note?: string | null, reference?: string | null) {
  const mv: InventoryMovement = {
    id: nextMovementId(),
    type,
    quantity,
    batch: { id: batch.id, batchNumber: batch.batchNumber },
    medicine: batch.medicine,
    facility: batch.facility,
    performedBy: { id: user.id, name: user.name },
    reference: reference ?? null,
    note: note ?? null,
    createdAt: new Date().toISOString(),
  };
  movements.push(mv);
}

const canWrite = (u: MockUser) => u.role !== 'VIEWER';
const isAdmin = (u: MockUser) => u.role === 'ADMIN';
const worksAt = (u: MockUser, facilityId: string) => isAdmin(u) || u.facilityId === facilityId;

const monthKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthKeys = (fromOffset: number, toOffset: number) => {
  const now = new Date(TODAY);
  const keys: string[] = [];
  for (let i = fromOffset; i <= toOffset; i++) keys.push(monthKey(new Date(now.getFullYear(), now.getMonth() + i, 1).getTime()));
  return keys;
};

/* ----------------------------------------------------------------------------
 * Implementation
 * ------------------------------------------------------------------------- */

export const mockApi: MedShareApi = {
  auth: {
    async login({ email, password }) {
      const user = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
      if (!user || user.password !== password) {
        await delay(null);
        return fail('Incorrect email or password.', 401, 'INVALID_CREDENTIALS');
      }
      audit(user, 'USER_LOGIN', 'AUTH', user.id, `Signed in as ${user.email}`, user.facilityId);
      return delay({ accessToken: `mock.${user.id}`, user: publicUser(user) });
    },
    async register(input) {
      if (users.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) {
        await delay(null);
        return fail('An account with this email already exists.', 409, 'EMAIL_TAKEN', { email: ['Email is already registered'] });
      }
      const f = facilities.find((x) => x.id === input.facilityId);
      if (!f) return fail('Unknown facility.', 422, 'VALIDATION', { facilityId: ['Select a valid facility'] });
      const user: MockUser = {
        id: `usr-${String(users.length + 1).padStart(3, '0')}`,
        name: input.name,
        email: input.email,
        role: input.role,
        facilityId: f.id,
        facilityName: f.name,
        password: input.password,
      };
      users.push(user);
      audit(user, 'USER_REGISTERED', 'USER', user.id, `Registered ${user.email} as ${user.role}`, f.id);
      return delay({ accessToken: `mock.${user.id}`, user: publicUser(user) });
    },
    async me() {
      return delay(publicUser(currentUser()));
    },
  },

  dashboard: {
    async summary({ facilityId }) {
      currentUser();
      const shortages = computeShortages().filter((s) => byFacility(facilityId, s.facility.id));
      const scoped = batches.filter((b) => byFacility(facilityId, b.facility.id));
      return delay({
        totalFacilities: facilityId ? 1 : facilities.length,
        totalMedicines: facilityId ? new Set(scoped.filter((b) => b.quantityAvailable > 0).map((b) => b.medicine.id)).size : medicines.length,
        totalInventoryUnits: scoped.filter((b) => !isExpired(b)).reduce((s, b) => s + b.quantityAvailable, 0),
        criticalShortages: shortages.filter((s) => s.severity === 'CRITICAL').length,
        lowStock: shortages.filter((s) => s.severity === 'LOW').length,
        expiringBatches30d: expiringBatches('30').filter((b) => byFacility(facilityId, b.facility.id)).length,
        expiredBatches: expiringBatches('expired').filter((b) => byFacility(facilityId, b.facility.id)).length,
        pendingTransfers: transfers.filter(
          (t) => t.status === 'PENDING' && (!facilityId || t.sourceFacility.id === facilityId || t.destinationFacility.id === facilityId),
        ).length,
      });
    },
  },

  facilities: {
    // Public: the registration form needs it before a token exists.
    async list() {
      return delay(facilities);
    },
    async get(id) {
      currentUser();
      const f = facilities.find((x) => x.id === id);
      if (!f) return fail('Facility not found.', 404, 'NOT_FOUND');
      return delay(f!);
    },
    async summary(id) {
      currentUser();
      const f = facilities.find((x) => x.id === id);
      if (!f) return fail('Facility not found.', 404, 'NOT_FOUND');
      const own = batches.filter((b) => b.facility.id === id);
      const shortages = computeShortages().filter((s) => s.facility.id === id);
      return delay({
        facility: f!,
        totalUnits: own.filter((b) => !isExpired(b)).reduce((s, b) => s + b.quantityAvailable, 0),
        batchCount: own.length,
        medicineCount: new Set(own.map((b) => b.medicine.id)).size,
        criticalShortages: shortages.filter((s) => s.severity === 'CRITICAL').length,
        lowStock: shortages.filter((s) => s.severity === 'LOW').length,
        expiringIn30Days: own.filter((b) => {
          const d = daysUntil(b.expiryDate);
          return d >= 0 && d <= 30;
        }).length,
        expired: own.filter(isExpired).length,
      });
    },
  },

  medicines: {
    async list(params) {
      currentUser();
      const list = medicines.filter(
        (m) =>
          matches(params.search, m.name, m.genericName, m.code, m.manufacturer) &&
          (!params.category || m.category === params.category) &&
          (!params.dosageForm || m.dosageForm === params.dosageForm) &&
          (!params.essentialOnly || m.isEssential),
      );
      return delay(
        paginate(list, { sortBy: 'name', ...params }, {
          name: (m) => m.name.toLowerCase(),
          category: (m) => m.category,
          code: (m) => m.code,
          reorderThreshold: (m) => m.reorderThreshold,
        }),
      );
    },
    async categories() {
      currentUser();
      return delay([...new Set(medicines.map((m) => m.category))].sort());
    },
    async get(id) {
      currentUser();
      const m = medicines.find((x) => x.id === id);
      if (!m) return fail('Medicine not found.', 404, 'NOT_FOUND');
      const stockByFacility = facilities
        .map((f) => {
          const own = batches.filter((b) => b.medicine.id === id && b.facility.id === f.id && !isExpired(b));
          const nearest = own.map((b) => b.expiryDate).sort()[0] ?? null;
          return {
            facility: { id: f.id, name: f.name, code: f.code },
            available: own.reduce((s, b) => s + b.quantityAvailable, 0),
            reserved: own.reduce((s, b) => s + b.quantityReserved, 0),
            damaged: own.reduce((s, b) => s + b.quantityDamaged, 0),
            batchCount: own.length,
            nearestExpiry: nearest,
          };
        })
        .filter((r) => r.batchCount > 0);
      return delay({ ...m!, totalAvailable: stockByFacility.reduce((s, r) => s + r.available, 0), stockByFacility });
    },
    async create(input) {
      const user = currentUser();
      if (!(user.role === 'ADMIN' || user.role === 'FACILITY_MANAGER')) return fail('Only administrators and facility managers can add medicines.', 403, 'FORBIDDEN');
      if (medicines.some((m) => m.code.toLowerCase() === input.code.toLowerCase())) {
        return fail('Medicine code already exists.', 409, 'DUPLICATE', { code: ['This code is already in use'] });
      }
      const med: Medicine = { ...input, id: `med-${String(medicines.length + 1).padStart(3, '0')}`, createdAt: new Date().toISOString() };
      medicines.push(med);
      audit(user, 'MEDICINE_CREATED', 'MEDICINE', med.id, `Added ${med.name} ${med.strength} (${med.code}) to catalogue`, user.facilityId);
      return delay(med);
    },
  },

  inventory: {
    async batches(params) {
      currentUser();
      const list = batches.filter((b) => {
        const d = daysUntil(b.expiryDate);
        const status = d < 0 ? 'EXPIRED' : d <= 60 ? 'EXPIRING' : 'OK';
        return (
          byFacility(params.facilityId, b.facility.id) &&
          (!params.medicineId || b.medicine.id === params.medicineId) &&
          (!params.status || params.status === status) &&
          matches(params.search, b.batchNumber, b.medicine.name, b.facility.name)
        );
      });
      return delay(
        paginate(list, { sortBy: 'expiryDate', ...params }, {
          medicine: (b) => b.medicine.name.toLowerCase(),
          facility: (b) => b.facility.name,
          expiryDate: (b) => b.expiryDate,
          quantityAvailable: (b) => b.quantityAvailable,
          quantityReserved: (b) => b.quantityReserved,
          quantityDamaged: (b) => b.quantityDamaged,
          receivedAt: (b) => b.receivedAt,
        }),
      );
    },
    async receive(input) {
      const user = currentUser();
      if (!canWrite(user) || !worksAt(user, input.facilityId)) return fail('You can only receive stock into your own facility.', 403, 'FORBIDDEN');
      const m = medicines.find((x) => x.id === input.medicineId);
      const f = facilities.find((x) => x.id === input.facilityId);
      if (!m || !f) return fail('Unknown medicine or facility.', 422, 'VALIDATION');
      if (new Date(input.expiryDate).getTime() <= TODAY) return fail('Cannot receive an already-expired batch.', 422, 'VALIDATION', { expiryDate: ['Expiry must be in the future'] });
      const seq = nextBatchSeq();
      const batch: Batch = {
        id: `bat-${String(seq).padStart(5, '0')}`,
        batchNumber: input.batchNumber,
        medicine: { id: m!.id, name: m!.name, strength: m!.strength, unit: m!.unit },
        facility: { id: f!.id, name: f!.name, code: f!.code },
        manufactureDate: input.manufactureDate,
        expiryDate: input.expiryDate,
        quantityAvailable: input.quantity,
        quantityReserved: 0,
        quantityDamaged: 0,
        unitCost: input.unitCost,
        receivedAt: new Date().toISOString(),
      };
      batches.push(batch);
      recordMovement(user, batch, 'RECEIPT', input.quantity, 'Goods received', `GRN-${Date.now().toString().slice(-5)}`);
      audit(user, 'BATCH_RECEIVED', 'BATCH', batch.id, `${input.quantity} × ${m!.name} ${m!.strength}, batch ${batch.batchNumber}`, f!.id);
      return delay(batch);
    },
    async adjust(batchId, input) {
      const user = currentUser();
      const b = batches.find((x) => x.id === batchId);
      if (!b) return fail('Batch not found.', 404, 'NOT_FOUND');
      if (!canWrite(user) || !worksAt(user, b!.facility.id)) return fail('You can only adjust stock at your own facility.', 403, 'FORBIDDEN');
      const decrease = input.type !== 'CORRECTION' || input.direction !== 'INCREASE';
      if (decrease && input.quantity > b!.quantityAvailable) {
        return fail(`Only ${b!.quantityAvailable} units are available in this batch.`, 422, 'INSUFFICIENT_STOCK', { quantity: [`Maximum ${b!.quantityAvailable}`] });
      }
      if (input.type === 'DISPENSE' && isExpired(b!)) return fail('Expired stock cannot be dispensed.', 422, 'BATCH_EXPIRED');
      if (input.type === 'WRITE_OFF' && !isExpired(b!)) return fail('Only expired batches can be written off.', 422, 'BATCH_NOT_EXPIRED');
      const signed = decrease ? -input.quantity : input.quantity;
      b!.quantityAvailable += signed;
      if (input.type === 'DAMAGE') b!.quantityDamaged += input.quantity;
      const movementType: MovementType = input.type === 'WRITE_OFF' ? 'EXPIRED_WRITE_OFF' : input.type;
      const auditAction = { DAMAGE: 'STOCK_DAMAGED', DISPENSE: 'STOCK_DISPENSED', CORRECTION: 'STOCK_CORRECTED', WRITE_OFF: 'STOCK_WRITTEN_OFF' }[input.type];
      recordMovement(user, b!, movementType, signed, input.reason);
      audit(user, auditAction, 'BATCH', b!.id, `${signed > 0 ? '+' : ''}${signed} × ${b!.medicine.name}, batch ${b!.batchNumber}: ${input.reason}`, b!.facility.id);
      return delay(b!);
    },
    async movements(params) {
      currentUser();
      const list = movements.filter(
        (m) =>
          byFacility(params.facilityId, m.facility.id) &&
          (!params.medicineId || m.medicine.id === params.medicineId) &&
          (!params.batchId || m.batch.id === params.batchId) &&
          (!params.type || m.type === params.type) &&
          matches(params.search, m.medicine.name, m.batch.batchNumber, m.reference, m.performedBy.name),
      );
      return delay(
        paginate(list, { sortBy: 'createdAt', sortDir: 'desc', ...params }, {
          createdAt: (m) => m.createdAt,
          quantity: (m) => m.quantity,
          medicine: (m) => m.medicine.name.toLowerCase(),
        }),
      );
    },
  },

  alerts: {
    async shortages(params) {
      currentUser();
      const list = computeShortages().filter(
        (s) =>
          byFacility(params.facilityId, s.facility.id) &&
          (!params.severity || s.severity === params.severity) &&
          matches(params.search, s.medicine.name, s.facility.name, s.medicine.category),
      );
      return delay(
        paginate(list, { sortBy: 'daysRemaining', ...params }, {
          daysRemaining: (s) => s.daysRemaining ?? Number.MAX_SAFE_INTEGER,
          currentStock: (s) => s.currentStock,
          medicine: (s) => s.medicine.name.toLowerCase(),
          facility: (s) => s.facility.name,
          coverage: (s) => s.currentStock / Math.max(1, s.reorderThreshold),
        }),
      );
    },
    async expiry(params) {
      currentUser();
      const list = expiringBatches(params.window).filter(
        (b) => byFacility(params.facilityId, b.facility.id) && matches(params.search, b.medicine.name, b.batchNumber, b.facility.name),
      );
      return delay(
        paginate(list, { sortBy: 'daysToExpiry', ...params }, {
          daysToExpiry: (b) => b.daysToExpiry,
          quantityAvailable: (b) => b.quantityAvailable,
          medicine: (b) => b.medicine.name.toLowerCase(),
          facility: (b) => b.facility.name,
          value: (b) => b.quantityAvailable * b.unitCost,
        }),
      );
    },
    async expirySummary({ facilityId }) {
      currentUser();
      const scoped = (w: '7' | '30' | '60' | 'expired') => expiringBatches(w).filter((b) => byFacility(facilityId, b.facility.id));
      const w60 = scoped('60');
      return delay({
        expired: scoped('expired').length,
        within7: scoped('7').length,
        within30: scoped('30').length,
        within60: w60.length,
        unitsAtRisk: w60.reduce((s, b) => s + b.quantityAvailable, 0),
      });
    },
  },

  redistribution: {
    async recommendations(params) {
      currentUser();
      const list = computeRecommendations().filter(
        (r) =>
          (!params.facilityId || r.sourceFacility.id === params.facilityId || r.destinationFacility.id === params.facilityId) &&
          (!params.reasonCode || r.reasonCode === params.reasonCode) &&
          matches(params.search, r.medicine.name, r.sourceFacility.name, r.destinationFacility.name),
      );
      return delay(
        paginate(list, { sortBy: 'priorityScore', sortDir: 'desc', ...params }, {
          priorityScore: (r) => r.priorityScore,
          distanceKm: (r) => r.distanceKm,
          expiryDate: (r) => r.expiryDate,
          suggestedQuantity: (r) => r.suggestedQuantity,
        }),
      );
    },
  },

  transfers: {
    async list(params) {
      currentUser();
      const list = transfers.filter((t) => {
        const involves = !params.facilityId || t.sourceFacility.id === params.facilityId || t.destinationFacility.id === params.facilityId;
        const dir =
          !params.direction || !params.facilityId ||
          (params.direction === 'incoming' ? t.destinationFacility.id === params.facilityId : t.sourceFacility.id === params.facilityId);
        return (
          involves && dir &&
          (!params.status || t.status === params.status) &&
          matches(params.search, t.code, t.medicine.name, t.sourceFacility.name, t.destinationFacility.name, t.batch.batchNumber)
        );
      });
      return delay(
        paginate(list, { sortBy: 'createdAt', sortDir: 'desc', ...params }, {
          createdAt: (t) => t.createdAt,
          updatedAt: (t) => t.updatedAt,
          quantity: (t) => t.quantity,
          medicine: (t) => t.medicine.name.toLowerCase(),
        }),
      );
    },
    async get(id) {
      currentUser();
      const t = transfers.find((x) => x.id === id);
      if (!t) return fail('Transfer not found.', 404, 'NOT_FOUND');
      return delay(t!);
    },
    async create(input) {
      const user = currentUser();
      if (!canWrite(user)) return fail('Viewers cannot request transfers.', 403, 'FORBIDDEN');
      const b = batches.find((x) => x.id === input.batchId);
      const dest = facilities.find((f) => f.id === input.destinationFacilityId);
      if (!b || !dest) return fail('Unknown batch or destination facility.', 422, 'VALIDATION');
      if (!isAdmin(user) && user.facilityId !== dest!.id && user.facilityId !== b!.facility.id) {
        return fail('You can only request transfers into or out of your own facility.', 403, 'FORBIDDEN');
      }
      if (dest!.id === b!.facility.id) return fail('Source and destination must differ.', 422, 'VALIDATION', { destinationFacilityId: ['Choose a different facility'] });
      if (isExpired(b!)) return fail('Expired batches cannot be transferred.', 422, 'BATCH_EXPIRED');
      if (input.quantity > b!.quantityAvailable) {
        return fail(`Only ${b!.quantityAvailable} units are available in batch ${b!.batchNumber}.`, 422, 'INSUFFICIENT_STOCK', { quantity: [`Maximum ${b!.quantityAvailable}`] });
      }
      b!.quantityAvailable -= input.quantity;
      b!.quantityReserved += input.quantity;
      const now = new Date().toISOString();
      const t: Transfer = {
        id: `trf-${String(transfers.length + 1).padStart(4, '0')}`,
        code: nextTransferCode(),
        status: 'PENDING',
        medicine: b!.medicine,
        batch: { id: b!.id, batchNumber: b!.batchNumber, expiryDate: b!.expiryDate },
        sourceFacility: b!.facility,
        destinationFacility: { id: dest!.id, name: dest!.name, code: dest!.code },
        quantity: input.quantity,
        notes: input.notes || null,
        rejectionReason: null,
        recommendationId: input.recommendationId ?? null,
        requestedBy: { id: user.id, name: user.name },
        createdAt: now,
        updatedAt: now,
        history: [{ status: 'PENDING', at: now, by: { id: user.id, name: user.name }, note: input.notes || 'Requested' }],
      };
      transfers.push(t);
      audit(user, 'TRANSFER_REQUESTED', 'TRANSFER', t.id, `${t.code}: ${t.quantity} × ${t.medicine.name} ${t.medicine.strength} (${t.sourceFacility.code} → ${t.destinationFacility.code})`, dest!.id);
      return delay(t);
    },
    async act(id, action, body) {
      const user = currentUser();
      const t = transfers.find((x) => x.id === id);
      if (!t) return fail('Transfer not found.', 404, 'NOT_FOUND');
      const tr = t!;
      const b = batches.find((x) => x.id === tr.batch.id)!;

      const rules: Record<TransferAction, { from: TransferStatus[]; to: TransferStatus; allowed: boolean }> = {
        approve: { from: ['PENDING'], to: 'APPROVED', allowed: isAdmin(user) || (user.role === 'FACILITY_MANAGER' && user.facilityId === tr.sourceFacility.id) },
        reject: { from: ['PENDING', 'APPROVED'], to: 'REJECTED', allowed: isAdmin(user) || (user.role === 'FACILITY_MANAGER' && user.facilityId === tr.sourceFacility.id) },
        dispatch: { from: ['APPROVED'], to: 'DISPATCHED', allowed: canWrite(user) && worksAt(user, tr.sourceFacility.id) },
        receive: { from: ['DISPATCHED'], to: 'RECEIVED', allowed: canWrite(user) && worksAt(user, tr.destinationFacility.id) },
        cancel: { from: ['PENDING'], to: 'CANCELLED', allowed: isAdmin(user) || tr.requestedBy.id === user.id },
      };
      const rule = rules[action];
      if (!rule.allowed) return fail(`You are not permitted to ${action} this transfer.`, 403, 'FORBIDDEN');
      if (!rule.from.includes(tr.status)) return fail(`Cannot ${action} a transfer that is ${tr.status.toLowerCase()}.`, 409, 'INVALID_STATE');
      if (action === 'reject' && !body?.reason?.trim()) return fail('A rejection reason is required.', 422, 'VALIDATION', { reason: ['Required'] });

      if (action === 'reject' || action === 'cancel') {
        b.quantityReserved -= tr.quantity;
        b.quantityAvailable += tr.quantity;
        tr.rejectionReason = action === 'reject' ? body!.reason!.trim() : null;
      }
      if (action === 'dispatch') {
        b.quantityReserved -= tr.quantity;
        recordMovement(user, b, 'TRANSFER_OUT', -tr.quantity, `To ${tr.destinationFacility.name}`, tr.code);
      }
      if (action === 'receive') {
        const dest = facilities.find((f) => f.id === tr.destinationFacility.id)!;
        let target = batches.find((x) => x.facility.id === dest.id && x.batchNumber === b.batchNumber && x.medicine.id === b.medicine.id);
        if (!target) {
          target = { ...b, id: `bat-${String(nextBatchSeq()).padStart(5, '0')}`, facility: tr.destinationFacility, quantityAvailable: 0, quantityReserved: 0, quantityDamaged: 0, receivedAt: new Date().toISOString() };
          batches.push(target);
        }
        target.quantityAvailable += tr.quantity;
        recordMovement(user, target, 'TRANSFER_IN', tr.quantity, `From ${tr.sourceFacility.name}`, tr.code);
      }

      const now = new Date().toISOString();
      tr.status = rule.to;
      tr.updatedAt = now;
      tr.history.push({ status: rule.to, at: now, by: { id: user.id, name: user.name }, note: body?.reason || body?.note || null });
      audit(user, ACTION_BY_STATUS[rule.to], 'TRANSFER', tr.id, `${tr.code}: ${tr.quantity} × ${tr.medicine.name} ${tr.medicine.strength} (${tr.sourceFacility.code} → ${tr.destinationFacility.code})`, action === 'receive' ? tr.destinationFacility.id : tr.sourceFacility.id);
      return delay(tr);
    },
  },

  analytics: {
    async overview({ facilityId, months = 6 }) {
      currentUser();
      const scopedBatches = batches.filter((b) => byFacility(facilityId, b.facility.id));
      const scopedTransfers = transfers.filter((t) => !facilityId || t.sourceFacility.id === facilityId || t.destinationFacility.id === facilityId);

      const inventoryDistribution = facilities
        .filter((f) => byFacility(facilityId, f.id))
        .map((f) => {
          const own = batches.filter((b) => b.facility.id === f.id && !isExpired(b));
          return {
            facilityId: f.id,
            facilityName: f.name,
            facilityCode: f.code,
            available: own.reduce((s, b) => s + b.quantityAvailable, 0),
            reserved: own.reduce((s, b) => s + b.quantityReserved, 0),
            damaged: own.reduce((s, b) => s + b.quantityDamaged, 0),
          };
        });

      const expiryKeys = monthKeys(-2, 9);
      const expiryTrend = expiryKeys.map((month) => {
        const inMonth = scopedBatches.filter((b) => b.expiryDate.slice(0, 7) === month && b.quantityAvailable > 0);
        return { month, units: inMonth.reduce((s, b) => s + b.quantityAvailable, 0), batches: inMonth.length };
      });

      const shortages = computeShortages().filter((s) => byFacility(facilityId, s.facility.id));
      const riskMap = new Map<string, { medicineId: string; medicineName: string; facilitiesAffected: number; criticalCount: number; minDaysRemaining: number | null }>();
      for (const s of shortages) {
        const r = riskMap.get(s.medicine.id) ?? { medicineId: s.medicine.id, medicineName: s.medicine.name, facilitiesAffected: 0, criticalCount: 0, minDaysRemaining: null };
        r.facilitiesAffected++;
        if (s.severity === 'CRITICAL') r.criticalCount++;
        if (s.daysRemaining !== null) r.minDaysRemaining = r.minDaysRemaining === null ? s.daysRemaining : Math.min(r.minDaysRemaining, s.daysRemaining);
        riskMap.set(s.medicine.id, r);
      }
      const shortageRisk = [...riskMap.values()].sort((a, b) => b.criticalCount - a.criticalCount || b.facilitiesAffected - a.facilitiesAffected).slice(0, 10);

      const pastKeys = monthKeys(-(months - 1), 0);
      const eventMonth = (t: Transfer, s: TransferStatus) => {
        const e = t.history.find((h) => h.status === s);
        return e ? monthKey(new Date(e.at).getTime()) : null;
      };
      const transferStats = pastKeys.map((month) => ({
        month,
        requested: scopedTransfers.filter((t) => monthKey(new Date(t.createdAt).getTime()) === month).length,
        received: scopedTransfers.filter((t) => eventMonth(t, 'RECEIVED') === month).length,
        rejected: scopedTransfers.filter((t) => eventMonth(t, 'REJECTED') === month).length,
      }));
      const statuses: TransferStatus[] = ['PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'REJECTED', 'CANCELLED'];
      const transferStatusBreakdown = statuses.map((status) => ({ status, count: scopedTransfers.filter((t) => t.status === status).length }));
      const closed = scopedTransfers.filter((t) => ['RECEIVED', 'REJECTED', 'CANCELLED'].includes(t.status));
      const transferCompletionRate = closed.length ? closed.filter((t) => t.status === 'RECEIVED').length / closed.length : 0;

      const scopedMovements = movements.filter((m) => byFacility(facilityId, m.facility.id));
      const movementTrend = pastKeys.map((month) => {
        const inMonth = scopedMovements.filter((m) => monthKey(new Date(m.createdAt).getTime()) === month);
        const sum = (types: MovementType[]) => inMonth.filter((m) => types.includes(m.type)).reduce((s, m) => s + Math.abs(m.quantity), 0);
        return { month, inbound: sum(['RECEIPT', 'TRANSFER_IN']), outbound: sum(['DISPENSE', 'TRANSFER_OUT']), losses: sum(['DAMAGE', 'EXPIRED_WRITE_OFF']) };
      });

      const catMap = new Map<string, number>();
      for (const b of scopedBatches.filter((x) => !isExpired(x))) {
        const cat = medicines.find((m) => m.id === b.medicine.id)?.category ?? 'Other';
        catMap.set(cat, (catMap.get(cat) ?? 0) + b.quantityAvailable);
      }
      const stockByCategory = [...catMap.entries()].map(([category, units]) => ({ category, units })).sort((a, b) => b.units - a.units);

      const result: AnalyticsOverview = {
        inventoryDistribution,
        expiryTrend,
        shortageRisk,
        transferStats,
        transferStatusBreakdown,
        transferCompletionRate,
        movementTrend,
        stockByCategory,
      };
      return delay(result);
    },
  },

  audit: {
    async list(params) {
      const user = currentUser();
      if (user.role !== 'ADMIN') return fail('Audit logs are restricted to administrators.', 403, 'FORBIDDEN');
      const from = params.from ? new Date(params.from).getTime() : -Infinity;
      const to = params.to ? new Date(params.to).getTime() + DAY : Infinity;
      const list = auditLogs.filter((l) => {
        const ts = new Date(l.timestamp).getTime();
        return (
          (!params.entityType || l.entityType === params.entityType) &&
          (!params.action || l.action === params.action) &&
          (!params.userId || l.user.id === params.userId) &&
          ts >= from && ts < to &&
          matches(params.search, l.user.name, l.description, l.action, l.entityId)
        );
      });
      return delay(
        paginate(list, { sortBy: 'timestamp', sortDir: 'desc', ...params }, {
          timestamp: (l) => l.timestamp,
          user: (l) => l.user.name,
          action: (l) => l.action,
          entityType: (l) => l.entityType,
        }),
      );
    },
  },
};

