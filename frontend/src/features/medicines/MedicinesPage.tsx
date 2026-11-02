import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import type { DosageForm, Medicine } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import { Badge, Button, Card, DataTable, FilterSelect, PageHeader, Pagination, SearchInput, Toolbar, type Column } from '@/components/ui';
import { useCategories, useMedicines } from '@/hooks/queries';
import { useListParams } from '@/hooks/useListParams';
import { fmtNumber } from '@/lib/format';
import { DOSAGE_FORM_LABEL } from '@/lib/labels';
import { AddMedicineModal } from './AddMedicineModal';

const FILTERS = ['category', 'form', 'essential'] as const;

export default function MedicinesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const lp = useListParams(FILTERS, { sortBy: 'name' });
  const { data: categories } = useCategories();
  const q = useMedicines({
    ...lp.query,
    category: lp.filters.category,
    dosageForm: lp.filters.form as DosageForm | undefined,
    essentialOnly: lp.filters.essential === '1' || undefined,
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
            {m.name} <span className="font-normal text-ink-500">{m.strength}</span>
          </p>
          <p className="text-xs text-ink-500">{m.genericName}</p>
        </div>
      ),
    },
    { key: 'category', header: 'Category', sortKey: 'category', cell: (m) => <span className="text-ink-700">{m.category}</span> },
    { key: 'form', header: 'Form', cell: (m) => <span className="text-ink-700">{DOSAGE_FORM_LABEL[m.dosageForm]}</span>, hideOnMobile: true },
    {
      key: 'reorder',
      header: 'Reorder / critical',
      sortKey: 'reorderThreshold',
      align: 'right',
      hideOnMobile: true,
      cell: (m) => (
        <span className="tabular text-ink-700">
          {fmtNumber(m.reorderThreshold)} <span className="text-ink-400">/</span> <span className="text-danger-600">{fmtNumber(m.criticalThreshold)}</span>
        </span>
      ),
    },
    { key: 'essential', header: 'EML', align: 'center', hideOnMobile: true, cell: (m) => (m.isEssential ? <Badge tone="success">Essential</Badge> : <span className="text-ink-400">—</span>) },
  ];

  return (
    <>
      <PageHeader
        title="Medicine catalogue"
        description="Master list of medicines tracked across the network, with network-wide stock thresholds."
        actions={
          can(user, 'medicine:create') && (
            <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              Add medicine
            </Button>
          )
        }
      />
      <Card>
        <Toolbar onClear={lp.clearFilters} showClear={lp.hasActiveFilters}>
          <SearchInput value={lp.search} onChange={lp.setSearch} placeholder="Search name, generic, code…" />
          <FilterSelect label="Category" value={lp.filters.category} onChange={(v) => lp.setFilter('category', v)} options={(categories ?? []).map((c) => ({ value: c, label: c }))} />
          <FilterSelect
            label="Form"
            value={lp.filters.form}
            onChange={(v) => lp.setFilter('form', v)}
            options={Object.entries(DOSAGE_FORM_LABEL).map(([value, label]) => ({ value, label }))}
          />
          <label className="flex h-9 items-center gap-2 rounded-md border border-line-strong px-2.5 text-sm text-ink-700">
            <input
              type="checkbox"
              className="size-4 accent-brand-600"
              checked={lp.filters.essential === '1'}
              onChange={(e) => lp.setFilter('essential', e.target.checked ? '1' : undefined)}
            />
            Essential only
          </label>
        </Toolbar>
        <DataTable
          caption="Medicines"
          columns={columns}
          rows={q.data?.data}
          rowKey={(m) => m.id}
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
