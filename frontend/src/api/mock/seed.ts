/**
 * SYNTHETIC DEMONSTRATION DATA — not real facilities, stock or patients.
 * Generated deterministically (seeded PRNG) relative to today's date so that
 * expiry windows, shortages and trends always look current during UI development.
 */
import type {
  AuditLog,
  Batch,
  DosageForm,
  Facility,
  FacilityType,
  InventoryMovement,
  Medicine,
  Role,
  Transfer,
  TransferEvent,
  TransferStatus,
  User,
} from '../types';

export const DAY = 86_400_000;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261102);
const between = (min: number, max: number) => min + rand() * (max - min);
const int = (min: number, max: number) => Math.floor(between(min, max + 1));
const pick = <T>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
export const TODAY = startOfToday();
/** Seeded events never lie in the future. */
const iso = (ms: number) => new Date(Math.min(ms, Date.now() - 30 * 60_000)).toISOString();
/** Local calendar date (toISOString would shift to the previous day east of UTC). */
const dateOnly = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* ----------------------------------------------------------------------------
 * Facilities
 * ------------------------------------------------------------------------- */

interface FacilitySeed {
  name: string;
  type: FacilityType;
  city: string;
  district: string;
  lat: number;
  lng: number;
}

const FACILITY_SEEDS: FacilitySeed[] = [
  { name: 'Central District Hospital', type: 'HOSPITAL', city: 'Bengaluru', district: 'Bengaluru Urban', lat: 12.9716, lng: 77.5946 },
  { name: 'North Zone General Hospital', type: 'HOSPITAL', city: 'Yelahanka', district: 'Bengaluru Urban', lat: 13.1007, lng: 77.5963 },
  { name: 'Whitefield Community Health Centre', type: 'COMMUNITY_HEALTH_CENTRE', city: 'Whitefield', district: 'Bengaluru Urban', lat: 12.9698, lng: 77.75 },
  { name: 'Kengeri Community Health Centre', type: 'COMMUNITY_HEALTH_CENTRE', city: 'Kengeri', district: 'Bengaluru Urban', lat: 12.9081, lng: 77.4855 },
  { name: 'Hoskote Primary Health Centre', type: 'PRIMARY_HEALTH_CENTRE', city: 'Hoskote', district: 'Bengaluru Rural', lat: 13.0707, lng: 77.7982 },
  { name: 'Anekal Primary Health Centre', type: 'PRIMARY_HEALTH_CENTRE', city: 'Anekal', district: 'Bengaluru Urban', lat: 12.7105, lng: 77.697 },
  { name: 'Devanahalli Primary Health Centre', type: 'PRIMARY_HEALTH_CENTRE', city: 'Devanahalli', district: 'Bengaluru Rural', lat: 13.2473, lng: 77.712 },
  { name: 'Regional Medical Stores', type: 'WAREHOUSE', city: 'Peenya', district: 'Bengaluru Urban', lat: 13.0285, lng: 77.541 },
  { name: 'Ramanagara District Hospital', type: 'HOSPITAL', city: 'Ramanagara', district: 'Ramanagara', lat: 12.7159, lng: 77.281 },
  { name: 'Magadi Primary Health Centre', type: 'PRIMARY_HEALTH_CENTRE', city: 'Magadi', district: 'Ramanagara', lat: 12.9579, lng: 77.224 },
];

export const FACILITY_SCALE: Record<FacilityType, number> = {
  HOSPITAL: 1.6,
  COMMUNITY_HEALTH_CENTRE: 1,
  PRIMARY_HEALTH_CENTRE: 0.5,
  WAREHOUSE: 4,
};

const CONTACTS = ['Dr. Kavya Nair', 'Suresh Gowda', 'Dr. Farah Khan', 'Prakash Rao', 'Lakshmi Devi', 'Dr. Arjun Menon', 'Nandini Hegde', 'Ravi Kumar', 'Dr. Sneha Patil', 'Imran Sheikh'];

