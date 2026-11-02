import type { AuditEntity, AuditLog } from '@/api/types';
import { Badge, Card, DataTable, FilterSelect, Input, PageHeader, Pagination, SearchInput, Toolbar, type Column, type Tone } from '@/components/ui';
import { useAuditLogs } from '@/hooks/queries';
import { useListParams } from '@/hooks/useListParams';
import { fmtDateTime, titleCase } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/labels';

const FILTERS = ['entity', 'from', 'to'] as const;
const ENTITIES: AuditEntity[] = ['TRANSFER', 'BATCH', 'MEDICINE', 'FACILITY', 'USER', 'AUTH'];

const actionTone = (action: string): Tone => {
  if (/REJECT|DAMAGE|WRITTEN_OFF|CANCEL/.test(action)) return 'danger';
  if (/APPROVE|RECEIVED|CREATED|REGISTERED/.test(action)) return 'success';
  if (/REQUEST|DISPATCH/.test(action)) return 'info';
  return 'neutral';
};

export default function AuditPage() {
  const lp = useListParams(FILTERS, { sortBy: 'timestamp', sortDir: 'desc', pageSize: 20 });
  const q = useAuditLogs({ ...lp.query, entityType: lp.filters.entity as AuditEntity | undefined, from: lp.filters.from, to: lp.filters.to });
  const rangeError = lp.filters.from && lp.filters.to && lp.filters.from > lp.filters.to ? 'Start date is after end date' : null;

  const columns: Column<AuditLog>[] = [
    { key: 'ts', header: 'Timestamp', sortKey: 'timestamp', cell: (l) => <span className="tabular text-xs whitespace-nowrap text-ink-600">{fmtDateTime(l.timestamp)}</span> },
    {
      key: 'user',
      header: 'User',
      sortKey: 'user',
      cell: (l) => (
        <div>
          <p className="text-ink-900">{l.user.name}</p>
          <p className="text-xs text-ink-500">{ROLE_LABEL[l.user.role]}</p>
        </div>
      ),
    },
    { key: 'action', header: 'Action', sortKey: 'action', cell: (l) => <Badge tone={actionTone(l.action)}>{titleCase(l.action)}</Badge> },
    {
      key: 'entity',
      header: 'Entity',
      sortKey: 'entityType',
      hideOnMobile: true,
      cell: (l) => (
        <div className="text-xs">
          <p className="font-medium text-ink-700">{titleCase(l.entityType)}</p>
          <p className="tabular text-ink-400">{l.entityId ?? '—'}</p>
        </div>
      ),
    },
    { key: 'desc', header: 'Details', cell: (l) => <span className="text-xs text-ink-700">{l.description}</span> },
    { key: 'facility', header: 'Facility', hideOnMobile: true, cell: (l) => <span className="text-xs text-ink-500">{l.facility?.code ?? '—'}</span> },
  ];

  return (
    <>
      <PageHeader title="Audit log" description="Immutable record of user actions across MedShare. Visible to administrators only." />
      <Card>
        <Toolbar onClear={lp.clearFilters} showClear={lp.hasActiveFilters}>
          <SearchInput value={lp.search} onChange={lp.setSearch} placeholder="Search user, action, details…" />
          <FilterSelect label="Entity" value={lp.filters.entity} onChange={(v) => lp.setFilter('entity', v)} options={ENTITIES.map((e) => ({ value: e, label: titleCase(e) }))} />
          <label className="flex items-center gap-1.5 text-xs text-ink-600">
            From
            <Input type="date" className="w-36" value={lp.filters.from ?? ''} onChange={(e) => lp.setFilter('from', e.target.value || undefined)} invalid={!!rangeError} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-ink-600">
            To
            <Input type="date" className="w-36" value={lp.filters.to ?? ''} onChange={(e) => lp.setFilter('to', e.target.value || undefined)} invalid={!!rangeError} />
          </label>
          {rangeError && (
            <p role="alert" className="text-xs text-danger-600">
              {rangeError}
            </p>
          )}
        </Toolbar>
        <DataTable
          caption="Audit log"
          columns={columns}
          rows={rangeError ? [] : q.data?.data}
          rowKey={(l) => l.id}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          sortBy={lp.sortBy}
          sortDir={lp.sortDir}
          onSortChange={lp.setSort}
          empty={{ title: 'No audit entries match these filters' }}
        />
        {!rangeError && <Pagination meta={q.data?.meta} onPageChange={lp.setPage} onPageSizeChange={lp.setPageSize} />}
      </Card>
    </>
  );
}
