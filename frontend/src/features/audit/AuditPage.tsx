import { useState } from 'react';
import type { AuditLog } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { useFacilityScope } from '@/auth/FacilityScope';
import { Forbidden } from '@/auth/ProtectedRoute';
import { Badge, Card, DataTable, FilterSelect, Input, Modal, PageHeader, Pagination, SearchInput, Toolbar, type Column, type Tone } from '@/components/ui';
import { useAuditLogs } from '@/hooks/queries';
import { useListParams } from '@/hooks/useListParams';
import { fmtDateTime, titleCase } from '@/lib/format';

const FILTERS = ['entityType', 'action', 'entityId', 'from', 'to'] as const;
const ENTITIES = ['INVENTORY', 'TRANSFER', 'STOCK_REQUEST', 'BATCH', 'MEDICINE', 'FACILITY', 'FACILITY_SETTINGS', 'USER', 'AUTH', 'RECOMMENDATION', 'SHORTAGE_ALERT', 'EXPIRY_ALERT', 'SYSTEM'];

const actionTone = (action: string): Tone => {
  if (/REJECT|DAMAGE|WRITE_OFF|DISPOSAL|CANCEL|DEACTIVAT|REVOKE/.test(action)) return 'danger';
  if (/APPROVE|RECEIVED|RECEIPT|CREATED|TRANSFER_IN|GRANT/.test(action)) return 'success';
  if (/REQUEST|DISPATCH|RESERVE|TRANSFER_OUT/.test(action)) return 'info';
  return 'neutral';
};

function Json({ value }: { value: Record<string, unknown> | null }) {
  if (!value) return <p className="text-xs text-ink-400">—</p>;
  return <pre className="scrollbar-thin max-h-64 overflow-auto rounded-md bg-subtle p-3 text-[11px] leading-relaxed text-ink-800">{JSON.stringify(value, null, 2)}</pre>;
}

export default function AuditPage() {
  const user = useCurrentUser();
  const scope = useFacilityScope();
  const lp = useListParams(FILTERS, { sortBy: 'occurredAt', sortDir: 'desc', pageSize: 20 });
  const rangeError = lp.filters.from && lp.filters.to && lp.filters.from > lp.filters.to ? 'Start date is after end date' : null;
  const q = useAuditLogs({
    ...lp.query,
    facilityId: scope.facilityId,
    entityType: lp.filters.entityType,
    entityId: lp.filters.entityId,
    action: lp.filters.action ? lp.filters.action.trim().toUpperCase().replace(/[^A-Z_]/g, '_') : undefined,
    from: rangeError ? undefined : lp.filters.from,
    to: rangeError ? undefined : lp.filters.to,
  });
  const [open, setOpen] = useState<AuditLog | null>(null);

  if (!user.permissions.includes('audit:read')) return <Forbidden />;

  const columns: Column<AuditLog>[] = [
    { key: 'ts', header: 'When', sortKey: 'occurredAt', cell: (l) => <span className="tabular text-xs whitespace-nowrap text-ink-600">{fmtDateTime(l.occurredAt)}</span> },
    {
      key: 'actor',
      header: 'Actor',
      cell: (l) =>
        l.actor ? (
          <div className="min-w-0">
            <p className="text-ink-900">{l.actor.name}</p>
            <p className="truncate text-xs text-ink-500">{l.actor.email}</p>
          </div>
        ) : (
          <span className="text-xs text-ink-500">System</span>
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
          <p className="tabular text-ink-400">#{l.entityId ?? '—'}</p>
        </div>
      ),
    },
    { key: 'facility', header: 'Facility', hideOnMobile: true, cell: (l) => <span className="text-xs text-ink-500">{l.facility?.code ?? '—'}</span> },
  ];

  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of every change. Entries cannot be edited or deleted, by the application or its database role." />
      <Card>
        <Toolbar onClear={lp.clearFilters} showClear={lp.hasActiveFilters}>
          <SearchInput value={lp.search} onChange={lp.setSearch} placeholder="Search action, actor, details…" />
          <FilterSelect label="Entity" value={lp.filters.entityType} onChange={(v) => lp.setFilter('entityType', v)} options={ENTITIES.map((e) => ({ value: e, label: titleCase(e) }))} />
          <Input aria-label="Action code" placeholder="Action, e.g. TRANSFER_APPROVED" className="w-56" value={lp.filters.action ?? ''} onChange={(e) => lp.setFilter('action', e.target.value || undefined)} />
          <Input aria-label="Entity id" placeholder="Entity id" className="w-28" value={lp.filters.entityId ?? ''} onChange={(e) => lp.setFilter('entityId', e.target.value || undefined)} />
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
          rows={q.data?.data}
          rowKey={(l) => String(l.id)}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          sortBy={lp.sortBy}
          sortDir={lp.sortDir}
          onSortChange={lp.setSort}
          onRowClick={setOpen}
          empty={{ title: 'No audit entries match these filters' }}
        />
        <Pagination meta={q.data?.meta} onPageChange={lp.setPage} onPageSizeChange={lp.setPageSize} />
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} size="lg" title={open ? titleCase(open.action) : ''} description={open && `${fmtDateTime(open.occurredAt)} · ${titleCase(open.entityType)} #${open.entityId ?? '—'}`}>
        {open && (
          <div className="space-y-4 text-sm">
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-ink-500">Actor</dt>
                <dd className="text-ink-900">{open.actor ? `${open.actor.name} (${open.actor.email})` : 'System'}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-500">Facility</dt>
                <dd className="text-ink-900">{open.facility ? `${open.facility.code} · ${open.facility.name}` : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-500">Request id</dt>
                <dd className="tabular text-xs break-all text-ink-700">{open.requestId ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-500">IP address</dt>
                <dd className="tabular text-xs text-ink-700">{open.ipAddress ?? '—'}</dd>
              </div>
            </dl>
            <div>
              <p className="mb-1 text-xs font-medium text-ink-500">Before</p>
              <Json value={open.oldValues} />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-ink-500">After</p>
              <Json value={open.newValues} />
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