export const facilities: Facility[] = FACILITY_SEEDS.map((f, i) => ({
  id: `fac-${String(i + 1).padStart(3, '0')}`,
  code: `FAC-${String(i + 1).padStart(3, '0')}`,
  name: f.name,
  type: f.type,
  address: `${int(1, 240)}, ${pick(['Main Road', 'Hospital Road', 'Station Road', 'Market Road', 'Ring Road'])}`,
  city: f.city,
  district: f.district,
  latitude: f.lat,
  longitude: f.lng,
  contactName: CONTACTS[i],
  contactPhone: `+91 80 ${int(2000, 2999)} ${int(1000, 9999)}`,
  isActive: true,
}));

/* ----------------------------------------------------------------------------
 * Medicines
 * ------------------------------------------------------------------------- */

interface MedicineSeed {
  name: string;
  generic: string;
  category: string;
  form: DosageForm;
  strength: string;
  unit: string;
  reorder: number;
  critical: number;
  /** Units/day at a facility of scale 1. */
  daily: number;
  essential: boolean;
}

const MEDICINE_SEEDS: MedicineSeed[] = [
  { name: 'Paracetamol', generic: 'Paracetamol', category: 'Analgesics', form: 'TABLET', strength: '500 mg', unit: 'tablet', reorder: 3000, critical: 1000, daily: 120, essential: true },
  { name: 'Ibuprofen', generic: 'Ibuprofen', category: 'Analgesics', form: 'TABLET', strength: '400 mg', unit: 'tablet', reorder: 1500, critical: 500, daily: 45, essential: true },
  { name: 'Diclofenac Sodium', generic: 'Diclofenac', category: 'Analgesics', form: 'INJECTION', strength: '75 mg/3 mL', unit: 'ampoule', reorder: 200, critical: 60, daily: 6, essential: false },
  { name: 'Amoxicillin', generic: 'Amoxicillin', category: 'Antibiotics', form: 'CAPSULE', strength: '500 mg', unit: 'capsule', reorder: 2000, critical: 700, daily: 70, essential: true },
  { name: 'Azithromycin', generic: 'Azithromycin', category: 'Antibiotics', form: 'TABLET', strength: '500 mg', unit: 'tablet', reorder: 600, critical: 200, daily: 18, essential: true },
  { name: 'Ceftriaxone', generic: 'Ceftriaxone', category: 'Antibiotics', form: 'INJECTION', strength: '1 g', unit: 'vial', reorder: 300, critical: 100, daily: 10, essential: true },
  { name: 'Ciprofloxacin', generic: 'Ciprofloxacin', category: 'Antibiotics', form: 'TABLET', strength: '500 mg', unit: 'tablet', reorder: 800, critical: 250, daily: 22, essential: true },
  { name: 'Metronidazole', generic: 'Metronidazole', category: 'Antibiotics', form: 'TABLET', strength: '400 mg', unit: 'tablet', reorder: 900, critical: 300, daily: 25, essential: true },
  { name: 'Metformin', generic: 'Metformin Hydrochloride', category: 'Antidiabetics', form: 'TABLET', strength: '500 mg', unit: 'tablet', reorder: 4000, critical: 1400, daily: 150, essential: true },
  { name: 'Glibenclamide', generic: 'Glibenclamide', category: 'Antidiabetics', form: 'TABLET', strength: '5 mg', unit: 'tablet', reorder: 1200, critical: 400, daily: 35, essential: true },
  { name: 'Human Insulin (Regular)', generic: 'Insulin, soluble', category: 'Antidiabetics', form: 'INJECTION', strength: '40 IU/mL, 10 mL', unit: 'vial', reorder: 120, critical: 40, daily: 4, essential: true },
  { name: 'Amlodipine', generic: 'Amlodipine Besylate', category: 'Cardiovascular', form: 'TABLET', strength: '5 mg', unit: 'tablet', reorder: 3000, critical: 1000, daily: 100, essential: true },
  { name: 'Losartan Potassium', generic: 'Losartan', category: 'Cardiovascular', form: 'TABLET', strength: '50 mg', unit: 'tablet', reorder: 1500, critical: 500, daily: 50, essential: true },
  { name: 'Atorvastatin', generic: 'Atorvastatin Calcium', category: 'Cardiovascular', form: 'TABLET', strength: '10 mg', unit: 'tablet', reorder: 1800, critical: 600, daily: 55, essential: true },
  { name: 'Enalapril Maleate', generic: 'Enalapril', category: 'Cardiovascular', form: 'TABLET', strength: '5 mg', unit: 'tablet', reorder: 1000, critical: 300, daily: 28, essential: true },
  { name: 'Heparin Sodium', generic: 'Heparin', category: 'Anticoagulants', form: 'INJECTION', strength: '5000 IU/mL, 5 mL', unit: 'vial', reorder: 80, critical: 25, daily: 2.5, essential: true },
  { name: 'Salbutamol', generic: 'Salbutamol Sulphate', category: 'Respiratory', form: 'INHALER', strength: '100 mcg/dose', unit: 'inhaler', reorder: 150, critical: 50, daily: 4, essential: true },
  { name: 'Budesonide', generic: 'Budesonide', category: 'Respiratory', form: 'INHALER', strength: '200 mcg/dose', unit: 'inhaler', reorder: 80, critical: 25, daily: 2, essential: false },
  { name: 'Omeprazole', generic: 'Omeprazole', category: 'Gastrointestinal', form: 'CAPSULE', strength: '20 mg', unit: 'capsule', reorder: 2000, critical: 600, daily: 60, essential: true },
  { name: 'Ondansetron', generic: 'Ondansetron', category: 'Gastrointestinal', form: 'TABLET', strength: '4 mg', unit: 'tablet', reorder: 600, critical: 200, daily: 15, essential: true },
  { name: 'Oral Rehydration Salts', generic: 'ORS (WHO formula)', category: 'Gastrointestinal', form: 'SACHET', strength: '20.5 g', unit: 'sachet', reorder: 1500, critical: 500, daily: 45, essential: true },
  { name: 'Sodium Chloride 0.9%', generic: 'Normal Saline', category: 'IV Fluids', form: 'INFUSION', strength: '500 mL', unit: 'bottle', reorder: 500, critical: 150, daily: 16, essential: true },
  { name: "Ringer's Lactate", generic: 'Compound Sodium Lactate', category: 'IV Fluids', form: 'INFUSION', strength: '500 mL', unit: 'bottle', reorder: 400, critical: 120, daily: 12, essential: true },
  { name: 'Oxytocin', generic: 'Oxytocin', category: 'Hormones', form: 'INJECTION', strength: '5 IU/mL', unit: 'ampoule', reorder: 150, critical: 50, daily: 4, essential: true },
  { name: 'Dexamethasone', generic: 'Dexamethasone Sodium Phosphate', category: 'Hormones', form: 'INJECTION', strength: '4 mg/mL', unit: 'ampoule', reorder: 200, critical: 60, daily: 5, essential: true },
  { name: 'Ferrous Sulphate + Folic Acid', generic: 'Iron + Folic Acid', category: 'Vitamins & Minerals', form: 'TABLET', strength: '100 mg + 0.5 mg', unit: 'tablet', reorder: 5000, critical: 1500, daily: 160, essential: true },
  { name: 'Zinc Sulphate', generic: 'Zinc', category: 'Vitamins & Minerals', form: 'TABLET', strength: '20 mg', unit: 'tablet', reorder: 1000, critical: 300, daily: 25, essential: true },
  { name: 'Artemether + Lumefantrine', generic: 'Artemether/Lumefantrine', category: 'Antimalarials', form: 'TABLET', strength: '20 mg + 120 mg', unit: 'tablet', reorder: 400, critical: 120, daily: 6, essential: true },
  { name: 'Cetirizine', generic: 'Cetirizine Hydrochloride', category: 'Antihistamines', form: 'TABLET', strength: '10 mg', unit: 'tablet', reorder: 1200, critical: 400, daily: 35, essential: false },
  { name: 'Albendazole', generic: 'Albendazole', category: 'Anthelmintics', form: 'TABLET', strength: '400 mg', unit: 'tablet', reorder: 800, critical: 250, daily: 14, essential: true },
  { name: 'Amoxicillin Oral Suspension', generic: 'Amoxicillin', category: 'Antibiotics', form: 'SYRUP', strength: '125 mg/5 mL, 60 mL', unit: 'bottle', reorder: 250, critical: 80, daily: 7, essential: true },
  { name: 'Silver Sulfadiazine', generic: 'Silver Sulfadiazine', category: 'Dermatologicals', form: 'CREAM', strength: '1%, 25 g', unit: 'tube', reorder: 100, critical: 30, daily: 2, essential: false },
];

