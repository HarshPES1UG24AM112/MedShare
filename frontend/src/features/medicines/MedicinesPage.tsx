import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Snowflake } from 'lucide-react';
import type { DosageForm, Medicine } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import { Badge, Button, Card, DataTable, FilterSelect, PageHeader, Pagination, SearchInput, Toolbar, type Column } from '@/components/ui';
import { useCategories, useManufacturers, useMedicines } from '@/hooks/queries';
import { toId, useListParams } from '@/hooks/useListParams';
import { fmtDate, fmtNumber } from '@/lib/format';
import { DOSAGE_FORM_LABEL, options } from '@/lib/labels';
import { AddMedicineModal } from './AddMedicineModal';

const FILTERS = ['categoryId', 'form', 'essential', 'coldChain', 'manufacturerId'] as const;

export default function MedicinesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const lp = useListParams(FILTERS, { sortBy: 'name' });
  const { data: categories } = useCategories();
  const { data: manufacturers } = useManufacturers();
  const q = useMedicines({
    ...lp.query,
    categoryId: toId(lp.filters.categoryId),
    dosageForm: lp.filters.form as DosageForm | undefined,
    essential: lp.filters.essential === 'true' ? 'true' : undefined,
    coldChain: lp.filters.coldChain === 'true' ? 'true' : undefined,
    manufacturerId: toId(lp.filters.manufacturerId),
  });

  const columns: Column<Medicine>[] = [
    { key: 'code', header: 'Code', sortKey: 'code', cell: (m) => <span className="tabular text-xs text-ink-500">{m.code}</span>, hideOnMobile: true },
    {
      key: 'name',
      header: 'Medicine',
      sortKey: 'name',
      cell: (m) => (
        <div className="min-w-0">
          <p className="font-medium text-ink-900">
            {m.name} <span className="font-normal text-ink-500">{m.strengthLabel}</span>
            {m.requiresColdChain && <Snowflake className="ml-1 inline size-3.5 text-info-500" aria-label="Cold chain" />}
          </p>
          {m.substances !== m.name && <p className="text-xs text-ink-500">{m.substances}</p>}
        </div>
      ),
    },
    { key: 'category', header: 'Category', sortKey: 'category', cell: (m) => <span className="text-ink-700" title={m.categoryPath}>{m.category}</span> },
    { key: 'form', header: 'Form', sortKey: 'form', cell: (m) => <span className="text-ink-700">{DOSAGE_FORM_LABEL[m.dosageForm]}</span>, hideOnMobile: true },
    {
      key: 'networkUsable',
      header: 'Network usable',
      sortKey: 'networkUsable',
      align: 'right',
      cell: (m) => (
        <span className="tabular text-ink-900">
          {fmtNumber(m.networkUsable)} <span className="text-xs text-ink-500">{m.unit}s</span>
        </span>
      ),
    },
    {
      key: 'short',
      header: 'Facilities short',
      sortKey: 'facilitiesShort',
      align: 'right',
      hideOnMobile: true,
      cell: (m) => (
        <span className={m.facilitiesShort ? 'tabular font-medium text-danger-600' : 'tabular text-ink-400'}>
          {m.facilitiesShort} <span className="font-normal text-ink-400">/ {m.facilitiesHolding} holding</span>
        </span>
      ),
    },
    { key: 'nearest', header: 'Nearest expiry', align: 'right', hideOnMobile: true, cell: (m) => <span className="tabular text-xs text-ink-600">{fmtDate(m.nearestExpiry)}</span> },
    {
      key: 'essential',
      header: 'EML',
      align: 'center',
      hideOnMobile: true,
      cell: (m) => (m.isEssential ? <Badge tone="success">Essential</Badge> : <span className="text-ink-400">—</span>),
    },
  ];

  return (
    <>
      <PageHeader
        title="Medicine catalogue"
        description="Every medicine tracked across the network, with network-wide usable stock."
        actions={
          can(user, 'catalogue:manage') && (
            <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              Add medicine
            </Button>
          )
        }
      />
      <Card>
        <Toolbar onClear={lp.clearFilters} showClear={lp.hasActiveFilters}>
          <SearchInput value={lp.search} onChange={lp.setSearch} placeholder="Search name, code, substance, manufacturer…" />
          <FilterSelect
            label="Category"
            value={lp.filters.categoryId}
            onChange={(v) => lp.setFilter('categoryId', v)}
            options={(categories ?? []).map((c) => ({ value: String(c.id), label: `${'  '.repeat(c.depth - 1)}${c.name}` }))}
          />
          <FilterSelect label="Form" value={lp.filters.form} onChange={(v) => lp.setFilter('form', v)} options={options(DOSAGE_FORM_LABEL)} />
          <FilterSelect
            label="Manufacturer"
            value={lp.filters.manufacturerId}
            onChange={(v) => lp.setFilter('manufacturerId', v)}
            options={(manufacturers ?? []).map((m) => ({ value: String(m.id), label: m.name }))}
          />
          {(['essential', 'coldChain'] as const).map((k) => (
            <label key={k} className="flex h-9 items-center gap-2 rounded-md border border-line-strong px-2.5 text-sm text-ink-700">
              <input
                type="checkbox"
                className="size-4 accent-brand-600"
                checked={lp.filters[k] === 'true'}
                onChange={(e) => lp.setFilter(k, e.target.checked ? 'true' : undefined)}
              />
              {k === 'essential' ? 'Essential only' : 'Cold chain only'}
            </label>
          ))}
        </Toolbar>
        <DataTable
          caption="Medicines"
          columns={columns}
          rows={q.data?.data}
          rowKey={(m) => String(m.id)}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          sortBy={lp.sortBy}
          sortDir={lp.sortDir}
          onSortChange={lp.setSort}
          onRowClick={(m) => navigate(`/medicines/${m.id}`)}
          empty={{ title: 'No medicines match', description: 'Try a different search or clear the filters.' }}
        />
        <Pagination meta={q.data?.meta} onPageChange={lp.setPage} onPageSizeChange={lp.setPageSize} />
      </Card>
      <AddMedicineModal open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
