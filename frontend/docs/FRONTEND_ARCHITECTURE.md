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
│   │   │   └── http.ts       # the REST implementation (Idempotency-Key on writes)
│   │   └── index.ts          # exports `api` (replaced with vi.mock in tests)
│   ├── auth/
│   │   ├── AuthContext.tsx   # session state (Me), login/logout, restores on reload
│   │   ├── tokenStore.ts     # guarded localStorage access
│   │   ├── ProtectedRoute.tsx# route guard + RequirePermission page guard
│   │   ├── permissions.ts    # can / canAt / facilitiesWith over Me.permissions and facilityPermissions
│   │   └── FacilityScope.tsx # selector over Me.scopeFacilityIds; "All" = whole scope
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

### 1. One API seam
`MedShareApi` (in `api/services/types.ts`) is the only API surface hooks use, implemented by `httpApi`. Types in `api/types.ts` mirror `API_CONTRACT.md` exactly (integer ids, camelCase, `{ data, meta }` pages). Component tests replace `@/api` with `vi.mock` instead of shipping a fake backend. See `API_INTEGRATION.md`.

### 2. Server state lives in TanStack Query, and only there
There's no Redux or Zustand. Server data is cached by query key (`qk` in `hooks/queries.ts`), and mutations invalidate whole key roots, so every stock-derived view refreshes after a stock change: dashboard, alerts, analytics, redistribution, transfers and audit. Invalidation runs in the background, so success toasts appear immediately. Lists use `keepPreviousData` so paging doesn't flash a skeleton.

The only client state is the session (`AuthContext`), the facility scope (`FacilityScope`), and per-page UI state such as which modal is open.

### 3. URL is the state for lists
`useListParams` stores page, page size, sort, search and filters in the query string. Filtered views therefore survive a reload, can be shared as links, and work with the browser's back button. The dashboard links straight into filtered views (for example `/shortages?severity=CRITICAL` or `/expiry?window=expired`). An open transfer is `?open=<id>`.

### 4. Facility scope
The top bar lists the facilities in `Me.scopeFacilityIds` plus "All" (the whole scope, applied by the server). Users with one facility are pinned to it. The choice persists in `localStorage` and is ignored if it falls outside the current user's scope. Pages read `useFacilityScope().facilityId` as their default filter, and a page-level facility filter in the URL overrides it.

### 5. Permissions are presentation-only
`auth/permissions.ts` decides which controls to **show**, from `Me.permissions` (anywhere) and `Me.facilityPermissions` (per facility). Transfer workflow buttons come from the server's `allowedActions`, never from client rules. The database re-checks every write; every mutation handles 403, and `ErrorState` renders "Access restricted" for 403 reads. Pages that need a permission render `Forbidden` on a direct URL visit instead of failing silently.

### 6. Every async surface handles four states
Loading (skeletons shaped like the content), empty (an explanation plus a next step where useful), error (retry button; network, permission and server errors are told apart), and success. `DataTable`, `ChartCard` and the dashboard panels implement this once, so pages get it for free.

### 7. Forms
React Hook Form with a Zod schema per form. Client-side rules mirror the server's: expiry after manufacture, quantities no more than available, reasons where the ledger requires one, received + damaged = dispatched per transfer line, password policy. The database remains the authority. Server `error.details` are mapped back onto fields with `setError`. Fields locked by role are rendered as read-only text plus a hidden input, because a natively disabled input can drop its value on submit.

### 8. Code splitting
Pages are `React.lazy` route chunks, and the Suspense boundary sits inside the shell, so navigation keeps the sidebar and top bar on screen. Vendor code is split into `react`, `query`, `charts` and `forms` chunks.

### 9. Data visualisation
All charts share `ChartCard`, which provides the legend, a chart/table toggle (the table is the accessible and exact-value view), and loading, empty and error states. Categorical colours use a fixed validated order (`charts/theme.ts`). Status colours (red and amber) are reserved for severity and always paired with labels. There are no dual axes, and the current partial month is labelled as month-to-date. Chart animation is disabled.

## Routing

| Path | Page | Notes |
|---|---|---|
| `/login` | Sign-in | Demo accounts only in DEV builds; redirects to `/` if signed in |
| `/` | Dashboard | Scoped by the facility selector |
| `/analytics` | Charts | `report:read` |
| `/medicines`, `/medicines/:id` | Catalogue, detail | "Add medicine" with `catalogue:manage`; "Request stock" with `transfer:request` |
| `/batches` | Network lots | `?open=id`; status changes with `batch:manage` |
| `/inventory` | Stock rows | Receive, row actions, history, push transfer |
| `/inventory/movements` | Ledger | |
| `/facilities`, `/facilities/:id` | Directory, detail | Summary, shortages and stock policy only when `inScope` |
| `/shortages` | Shortage monitor | Acknowledge, "Source stock" |
| `/expiry` | Expiry monitor | Acknowledge, write-off, redistribute |
| `/redistribution` | Recommendations | Accept → PENDING transfer; dismiss; "Run engine" for org/system admins |
| `/stock-requests` | Stock requests | Create, cancel, source a line |
| `/transfers` | Active transfers | "Needs my action" (`actionable=true`); `?open=id` |
| `/transfers/history` | Closed transfers | With timelines |
| `/users` | User management | `user:manage`; `?open=id` |
| `/audit` | Audit log | `audit:read` |

## Testing

`npm test` runs Vitest in jsdom.

* `auth/permissions.test.ts`: `can`, `canAt`, `facilitiesWith` and the "Run engine" rule over real `Me` shapes.
* `lib/format.test.ts`: date handling (local-date parsing, days to expiry).
* `features/auth/LoginPage.test.tsx`: validation, the server's error message, token storage and redirect, the DEV-only demo panel (API mocked with `vi.mock`).
* `features/transfers/TransferDetailModal.test.tsx`: buttons come only from `allowedActions` (including organisation-stage approval), rejection needs a reason, per-line receipt with damaged quantities, interval formatting.

End-to-end behaviour was also verified in a real browser against the running API.

## Responsiveness

The sidebar becomes an off-canvas drawer below `lg`. Tables scroll horizontally inside their card, and low-priority columns hide below `md` (`hideOnMobile`). Every route was checked at 375 px for zero horizontal page scroll.