const MANUFACTURERS = ['Karnataka Antibiotics & Pharma', 'Hindustan Lifecare Generics', 'Deccan Pharmaceuticals', 'Sahyadri Labs', 'National Generic Formulations', 'Medipure Healthcare'];

export const medicines: Medicine[] = MEDICINE_SEEDS.map((m, i) => ({
  id: `med-${String(i + 1).padStart(3, '0')}`,
  code: `MED-${String(i + 1).padStart(4, '0')}`,
  name: m.name,
  genericName: m.generic,
  category: m.category,
  dosageForm: m.form,
  strength: m.strength,
  unit: m.unit,
  manufacturer: pick(MANUFACTURERS),
  reorderThreshold: m.reorder,
  criticalThreshold: m.critical,
  isEssential: m.essential,
  description: undefined,
  createdAt: iso(TODAY - int(200, 400) * DAY),
}));

/** Units/day per facility-medicine, keyed `${facilityId}:${medicineId}`. */
export const consumption = new Map<string, number>();

/* ----------------------------------------------------------------------------
 * Users
 * ------------------------------------------------------------------------- */

export interface MockUser extends User {
  password: string;
}

export const DEMO_PASSWORD = 'MedShare@2026';

export const users: MockUser[] = [
  { id: 'usr-001', name: 'Asha Raman', email: 'admin@medshare.health', role: 'ADMIN', facilityId: null, password: DEMO_PASSWORD },
  { id: 'usr-002', name: 'Vikram Shetty', email: 'manager@medshare.health', role: 'FACILITY_MANAGER', facilityId: 'fac-001', password: DEMO_PASSWORD },
  { id: 'usr-003', name: 'Meera Iyer', email: 'pharmacist@medshare.health', role: 'PHARMACIST', facilityId: 'fac-005', password: DEMO_PASSWORD },
  { id: 'usr-004', name: 'Rohit Kulkarni', email: 'viewer@medshare.health', role: 'VIEWER', facilityId: 'fac-003', password: DEMO_PASSWORD },
  { id: 'usr-005', name: 'Divya Prasad', email: 'divya.p@medshare.health', role: 'PHARMACIST', facilityId: 'fac-002', password: DEMO_PASSWORD },
  { id: 'usr-006', name: 'Kiran Joshi', email: 'kiran.j@medshare.health', role: 'FACILITY_MANAGER', facilityId: 'fac-008', password: DEMO_PASSWORD },
  { id: 'usr-007', name: 'Anil Bhat', email: 'anil.b@medshare.health', role: 'PHARMACIST', facilityId: 'fac-009', password: DEMO_PASSWORD },
  { id: 'usr-008', name: 'Pooja Reddy', email: 'pooja.r@medshare.health', role: 'FACILITY_MANAGER', facilityId: 'fac-003', password: DEMO_PASSWORD },
].map((u) => ({ ...u, role: u.role as Role, facilityName: facilities.find((f) => f.id === u.facilityId)?.name ?? null }));

