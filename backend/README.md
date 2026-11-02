# MedShare — Backend & Database

PostgreSQL-first backend for **MedShare**, a simulated medicine-inventory coordination platform. It covers shortages, expiry, redistribution and inter-facility transfers.

> **Simulated platform, synthetic data.** No connection to real hospital, pharmacy or government systems. Transfers require authorised human approval, and real-world use would need institutional authorisation and regulatory validation.

| Phase | Status | Document |
|---|---|---|
| 1 — Requirements & database design | ✅ approved | [docs/PHASE1_DATABASE_DESIGN.md](docs/PHASE1_DATABASE_DESIGN.md) |
| 2 — Database implementation | ✅ complete (99 tests passing) | [docs/PHASE2_IMPLEMENTATION.md](docs/PHASE2_IMPLEMENTATION.md) |
| 3 — Express API | next | — |

## Prerequisites

* Docker Desktop (for PostgreSQL 16)
* Node.js 20+

## Setup

```bash
# from the repository root
cp .env.example .env          # then change every password
cd backend
npm install
npm run db:up                 # starts PostgreSQL 16 on localhost:5433 and waits until healthy
npm run db:reset              # drop schema → apply migrations → load synthetic seed (~20 s)
npm run db:test               # 77 SQL integrity checks + 22 multi-connection concurrency checks
```

| Script | What it does |
|---|---|
| `db:up` | `docker compose up -d --wait` using the root `.env` |
| `db:migrate` | Applies new migrations (checksummed; refuses edited ones) |
| `db:seed` | Loads the synthetic dataset into an empty, migrated database |
| `db:reset` | Drops the `public` schema, then migrates and seeds |
| `db:test` | Runs `db/tests/*.sql` (rolled back) and the concurrency suite (throwaway database) |

## Environment variables (root `.env`)

| Variable | Used by | Purpose |
|---|---|---|
| `POSTGRES_ADMIN_USER`, `POSTGRES_ADMIN_PASSWORD`, `POSTGRES_PORT` | docker compose | Container superuser and host port |
| `DATABASE_ADMIN_URL` | `scripts/db.ts` only | Superuser connection for migrations, seed and tests |
| `MEDSHARE_APP_PASSWORD` | `scripts/db.ts` | Sets the password of the least-privilege `medshare_app` role |
| `DATABASE_URL` | API (Phase 3) | Connection as `medshare_app` |

## Layout

```
backend/
├── db/
│   ├── migrations/      000 bootstrap · 001 schema · 002 core · 003 triggers · 004 procedures · 005 views · 006 privileges
│   ├── seed/            001 reference data · 002 six months of activity via procedures · 003 jobs + integrity assertion
│   ├── tests/           001_integrity.sql (self-contained, rolled back)
│   └── schema.phase1.sql  Phase 1 design snapshot (historical)
├── scripts/
│   ├── db.ts            migrate / seed / reset / test runner
│   └── concurrency.ts   multi-connection tests (+ withRetry helper)
└── docs/
```

## Demo accounts (synthetic)

All use the password `MedShare@2026`.

| Email | Role |
|---|---|
| `admin@medshare.health` | System administrator |
| `auditor@medshare.health` | Platform auditor |
| `org1.admin@medshare.health` … `org5.admin@medshare.health` | Organisation administrators |
| `org2.auditor@medshare.health` | Auditor scoped to one organisation |
| `fac-001.manager@medshare.health` … `fac-015.manager@…` | Facility managers |
| `fac-001.inventory@medshare.health` … `fac-015.inventory@…` | Inventory managers |

## Useful queries

```sql
SELECT * FROM v_critical_shortages ORDER BY days_of_inventory NULLS FIRST LIMIT 10;
SELECT * FROM v_expiring_inventory ORDER BY days_to_expiry LIMIT 10;
SELECT reason_code, priority_score, explanation FROM redistribution_recommendations WHERE status = 'OPEN' ORDER BY priority_score DESC LIMIT 5;
SELECT * FROM v_transfer_timeline WHERE code = 'TRF-2026-00001';
SELECT * FROM fn_reconcile_inventory();      -- zero rows = balances and ledger agree
```
