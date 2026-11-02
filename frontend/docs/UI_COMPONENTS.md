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
| `TransferStatusBadge`, `SeverityBadge`, `ExpiryBadge` | Domain badges | Consistent colour and label for each state |
| `Input`, `Select`, `Textarea` | Form controls | `invalid` sets the error border and `aria-invalid` |
| `FormField` | Label, control, error/hint | `required` adds an asterisk; error text uses `role="alert"` |
| `DataTable<T>` | Tables | Column defs with `cell`, optional `sortKey` (server sort), `align`, `hideOnMobile`; built-in skeleton, empty and error states; `onRowClick`; `rowClassName` |
| `Pagination` | Page controls | "Showing x–y of n", rows-per-page, prev/next |
| `Toolbar` | Filter row | Holds search and filters; optional "Clear filters" |
| `SearchInput` | Debounced (300 ms) search | Clear button |
| `FilterSelect` | Compact filter dropdown | Highlights when active |
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
| `TransferVolumeChart` | Requested, received and rejected per month |
| `CategoryStockChart` | Units by therapeutic category |

Colour roles are in `charts/theme.ts`. The categorical order is validated for colour-vision deficiency, normal-vision separation and contrast on white. Slot 3 is below 3:1, which is why every chart has a visible legend and a table view.

## Layout (`src/components/layout`)

* `AppShell`: sidebar, top bar, and the `<main>` with the Suspense boundary for lazy pages; includes a skip link.
* `Sidebar`: grouped navigation with live counts (critical shortages, expiring, pending transfers); role-filtered; off-canvas below `lg`.
* `Topbar`: facility selector (admins), a pinned facility label (others), the "Demo data" badge in mock mode, and the user menu with sign-out.

## Feature-level shared components

* `features/transfers/RequestTransferModal`: one dialog used from Redistribution, Shortages, Expiry, Inventory and Medicine detail. It accepts a `TransferPrefill` (medicine, batch, destination, quantity, recommendation).
* `features/transfers/TransferDetailModal`: progress stepper, activity timeline, and role-aware workflow actions with a confirm step (a reason is required for reject).
* `features/inventory/BatchModals`: `ReceiveBatchModal`, `AdjustStockModal` (dispense, damage, correction, write-off) and `BatchHistoryModal`.

## Conventions

* Every button does something. There are no placeholder controls.
* Every mutation shows a success or error toast; server messages are shown verbatim.
* Numbers are right-aligned with `tabular`; dates use `fmtDate` / `fmtDateTime`.
* Colour is never the only signal: badges carry text and charts carry legends and tables.