const staffAt = (facilityId: string) => {
  const local = users.filter((u) => u.facilityId === facilityId && u.role !== 'VIEWER');
  return local.length ? pick(local) : users[0];
};

/* ----------------------------------------------------------------------------
 * Batches & movements
 * ------------------------------------------------------------------------- */

export const batches: Batch[] = [];
export const movements: InventoryMovement[] = [];

const fRef = (f: Facility) => ({ id: f.id, name: f.name, code: f.code });
const mRef = (m: Medicine) => ({ id: m.id, name: m.name, strength: m.strength, unit: m.unit });

let batchSeq = 1;
let movementSeq = 1;
export const nextMovementId = () => `mov-${String(movementSeq++).padStart(6, '0')}`;
export const nextBatchSeq = () => batchSeq++;

function expiryOffsetDays() {
  const r = rand();
  if (r < 0.03) return -int(1, 60);
  if (r < 0.06) return int(1, 7);
  if (r < 0.12) return int(8, 30);
  if (r < 0.2) return int(31, 60);
  return int(61, 720);
}

for (const f of facilities) {
  const scale = FACILITY_SCALE[f.type];
  for (const m of medicines) {
    const stocked = f.type === 'WAREHOUSE' || rand() < 0.82;
    const daily = Math.max(0.2, m.reorderThreshold > 0 ? MEDICINE_SEEDS[medicines.indexOf(m)].daily * scale * between(0.6, 1.4) : 1);
    consumption.set(`${f.id}:${m.id}`, f.type === 'WAREHOUSE' ? daily * 0.15 : daily);
    if (!stocked) continue;

    const reorder = m.reorderThreshold * scale;
    const critical = m.criticalThreshold * scale;
    const r = rand();
    let target: number;
    if (f.type !== 'WAREHOUSE' && r < 0.05) target = critical * between(0.05, 0.9);
    else if (f.type !== 'WAREHOUSE' && r < 0.14) target = between(critical, reorder);
    else target = reorder * between(1.1, 3.4);
    target = Math.max(1, Math.round(target));

    const nBatches = target < 50 ? 1 : int(1, 3);
    let remaining = target;
    for (let b = 0; b < nBatches; b++) {
      const qty = b === nBatches - 1 ? remaining : Math.round(remaining * between(0.3, 0.6));
      remaining -= qty;
      const expiry = TODAY + expiryOffsetDays() * DAY;
      const received = Math.min(TODAY - int(5, 180) * DAY, expiry - 30 * DAY);
      const manufactured = received - int(30, 120) * DAY;
      const damaged = rand() < 0.12 ? int(1, Math.max(2, Math.round(qty * 0.04))) : 0;
      const dispensedTotal = Math.round(qty * between(0.3, 1.2));
      const seq = batchSeq++;
      const batch: Batch = {
        id: `bat-${String(seq).padStart(5, '0')}`,
        batchNumber: `${m.code.slice(4)}${String.fromCharCode(65 + (seq % 26))}${String(int(1000, 9999))}`,
        medicine: mRef(m),
        facility: fRef(f),
        manufactureDate: dateOnly(manufactured),
        expiryDate: dateOnly(expiry),
        quantityAvailable: qty,
        quantityReserved: 0,
        quantityDamaged: damaged,
        unitCost: Math.round(between(0.4, 4) * (m.dosageForm === 'INJECTION' || m.dosageForm === 'INFUSION' || m.dosageForm === 'INHALER' ? 30 : 1) * 100) / 100,
        receivedAt: iso(received),
      };
      batches.push(batch);

      const by = staffAt(f.id);
      movements.push({
        id: nextMovementId(),
        type: 'RECEIPT',
        quantity: qty + damaged + dispensedTotal,
        batch: { id: batch.id, batchNumber: batch.batchNumber },
        medicine: batch.medicine,
        facility: batch.facility,
        performedBy: { id: by.id, name: by.name },
        reference: `GRN-${int(10000, 99999)}`,
        note: null,
        createdAt: iso(received + int(1, 6) * 3_600_000),
      });

      // Spread dispensing between receipt and today (or expiry, if earlier).
      const end = Math.min(TODAY, expiry);
      const nDispense = int(2, 5);
      let left = dispensedTotal;
      for (let d = 0; d < nDispense && left > 0; d++) {
        const q = d === nDispense - 1 ? left : Math.round(left * between(0.2, 0.5));
        left -= q;
        if (q <= 0) continue;
        const at = received + ((end - received) * (d + 1)) / (nDispense + 1) + int(8, 18) * 3_600_000;
        const p = staffAt(f.id);
        movements.push({
          id: nextMovementId(),
          type: 'DISPENSE',
          quantity: -q,
          batch: { id: batch.id, batchNumber: batch.batchNumber },
          medicine: batch.medicine,
          facility: batch.facility,
          performedBy: { id: p.id, name: p.name },
          reference: null,
          note: 'Ward / OPD issue',
          createdAt: iso(at),
        });
      }
      if (damaged > 0) {
        const p = staffAt(f.id);
        movements.push({
          id: nextMovementId(),
          type: 'DAMAGE',
          quantity: -damaged,
          batch: { id: batch.id, batchNumber: batch.batchNumber },
          medicine: batch.medicine,
          facility: batch.facility,
          performedBy: { id: p.id, name: p.name },
          reference: null,
          note: pick(['Broken in storage', 'Cold-chain excursion', 'Packaging damaged on receipt']),
          createdAt: iso(received + int(2, 20) * DAY),
        });
      }
    }
  }
}

