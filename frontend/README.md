# MedShare — Frontend

React + TypeScript frontend for **MedShare**, a medicine inventory coordination platform for healthcare facilities. It covers monitoring stock, shortages and expiry, acting on redistribution recommendations, and running inter-facility transfers from request to receipt.

> Built by Agent 2 (frontend). The backend, database and `API_CONTRACT.md` are owned by Agent 1.

## Quick start

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173 — uses mock services by default
```

### Demo accounts (mock mode only)

The sign-in page lists these accounts and fills them in with one click. They exist only in the in-browser mock.

| Role | Email | Scope |
|---|---|---|
| Administrator | `admin@medshare.health` | All facilities, audit log, facility switcher |
| Facility manager | `manager@medshare.health` | Central District Hospital; approves outgoing transfers |
| Pharmacist | `pharmacist@medshare.health` | Hoskote PHC; requests, dispatches, receives |
| Viewer | `viewer@medshare.health` | Whitefield CHC, read-only |

Password for all of them: `MedShare@2026` (stored in `src/api/mock/demoAccounts.ts`).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with mock services |
| `npm run dev:api` | Dev server against the real backend (`.env.api`, proxied to `VITE_PROXY_TARGET`) |
| `npm run build` | Type-check and production build |
| `npm run typecheck` | TypeScript only |
| `npm test` | Vitest unit and component tests |

## Configuration

Copy `.env.example` to `.env.local`:

| Variable | Default | Meaning |
|---|---|---|
| `VITE_USE_MOCKS` | `true` | `false` sends every call to the real API |
| `VITE_API_BASE_URL` | `/api/v1` | API base path |
| `VITE_PROXY_TARGET` | `http://localhost:4000` | Where the dev server proxies `/api` |
| `VITE_MOCK_LATENCY_MS` | `350` | Simulated latency, so loading states are visible |

## Mock data

`src/api/mock` generates a **synthetic** network of 10 facilities, 32 essential medicines, batches, six months of movements, transfers and audit entries. Generation is deterministic and relative to today's date, so expiry windows always look current. The data is clearly labelled in the UI (a "Demo data" badge and a banner on Analytics). Mutations made in mock mode, such as transfers or receipts, update every derived view and persist until the page reloads.

## Features

* **Dashboard**: action banner for critical issues, KPI tiles that link into filtered views, shortage and expiry alerts, inventory distribution, recent transfers and movements.
* **Medicine catalogue**: search, filters, sorting and pagination; detail page with stock by facility and batches; add-medicine form.
* **Stock & batches**: available, reserved and damaged quantities; receive stock; dispense, damage, correction and write-off adjustments; per-batch history.
* **Stock movements**: full signed ledger.
* **Facilities**: directory and detail with location, contact, KPIs and facility shortages.
* **Shortages**: critical and low tabs, stock-vs-threshold gauges, days remaining, and a "Source stock" action.
* **Expiry**: expired, ≤ 7, ≤ 30 and ≤ 60 day tabs, value at risk, redistribute or write off.
* **Redistribution**: prioritised recommendations with route, distance, batch, expiry and reason; one click prefills a transfer request.
* **Transfers**: status tabs, incoming/outgoing filter, a workflow dialog with stepper and timeline, and role-aware approve, reject, dispatch, receive and cancel actions.
* **Analytics**: distribution, shortage risk, expiry profile, monthly movements, transfer volume and completion, stock by category. Every chart has a table view.
* **Audit log** (admins): user, action, entity and timestamp, with filters and a date range.

## Documentation

* [`docs/FRONTEND_ARCHITECTURE.md`](docs/FRONTEND_ARCHITECTURE.md): structure, state, routing, testing
* [`docs/UI_COMPONENTS.md`](docs/UI_COMPONENTS.md): design tokens and component reference
* [`docs/API_INTEGRATION.md`](docs/API_INTEGRATION.md): the endpoints the frontend expects, open questions for Agent 1, and the integration checklist

## Integration status

**Phase 8 (backend integration) is blocked.** `API_CONTRACT.md` doesn't exist yet. The frontend's expected contract is written up in `docs/API_INTEGRATION.md` for Agent 1 to confirm or correct.
