# MedShare — Frontend

React + TypeScript frontend for **MedShare**, a simulated medicine-inventory coordination platform for healthcare facilities. It covers stock, shortage and expiry monitoring, redistribution recommendations, stock requests, and inter-facility transfers from request to receipt.

It talks to the MedShare REST API (`backend/`, contract in [`../API_CONTRACT.md`](../API_CONTRACT.md)). There is no mock layer: every screen shows data from PostgreSQL through the API. Seeded data is **synthetic**, and the UI says so.

## Quick start

The backend must be running first (see [`../backend/README.md`](../backend/README.md)): `npm run db:up`, `npm run db:reset`, then `npm run dev` in `backend/` (API on `http://localhost:4000/api/v1`).

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, proxies /api to the backend
```

### Demo accounts (development builds only)

In `npm run dev`, the sign-in page lists synthetic seed accounts and fills them in with one click. The panel is guarded by `import.meta.env.DEV`, so production builds don't contain it. All use the password `MedShare@2026`.

| Account | Roles and scope |
|---|---|
| `admin@medshare.health` | System administrator: whole network, users, batches, audit; cannot approve transfers |
| `auditor@medshare.health` | Platform auditor: read-only, whole network |
| `org1.admin@medshare.health` … `org5.admin@…` | Organisation administrator: own organisation, organisation-stage approvals, "Run engine" |
| `org2.auditor@medshare.health` | Auditor scoped to one organisation |
| `fac-001.manager@medshare.health` … `fac-015.manager@…` | Facility manager: approves outgoing transfers, edits stock policy |
| `fac-001.inventory@medshare.health` … `fac-015.inventory@…` | Inventory manager: receipts, dispensing, damage, requests, dispatch, receipt |

There is no self-registration; administrators create accounts on the **Users** page.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :5173 with the `/api` proxy |
| `npm run build` | Type-check and production build |
| `npm run typecheck` | TypeScript only |
| `npm test` | Vitest unit and component tests (the API module is mocked with `vi.mock`) |

## Configuration

Optional; copy `.env.example` to `.env.local`.

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | `/api/v1` | API base path (relative paths go through the dev proxy) |
| `VITE_PROXY_TARGET` | `http://localhost:4000` | Where the dev server proxies `/api` |

## Features

* **Dashboard**: action banner, KPI tiles linking into filtered views (shortages, expiry, pending / awaiting-dispatch / in-transit transfers, open recommendations and stock requests), shortage and expiry panels, inventory distribution, recent transfers and movements.
* **Medicine catalogue**: search by name, code, substance or manufacturer; category (with sub-categories), form, manufacturer, essential and cold-chain filters; add-medicine form with an **ingredients editor** and substance autocomplete; detail page with ingredients, manufacturers, stock by facility and batches on hand.
* **Batches**: network lots with expiry bucket and holdings; system administrators can quarantine, recall or reactivate a lot.
* **Stock**: scoped inventory rows with available, reserved and damaged buckets; receive stock (creates the lot on first receipt); per-row dispense, damage, dispose, write-off and adjust; stock history from the ledger; "send to another facility".
* **Stock movements**: the signed ledger, filterable by type, facility and date.
* **Facilities**: directory with region (including sub-regions), organisation and type filters; detail with summary KPIs and shortages for in-scope facilities, plus a **stock-policy** tab, editable with `settings:manage`.
* **Shortages**: critical and low tabs, stock-vs-threshold gauge, demand basis (measured, estimated-simulated, estimated-configured, possibly censored), acknowledge, and "Source stock".
* **Expiry**: expired / 7 / 30 / 60-day windows with summary tiles, acknowledge, write-off for expired stock, and "Redistribute" for usable stock.
* **Redistribution**: prioritised recommendations with explanation, distance, batch and staleness; accept (creates a PENDING transfer and opens it) or dismiss; "Run engine" for organisation and system administrators.
* **Stock requests**: list by status and priority with derived received / in-progress / outstanding quantities; create, cancel, and "Source" a line into a linked transfer.
* **Transfers**: active transfers with a "Needs my action" view; multi-item request dialog (pull into your facility from `/medicines/:id/sources`, or push out of it); detail with required stages, approvals, items, a LAG-derived timeline, and the actions in the server's `allowedActions`; receipt with per-line received and damaged quantities.
* **Transfer history**: received, rejected and cancelled transfers with their timelines.
* **Analytics**: distribution, regional availability (recursive rollup, filterable by medicine), expiry outlook, shortage risk, recurring shortages, wastage, transfer volume, timing and completion, stock movement, top consumed last month with month-over-month change, stock by category, transfer status and demand basis. Every chart has a table view, and the synthetic-data banner comes from `meta.synthetic`.
* **Users**: create with organisation and facility roles, activate or deactivate, grant or revoke.
* **Audit log**: append-only entries with before/after values.
* **Notifications**: bell in the top bar with unread count and mark-as-read.

## Documentation

* [`docs/FRONTEND_ARCHITECTURE.md`](docs/FRONTEND_ARCHITECTURE.md): structure, state, routing, testing
* [`docs/UI_COMPONENTS.md`](docs/UI_COMPONENTS.md): design tokens and component reference
* [`docs/API_INTEGRATION.md`](docs/API_INTEGRATION.md): how the frontend uses the API (auth, scope, idempotency, errors, endpoint map)
