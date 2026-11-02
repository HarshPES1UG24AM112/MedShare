# Frontend Architecture

## Stack

React 18 · TypeScript (strict) · Vite 6 · Tailwind CSS 4 · React Router 6 · TanStack Query 5 · Axios · Recharts · Lucide · React Hook Form + Zod · Vitest + Testing Library.

## Directory layout

```
frontend/
├── src/
│   ├── api/
│   │   ├── types.ts          # domain + request/response types (the contract, in TypeScript)
│   │   ├── endpoints.ts      # every URL path
│   │   ├── client.ts         # Axios instance, bearer token, ApiError normalisation, 401 broadcast
│   │   ├── services/
│   │   │   ├── types.ts      # MedShareApi interface — the seam between UI and data
│   │   │   └── http.ts       # real implementation
│   │   ├── mock/             # SYNTHETIC data + mock implementation (dev only)
│   │   │   ├── seed.ts       # deterministic seeded generator
│   │   │   ├── derive.ts     # shortage / expiry / recommendation logic approximating the backend
│   │   │   ├── mockApi.ts    # MedShareApi over the in-memory DB, with RBAC + validation
│   │   │   └── demoAccounts.ts
│   │   └── index.ts          # picks mock vs http via VITE_USE_MOCKS
│   ├── auth/
│   │   ├── AuthContext.tsx   # session state, login/register/logout, restores on reload
│   │   ├── tokenStore.ts     # guarded localStorage access
│   │   ├── ProtectedRoute.tsx# route guard + RequirePermission page guard
│   │   ├── permissions.ts    # role → permission matrix, transfer action rules
│   │   └── FacilityScope.tsx # global facility selector state (admins switch; others pinned)
│   ├── hooks/
│   │   ├── queries.ts        # every useQuery/useMutation + query keys + invalidation
│   │   └── useListParams.ts  # page/sort/search/filters synced to the URL
│   ├── components/
│   │   ├── ui/               # design-system primitives (see UI_COMPONENTS.md)
│   │   ├── charts/           # ChartCard, chart theme, Recharts charts + table views
│   │   └── layout/           # AppShell, Sidebar, Topbar, Logo
│   ├── features/<module>/    # one folder per product area; route pages are default exports
│   ├── lib/                  # config, formatters, labels, queryClient, cn()
│   └── test/setup.ts
└── docs/
```

## Key decisions

### 1. One interface, two implementations
`MedShareApi` (in `api/services/types.ts`) is the only API surface the UI knows about. `mockApi` and `httpApi` both implement it, and the compiler enforces that they match. Switching to the real backend is an environment variable, not a refactor. Mock code is never imported outside `api/`, with one exception: the login page imports the static demo-account list, and only renders it in mock mode.

### 2. Server state lives in TanStack Query, and only there
There's no Redux or Zustand. Server data is cached by query key (`qk` in `hooks/queries.ts`), and mutations invalidate whole key roots, so every stock-derived view refreshes after a stock change: dashboard, alerts, analytics, redistribution, transfers and audit. Invalidation runs in the background, so success toasts appear immediately. Lists use `keepPreviousData` so paging doesn't flash a skeleton.

The only client state is the session (`AuthContext`), the facility scope (`FacilityScope`), and per-page UI state such as which modal is open.

### 3. URL is the state for lists
`useListParams` stores page, page size, sort, search and filters in the query string. Filtered views therefore survive a reload, can be shared as links, and work with the browser's back button. The dashboard links straight into filtered views (for example `/shortages?severity=CRITICAL` or `/expiry?window=expired`). An open transfer is `?open=<id>`.

### 4. Facility scope
Admins pick a facility (or "All") in the top bar, and the choice persists in `localStorage`. Everyone else is pinned to `user.facilityId`. Pages read `useFacilityScope().facilityId` as their default filter, and a page-level facility filter in the URL overrides it.

### 5. Permissions are presentation-only
`auth/permissions.ts` decides which controls to **show**. The backend remains authoritative: every mutation still handles 403, and `ErrorState` renders "Access restricted" for 403 responses on reads. `RequirePermission` guards whole pages (the Audit log), so a direct URL visit explains the restriction instead of failing silently.

### 6. Every async surface handles four states
Loading (skeletons shaped like the content), empty (an explanation plus a next step where useful), error (retry button; network, permission and server errors are told apart), and success. `DataTable`, `ChartCard` and the dashboard panels implement this once, so pages get it for free.

### 7. Forms
React Hook Form with a Zod schema per form. Client-side rules mirror the business rules: critical below reorder, expiry after manufacture and in the future, quantity no more than available, rejection reason required. Server `error.details` are mapped back onto fields with `setError`. Fields locked by role are rendered as read-only text plus a hidden input, because a natively disabled input can drop its value on submit.

### 8. Code splitting
Pages are `React.lazy` route chunks, and the Suspense boundary sits inside the shell, so navigation keeps the sidebar and top bar on screen. Vendor code is split into `react`, `query`, `charts` and `forms` chunks.

### 9. Data visualisation
All charts share `ChartCard`, which provides the legend, a chart/table toggle (the table is the accessible and exact-value view), and loading, empty and error states. Categorical colours use a fixed validated order (`charts/theme.ts`). Status colours (red and amber) are reserved for severity and always paired with labels. There are no dual axes, and the current partial month is labelled as month-to-date. Chart animation is disabled.

## Routing

| Path | Page | Notes |
|---|---|---|
| `/login`, `/register` | Auth | Redirect to `/` if already signed in |
| `/` | Dashboard | Scoped by facility selector |
| `/medicines`, `/medicines/:id` | Catalogue, detail | "Add medicine" for ADMIN and FACILITY_MANAGER |
| `/inventory` | Batches | Receive, adjust, history, transfer |
| `/inventory/movements` | Movement ledger | |
| `/facilities`, `/facilities/:id` | Directory, detail | |
| `/shortages` | Shortage monitor | "Source stock" opens a transfer request |
| `/expiry` | Expiry monitor | Redistribute or write off |
| `/redistribution` | Recommendations | Accept a recommendation to prefill a transfer request |
| `/transfers` | Transfer management | Workflow dialog, `?open=id` |
| `/analytics` | Charts | |
| `/audit` | Audit log | ADMIN only |

## Testing

`npm test` runs Vitest in jsdom.

* `auth/permissions.test.ts` covers the role matrix and transfer action rules.
* `lib/format.test.ts` covers date handling (local-date parsing, days to expiry).
* `api/mock/mockApi.test.ts` covers transfer stock accounting, state machine, RBAC and alert classification. These are also the expectations to verify against Agent 1's API.
* `features/auth/LoginPage.test.tsx` covers form validation, the server error and redirect on success.

## Responsiveness

The sidebar becomes an off-canvas drawer below `lg`. Tables scroll horizontally inside their card, and low-priority columns hide below `md` (`hideOnMobile`). Every route was checked at 375 px for zero horizontal page scroll.