/* ----------------------------------------------------------------------------
 * Transfers (historical + in-flight)
 * ------------------------------------------------------------------------- */

export const transfers: Transfer[] = [];
let transferSeq = 1;
export const nextTransferCode = () => `TRF-${new Date().getFullYear()}-${String(transferSeq++).padStart(4, '0')}`;

const STATUS_PLAN: TransferStatus[] = [
  ...Array<TransferStatus>(22).fill('RECEIVED'),
  ...Array<TransferStatus>(5).fill('REJECTED'),
  ...Array<TransferStatus>(2).fill('CANCELLED'),
  ...Array<TransferStatus>(4).fill('DISPATCHED'),
  ...Array<TransferStatus>(4).fill('APPROVED'),
  ...Array<TransferStatus>(7).fill('PENDING'),
];

for (const status of STATUS_PLAN) {
  const candidates = batches.filter(
    (b) => b.quantityAvailable > 60 && new Date(b.expiryDate).getTime() > TODAY + 20 * DAY,
  );
  const src = pick(candidates);
  const dest = pick(facilities.filter((f) => f.id !== src.facility.id && f.type !== 'WAREHOUSE'));
  const qty = Math.max(10, Math.round(src.quantityAvailable * between(0.08, 0.25) / 10) * 10);

  const inFlight = status === 'PENDING' || status === 'APPROVED' || status === 'DISPATCHED';
  const createdAt = inFlight ? TODAY - int(0, 9) * DAY - int(1, 20) * 3_600_000 : TODAY - int(12, 175) * DAY;
  const requester = staffAt(dest.id);
  const approver = src.facility.id === 'fac-001' ? users[1] : users[0];
  const history: TransferEvent[] = [{ status: 'PENDING', at: iso(createdAt), by: { id: requester.id, name: requester.name }, note: 'Requested' }];
  let t = createdAt;
  const step = (s: TransferStatus, by: User, note?: string) => {
    t += int(4, 40) * 3_600_000;
    history.push({ status: s, at: iso(Math.min(t, Date.now() - 60_000)), by: { id: by.id, name: by.name }, note: note ?? null });
  };
  let rejectionReason: string | null = null;
  if (status === 'REJECTED') {
    rejectionReason = pick(['Stock committed to scheduled outreach camp', 'Batch under quality hold', 'Source facility below its own reorder level']);
    step('REJECTED', approver, rejectionReason);
  } else if (status === 'CANCELLED') {
    step('CANCELLED', requester, 'Requirement met by district supply');
  } else if (status !== 'PENDING') {
    step('APPROVED', approver);
    if (status === 'DISPATCHED' || status === 'RECEIVED') step('DISPATCHED', staffAt(src.facility.id), `Vehicle KA-${int(1, 60)}-${int(1000, 9999)}`);
    if (status === 'RECEIVED') step('RECEIVED', requester, 'Received in full');
  }

  if (status === 'PENDING' || status === 'APPROVED') {
    src.quantityAvailable -= qty;
    src.quantityReserved += qty;
  }

  transfers.push({
    id: `trf-${String(transferSeq).padStart(4, '0')}`,
    code: nextTransferCode(),
    status,
    medicine: src.medicine,
    batch: { id: src.id, batchNumber: src.batchNumber, expiryDate: src.expiryDate },
    sourceFacility: src.facility,
    destinationFacility: fRef(dest),
    quantity: qty,
    notes: rand() < 0.5 ? pick(['Urgent: OPD demand spike', 'Monsoon season buffer', 'Covering supplier delay', 'Redistribution of near-expiry stock']) : null,
    rejectionReason,
    recommendationId: null,
    requestedBy: { id: requester.id, name: requester.name },
    createdAt: iso(createdAt),
    updatedAt: history[history.length - 1].at,
    history,
  });
}

