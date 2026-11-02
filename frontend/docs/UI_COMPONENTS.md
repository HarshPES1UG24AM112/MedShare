# UI Components

Design-system primitives live in `src/components/ui` and are exported from `@/components/ui`.

## Design tokens (`src/index.css`, Tailwind `@theme`)

| Token group | Use |
|---|---|
| `ink-950 … ink-300` | Deep-navy text, sidebar chrome, primary buttons |
| `canvas`, `surface`, `subtle`, `line`, `line-strong` | Page background, cards, muted fills, borders |
| `brand-50 … brand-700` | Restrained clinical green: positive state, focus rings, links |
| `danger-*`, `warning-*`, `info-*` | **Meaning only**: critical/expired, low/expiring, informational |
| `shadow-card`, `shadow-pop` | Minimal elevation for cards, and stronger elevation for menus and dialogs |

Typography is Inter at a 14 px base, with `tabular` (tabular numerals) on every number column. Light theme only, as the brief specifies.

## Primitives

| Component | Purpose | Notes |
|---|---|---|
| `Button` | Actions | `variant`: primary · secondary · ghost · danger · subtle; `size`: sm · md; `loading` shows a spinner and disables; `icon` |
| `Card`, `CardHeader`, `CardBody` | Surfaces | `CardHeader` takes `title`, `description`, `actions` |
| `Badge` | Status chips | `tone`: neutral · success · warning · danger · info · navy; `dot` |
| `TransferStatusBadge`, `SeverityBadge`, `ExpiryBadge`, `StockStatusBadge`, `BatchStatusBadge`, `DemandBasisBadge` | Domain badges | Consistent colour and label for each state; `DemandBasisBadge` adds a "Possibly censored" chip with an explanation |
| `Input`, `Select`, `Textarea` | Form controls | `invalid` sets the error border and `aria-invalid` |
| `FormField` | Label, control, error/hint | `required` adds an asterisk; error text uses `role="alert"` |
| `DataTable<T>` | Tables | Column defs with `cell`, optional `sortKey` (server sort), `align`, `hideOnMobile`; built-in skeleton, empty and error states; `onRowClick`; `rowClassName` |
| `Pagination` | Page controls | "Showing x–y of n", rows-per-page, prev/next |
| `Toolbar` | Filter row | Holds search and filters; optional "Clear filters" |
| `SearchInput` | Debounced (300 ms) search | Clear button |
| `FilterSelect` | Compact filter dropdown | Highlights when active; capped to its container width so long option labels never cause horizontal scroll |
| `Segmented` | Tabs or segmented control | Optional count pills with danger/warning tone |
| `Modal` | Dialog | Portal, focus moves inside, Esc and backdrop close, body scroll lock; bottom sheet on mobile |
| `Toast` / `useToast()` | Feedback | `success`, `error`, `info`; errors persist longer and use `role="alert"` |
| `StatCard` | KPI tile | `tone` default · danger · warning; `to` makes it a link into the filtered view |
| `StockBar` | Stock gauge | Fill against critical and reorder tick marks; `role="meter"` |
| `PageHeader` | Page title row | Breadcrumbs, description, actions |
| `EmptyState`, `ErrorState`, `Skeleton` | Async states | `ErrorState` distinguishes network, 403 and other errors and offers retry |

## Charts (`src/components/charts`)

| Component | Purpose |
|---|---|
| `ChartCard` | Wraps every chart: header, legend (2+ series), chart/table toggle, loading, empty and error states |
| `ChartTooltip` | Shared Recharts tooltip body |
| `MiniTable` | Table view for charts |
| `InventoryDistributionChart` | Stacked horizontal bars: available, reserved and damaged per facility |
| `ShortageRiskChart` | Critical vs low counts per medicine (status colours) |
| `ExpiryTrendChart` | Units expiring per month; past months faded |
| `MovementTrendChart` | Inbound, outbound and losses lines |
| `TransferVolumeChart` | Requested, received, and rejected or cancelled per month |
| `RegionAvailabilityChart` | Usable units per region, indented by depth (recursive rollup) |
| `RecurringShortageChart` | Facilities ranked by critical and low alerts |
| `WastageChart` | Value lost by cause (damage, disposal, expiry) |
| `TopConsumedChart` | Units consumed last month; the table shows the change from the previous month |
| `CategoryStockChart` | Units by therapeutic category |

Colour roles are in `charts/theme.ts`. The categorical order is validated for colour-vision deficiency, normal-vision separation and contrast on white. Slot 3 is below 3:1, which is why every chart has a visible legend and a table view.

## Layout (`src/components/layout`)

* `AppShell`: sidebar, top bar, and the `<main>` with the Suspense boundary for lazy pages; includes a skip link.
* `Sidebar`: grouped navigation with live counts (critical shortages, expiring, open recommendations and stock requests, pending transfers); permission-filtered; off-canvas below `lg`.
* `Topbar`: facility selector over `Me.scopeFacilityIds` (a pinned label when there is only one), the notifications bell (unread count, mark read, links to the related transfer), and the user menu listing every role grant.

## Feature-level shared components

* `features/transfers/RequestTransferModal`: multi-item request in **pull** mode (into your facility, sources from `/medicines/:id/sources`) or **push** mode (out of your facility, from `/inventory`). Every line shares one source facility, and lines can link to stock-request items. It takes a `TransferPrefill` (mode, facilities, medicine, quantity, stock-request item, or an inventory row to push).
* `features/transfers/TransferDetailModal`: stepper, required stages and approvals, items with source availability and receipt, the LAG timeline with time in each state, and actions from `allowedActions` with a confirm step (a reason is required for reject and cancel; per-line received and damaged quantities for receipt).
* `features/transfers/TransferList`: shared table for active transfers and history.
* `features/inventory/BatchModals`: `ReceiveStockModal`, `StockActionModal` (dispense, damage, dispose, write-off, adjust), `StockHistoryModal`, and the shared ledger columns.

## Conventions

* Every button does something. There are no placeholder controls.
* Every mutation shows a success or error toast; server messages are shown verbatim.
* Numbers are right-aligned with `tabular`; dates use `fmtDate` / `fmtDateTime`.
* Colour is never the only signal: badges carry text and charts carry legends and tables.
