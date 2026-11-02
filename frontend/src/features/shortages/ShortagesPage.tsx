import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import type { Shortage, ShortageSeverity } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { useFacilityScope } from '@/auth/FacilityScope';
import { can } from '@/auth/permissions';
import { Button, Card, DataTable, FilterSelect, PageHeader, Pagination, SearchInput, Segmented, SeverityBadge, StockBar, Toolbar, type Column } from '@/components/ui';
import { useFacilities, useShortages } from '@/hooks/queries';
import { useListParams } from '@/hooks/useListParams';
import { fmtNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { RequestTransferModal, type TransferPrefill } from '../transfers/RequestTransferModal';

const FILTERS = ['facility', 'severity'] as const;

export default function ShortagesPage() {
  const user = useCurrentUser();
  const scope = useFacilityScope();
  const lp = useListParams(FILTERS, { sortBy: 'daysRemaining' });
  const facilities = useFacilities();
  const facilityId = lp.filters.facility ?? scope.facilityId;
  const severity = lp.filters.severity as ShortageSeverity | undefined;

  const q = useShortages({ ...lp.query, facilityId, severity });
  // Lightweight count queries for the tab badges.
  const critical = useShortages({ facilityId, severity: 'CRITICAL', pageSize: 1, search: lp.query.search });
  const low = useShortages({ facilityId, severity: 'LOW', pageSize: 1, search: lp.query.search });
  const [transfer, setTransfer] = useState<TransferPrefill | null>(null);

  const columns: Column<Shortage>[] = [
    {
      key: 'medicine',
      header: 'Medicine',
      sortKey: 'medicine',
      cell: (s) => (
        <div>
          <Link to={`/medicines/${s.medicine.id}`} className="font-medium text-ink-900 hover:underline">
            {s.medicine.name} <span className="font-normal text-ink-500">{s.medicine.strength}</span>
          </Link>
          <p className="text-xs text-ink-500">{s.medicine.category}</p>
        </div>
      ),
    },
    { key: 'facility', header: 'Facility', sortKey: 'facility', cell: (s) => <span className="text-ink-700">{s.facility.name}</span> },
    { key: 'severity', header: 'Severity', cell: (s) => <SeverityBadge severity={s.severity} /> },
    {
      key: 'level',
      header: 'Stock vs thresholds',
      sortKey: 'coverage',
      hideOnMobile: true,
      cell: (s) => (
        <div className="w-44">
          <StockBar current={s.currentStock} critical={s.criticalThreshold} reorder={s.reorderThreshold} />
          <p className="tabular mt-1 text-[11px] text-ink-500">
            <span className="font-medium text-ink-800">{fmtNumber(s.currentStock)}</span> · critical {fmtNumber(s.criticalThreshold)} · reorder {fmtNumber(s.reorderThreshold)}
          </p>
        </div>
      ),
    },
    { key: 'usage', header: 'Avg. daily use', align: 'right', hideOnMobile: true, cell: (s) => <span className="tabular text-ink-600">{fmtNumber(s.avgDailyConsumption)}</span> },
    {
      key: 'days',
      header: 'Days left',
      sortKey: 'daysRemaining',
      align: 'right',
      cell: (s) => (
        <span className={cn('tabular font-semibold', s.daysRemaining !== null && s.daysRemaining <= 7 ? 'text-danger-600' : 'text-ink-900')}>
          {s.daysRemaining === null ? <span title="No consumption recorded in the last 30 days">—</span> : s.daysRemaining}
        </span>
      ),
    },
    {
      key: 'act',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (s) =>
        can(user, 'transfer:request') && (
          <Button
            variant="secondary"
            size="sm"
            icon={<Search className="size-3.5" />}
            onClick={() => setTransfer({ medicine: s.medicine, destinationFacilityId: s.facility.id, quantity: Math.max(1, s.reorderThreshold - s.currentStock) })}
          >
            Source stock
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Shortage monitoring"
        description="Medicine–facility pairs below reorder level. Days left = usable stock ÷ 30-day average daily consumption."
        actions={
          <Link to="/redistribution" className="text-sm font-medium text-brand-700 hover:underline">
            View redistribution suggestions →
          </Link>
        }
      />
      <Card>
        <Toolbar onClear={lp.clearFilters} showClear={lp.hasActiveFilters}>
          <Segmented<'' | ShortageSeverity>
            value={severity ?? ''}
            onChange={(v) => lp.setFilter('severity', v || undefined)}
            options={[
              { value: '', label: 'All', count: critical.data && low.data ? critical.data.meta.total + low.data.meta.total : undefined },
              { value: 'CRITICAL', label: 'Critical', count: critical.data?.meta.total, tone: 'danger' },
              { value: 'LOW', label: 'Low stock', count: low.data?.meta.total, tone: 'warning' },
            ]}
          />
          <SearchInput value={lp.search} onChange={lp.setSearch} placeholder="Search medicine, category…" />
          <FilterSelect
            label="Facility"
            allLabel={scope.facilityId ? 'Current scope' : 'All'}
            value={lp.filters.facility}
            onChange={(v) => lp.setFilter('facility', v)}
            options={(facilities.data ?? []).filter((f) => f.type !== 'WAREHOUSE').map((f) => ({ value: f.id, label: f.name }))}
          />
        </Toolbar>
        <DataTable
          caption="Shortages"
          columns={columns}
          rows={q.data?.data}
          rowKey={(s) => s.id}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          sortBy={lp.sortBy}
          sortDir={lp.sortDir}
          onSortChange={lp.setSort}
          rowClassName={(s) => (s.severity === 'CRITICAL' ? 'bg-danger-50/30' : undefined)}
          empty={{ title: 'No shortages', description: 'All medicines in this view are at or above their reorder level.' }}
        />
        <Pagination meta={q.data?.meta} onPageChange={lp.setPage} onPageSizeChange={lp.setPageSize} />
      </Card>
      <RequestTransferModal open={!!transfer} onClose={() => setTransfer(null)} prefill={transfer ?? undefined} />
    </>
  );
}