/* ----------------------------------------------------------------------------
 * Audit log
 * ------------------------------------------------------------------------- */

export const auditLogs: AuditLog[] = [];
let auditSeq = 1;
export const nextAuditId = () => `aud-${String(auditSeq++).padStart(6, '0')}`;

const ACTION_BY_STATUS: Record<TransferStatus, string> = {
  PENDING: 'TRANSFER_REQUESTED',
  APPROVED: 'TRANSFER_APPROVED',
  DISPATCHED: 'TRANSFER_DISPATCHED',
  RECEIVED: 'TRANSFER_RECEIVED',
  REJECTED: 'TRANSFER_REJECTED',
  CANCELLED: 'TRANSFER_CANCELLED',
};
export { ACTION_BY_STATUS };

const roleOf = (id: string) => users.find((u) => u.id === id)?.role ?? 'PHARMACIST';

for (const tr of transfers) {
  for (const ev of tr.history) {
    auditLogs.push({
      id: nextAuditId(),
      user: { id: ev.by.id, name: ev.by.name, role: roleOf(ev.by.id) },
      action: ACTION_BY_STATUS[ev.status],
      entityType: 'TRANSFER',
      entityId: tr.id,
      description: `${tr.code}: ${tr.quantity} × ${tr.medicine.name} ${tr.medicine.strength} (${tr.sourceFacility.code} → ${tr.destinationFacility.code})`,
      facility: ev.status === 'PENDING' || ev.status === 'RECEIVED' || ev.status === 'CANCELLED' ? tr.destinationFacility : tr.sourceFacility,
      timestamp: ev.at,
    });
  }
}
for (const mv of movements.filter((m) => m.type === 'RECEIPT' || m.type === 'DAMAGE')) {
  auditLogs.push({
    id: nextAuditId(),
    user: { id: mv.performedBy.id, name: mv.performedBy.name, role: roleOf(mv.performedBy.id) },
    action: mv.type === 'RECEIPT' ? 'BATCH_RECEIVED' : 'STOCK_DAMAGED',
    entityType: 'BATCH',
    entityId: mv.batch.id,
    description: `${Math.abs(mv.quantity)} × ${mv.medicine.name} ${mv.medicine.strength}, batch ${mv.batch.batchNumber}`,
    facility: mv.facility,
    timestamp: mv.createdAt,
  });
}
for (let i = 0; i < 40; i++) {
  const u = pick(users);
  auditLogs.push({
    id: nextAuditId(),
    user: { id: u.id, name: u.name, role: u.role },
    action: 'USER_LOGIN',
    entityType: 'AUTH',
    entityId: u.id,
    description: `Signed in as ${u.email}`,
    facility: facilities.find((f) => f.id === u.facilityId) ? fRef(facilities.find((f) => f.id === u.facilityId)!) : null,
    timestamp: iso(TODAY - int(0, 60) * DAY + int(8, 19) * 3_600_000),
  });
}
