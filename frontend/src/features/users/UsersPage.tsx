import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Trash2, UserPlus } from 'lucide-react';
import { ApiError } from '@/api';
import type { FacilityRole, OrgRole, Role, UserRow } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { hasRole } from '@/auth/permissions';
import { Forbidden } from '@/auth/ProtectedRoute';
import {
  Badge,
  Button,
  Card,
  DataTable,
  ErrorState,
  FilterSelect,
  FormField,
  Input,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Skeleton,
  Toolbar,
  useToast,
  type Column,
} from '@/components/ui';
import { useCreateUser, useFacilityDirectory, useOrganizations, useUser, useUserCommand, useUsers } from '@/hooks/queries';
import { toId, useListParams } from '@/hooks/useListParams';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { ROLE_LABEL, options } from '@/lib/labels';

const FILTERS = ['role', 'organizationId', 'facilityId', 'active', 'open'] as const;
const ORG_ROLES: OrgRole[] = ['SYSTEM_ADMIN', 'ORG_ADMIN', 'AUDITOR'];
const FACILITY_ROLES: FacilityRole[] = ['FACILITY_MANAGER', 'INVENTORY_MANAGER'];
const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,128}$/;

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'The request failed.');

/** Organisation roles the caller may grant: system admins anything, org admins only within their organisations. */
function useGrantableOrgs() {
  const me = useCurrentUser();
  const orgs = useOrganizations();
  const isSysAdmin = hasRole(me, 'SYSTEM_ADMIN');
  const mine = new Set(me.roles.filter((r) => r.role === 'ORG_ADMIN').map((r) => r.organizationId));
  return { isSysAdmin, organizations: (orgs.data ?? []).filter((o) => isSysAdmin || mine.has(o.id)) };
}

export default function UsersPage() {
  const me = useCurrentUser();
  const lp = useListParams(FILTERS, { sortBy: 'name' });
  const [, setSp] = useSearchParams();
  const organizations = useOrganizations();
  const { facilities } = useFacilityDirectory();
  const q = useUsers({
    ...lp.query,
    role: lp.filters.role as Role | undefined,
    organizationId: toId(lp.filters.organizationId),
    facilityId: toId(lp.filters.facilityId),
    active: lp.filters.active as 'true' | 'false' | undefined,
  });
  const [creating, setCreating] = useState(false);
  const openId = toId(lp.filters.open);
  const setOpen = (id: number | undefined) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (id) n.set('open', String(id));
        else n.delete('open');
        return n;
      },
      { replace: true },
    );

  if (!me.permissions.includes('user:manage')) return <Forbidden />;

  const columns: Column<UserRow>[] = [
    {
      key: 'name',
      header: 'User',
      sortKey: 'name',
      cell: (u) => (
        <div className="min-w-0">
          <p className="font-medium text-ink-900">{u.fullName}</p>
          <p className="truncate text-xs text-ink-500">{u.email}</p>
        </div>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      cell: (u) => (
        <span className="flex flex-wrap gap-1">
          {u.roles.length ? u.roles.map((r) => <Badge key={r}>{ROLE_LABEL[r]}</Badge>) : <span className="text-xs text-ink-400">None</span>}
        </span>
      ),
    },
    { key: 'facilities', header: 'Facilities', hideOnMobile: true, cell: (u) => <span className="text-xs text-ink-600">{u.facilityCodes || '—'}</span> },
    { key: 'lastLogin', header: 'Last sign-in', sortKey: 'lastLogin', hideOnMobile: true, cell: (u) => <span className="text-xs text-ink-500">{u.lastLoginAt ? fmtRelative(u.lastLoginAt) : 'Never'}</span> },
    { key: 'status', header: 'Status', cell: (u) => (u.isActive ? <Badge tone="success" dot>Active</Badge> : <Badge tone="danger">Deactivated</Badge>) },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        description={hasRole(me, 'SYSTEM_ADMIN') ? 'Every account on the platform. There is no self-registration.' : 'Accounts in your organisation. There is no self-registration.'}
        actions={
          <Button icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>
            Create user
          </Button>
        }
      />
      <Card>
        <Toolbar onClear={lp.clearFilters} showClear={lp.hasActiveFilters}>
          <SearchInput value={lp.search} onChange={lp.setSearch} placeholder="Search name or email…" />
          <FilterSelect label="Role" value={lp.filters.role} onChange={(v) => lp.setFilter('role', v)} options={options(ROLE_LABEL)} />
          <FilterSelect
            label="Organisation"
            value={lp.filters.organizationId}
            onChange={(v) => lp.setFilter('organizationId', v)}
            options={(organizations.data ?? []).map((o) => ({ value: String(o.id), label: o.name }))}
          />
          <FilterSelect label="Facility" value={lp.filters.facilityId} onChange={(v) => lp.setFilter('facilityId', v)} options={facilities.map((f) => ({ value: String(f.id), label: `${f.code} · ${f.name}` }))} />
          <FilterSelect
            label="Status"
            value={lp.filters.active}
            onChange={(v) => lp.setFilter('active', v)}
            options={[
              { value: 'true', label: 'Active' },
              { value: 'false', label: 'Deactivated' },
            ]}
          />
        </Toolbar>
        <DataTable
          caption="Users"
          columns={columns}
          rows={q.data?.data}
          rowKey={(u) => String(u.id)}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          sortBy={lp.sortBy}
          sortDir={lp.sortDir}
          onSortChange={lp.setSort}
          onRowClick={(u) => setOpen(u.id)}
          empty={{ title: 'No users match these filters' }}
        />
        <Pagination meta={q.data?.meta} onPageChange={lp.setPage} onPageSizeChange={lp.setPageSize} />
      </Card>
      <CreateUserModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => setOpen(id)} />
      <UserDetailModal id={openId} onClose={() => setOpen(undefined)} />
    </>
  );
}

/* --------------------------------- create --------------------------------- */

type OrgGrant = { role: OrgRole; organizationId: number | null };
type FacGrant = { facilityId: number; role: FacilityRole };

function GrantEditor({
  orgGrants,
  facGrants,
  onAddOrg,
  onAddFac,
}: {
  orgGrants?: OrgGrant[];
  facGrants?: FacGrant[];
  onAddOrg: (g: OrgGrant) => void;
  onAddFac: (g: FacGrant) => void;
}) {
  const { isSysAdmin, organizations } = useGrantableOrgs();
  const { facilities } = useFacilityDirectory();
  const grantableFacilities = facilities.filter((f) => isSysAdmin || organizations.some((o) => o.id === f.organizationId));
  const [orgRole, setOrgRole] = useState<OrgRole>(isSysAdmin ? 'AUDITOR' : 'ORG_ADMIN');
  const [orgId, setOrgId] = useState<string>('');
  const [facRole, setFacRole] = useState<FacilityRole>('INVENTORY_MANAGER');
  const [facId, setFacId] = useState<string>('');
  const allowedOrgRoles = ORG_ROLES.filter((r) => isSysAdmin || r !== 'SYSTEM_ADMIN');
  const platformOk = isSysAdmin && orgRole !== 'ORG_ADMIN';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <FormField label="Organisation / platform role" htmlFor="g-org-role" className="min-w-40 flex-1">
          <Select id="g-org-role" value={orgRole} onChange={(e) => setOrgRole(e.target.value as OrgRole)}>
            {allowedOrgRoles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Scope" htmlFor="g-org" className="min-w-40 flex-1">
          <Select id="g-org" value={orgRole === 'SYSTEM_ADMIN' ? '' : orgId} disabled={orgRole === 'SYSTEM_ADMIN'} onChange={(e) => setOrgId(e.target.value)}>
            {platformOk && <option value="">Whole platform</option>}
            {!platformOk && <option value="">Choose organisation…</option>}
            {orgRole !== 'SYSTEM_ADMIN' &&
              organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </Select>
        </FormField>
        <Button
          variant="secondary"
          icon={<Plus className="size-3.5" />}
          disabled={(!platformOk && !orgId) || orgGrants?.some((g) => g.role === orgRole && String(g.organizationId ?? '') === (orgRole === 'SYSTEM_ADMIN' ? '' : orgId))}
          onClick={() => onAddOrg({ role: orgRole, organizationId: orgRole === 'SYSTEM_ADMIN' || !orgId ? null : Number(orgId) })}
        >
          Add
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <FormField label="Facility role" htmlFor="g-fac-role" className="min-w-40 flex-1">
          <Select id="g-fac-role" value={facRole} onChange={(e) => setFacRole(e.target.value as FacilityRole)}>
            {FACILITY_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Facility" htmlFor="g-fac" className="min-w-40 flex-1">
          <Select id="g-fac" value={facId} onChange={(e) => setFacId(e.target.value)}>
            <option value="">Choose facility…</option>
            {grantableFacilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.code} · {f.name}
              </option>
            ))}
          </Select>
        </FormField>
        <Button
          variant="secondary"
          icon={<Plus className="size-3.5" />}
          disabled={!facId || facGrants?.some((g) => g.role === facRole && g.facilityId === Number(facId))}
          onClick={() => onAddFac({ facilityId: Number(facId), role: facRole })}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function CreateUserModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const toast = useToast();
  const create = useCreateUser();
  const { facilities } = useFacilityDirectory();
  const orgs = useOrganizations();
  const [form, setForm] = useState({ email: '', fullName: '', password: '' });
  const [orgGrants, setOrgGrants] = useState<OrgGrant[]>([]);
  const [facGrants, setFacGrants] = useState<FacGrant[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setForm({ email: '', fullName: '', password: '' });
    setOrgGrants([]);
    setFacGrants([]);
    setErrors({});
  }, [open]);

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) errs.email = 'Enter a valid email';
    if (form.fullName.trim().length < 2) errs.fullName = 'At least 2 characters';
    if (!PASSWORD_RULE.test(form.password)) errs.password = '10+ characters with upper case, lower case and a digit';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      const u = await create.mutateAsync({ email: form.email.trim(), fullName: form.fullName.trim(), password: form.password, roles: orgGrants, facilities: facGrants });
      toast.success('User created', `${u.fullName} can now sign in.`);
      onClose();
      onCreated(u.id);
    } catch (e) {
      const fieldErrs: Record<string, string> = {};
      if (e instanceof ApiError && e.details) for (const [k, v] of Object.entries(e.details)) fieldErrs[k] = v[0];
      setErrors({ ...fieldErrs, form: errMsg(e) });
    }
  };

  const orgName = (id: number | null) => (id === null ? 'Platform' : (orgs.data?.find((o) => o.id === id)?.name ?? `Org ${id}`));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Create user"
      description="Give the person a temporary password to change after first sign-in. Roles can also be added later."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} onClick={submit}>
            Create user
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {errors.form && (
          <p role="alert" className="rounded-md border border-danger-100 bg-danger-50 p-3 text-xs text-danger-700">
            {errors.form}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Full name" htmlFor="u-name" error={errors.fullName} required>
            <Input id="u-name" value={form.fullName} invalid={!!errors.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
          </FormField>
          <FormField label="Email" htmlFor="u-email" error={errors.email} required>
            <Input id="u-email" type="email" autoComplete="off" value={form.email} invalid={!!errors.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </FormField>
          <FormField label="Temporary password" htmlFor="u-pw" error={errors.password} hint="10+ characters, upper and lower case and a digit" required className="sm:col-span-2">
            <Input id="u-pw" type="password" autoComplete="new-password" value={form.password} invalid={!!errors.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
          </FormField>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-ink-700">Roles</p>
          {(orgGrants.length > 0 || facGrants.length > 0) && (
            <ul className="mb-3 flex flex-wrap gap-1.5">
              {orgGrants.map((g, i) => (
                <li key={`o${i}`}>
                  <button type="button" onClick={() => setOrgGrants((gs) => gs.filter((_, j) => j !== i))} className="inline-flex items-center gap-1" aria-label={`Remove ${ROLE_LABEL[g.role]}`}>
                    <Badge tone="info">
                      {ROLE_LABEL[g.role]} · {orgName(g.organizationId)} <Trash2 className="size-3" />
                    </Badge>
                  </button>
                </li>
              ))}
              {facGrants.map((g, i) => (
                <li key={`f${i}`}>
                  <button type="button" onClick={() => setFacGrants((gs) => gs.filter((_, j) => j !== i))} className="inline-flex items-center gap-1" aria-label={`Remove ${ROLE_LABEL[g.role]}`}>
                    <Badge tone="success">
                      {ROLE_LABEL[g.role]} · {facilities.find((f) => f.id === g.facilityId)?.code} <Trash2 className="size-3" />
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <GrantEditor orgGrants={orgGrants} facGrants={facGrants} onAddOrg={(g) => setOrgGrants((gs) => [...gs, g])} onAddFac={(g) => setFacGrants((gs) => [...gs, g])} />
        </div>
      </div>
    </Modal>
  );
}

/* --------------------------------- detail --------------------------------- */

function UserDetailModal({ id, onClose }: { id: number | undefined; onClose: () => void }) {
  const me = useCurrentUser();
  const toast = useToast();
  const q = useUser(id);
  const cmd = useUserCommand();
  const u = q.data;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [id]);

  const run = (c: Parameters<typeof cmd.mutate>[0], ok: string) =>
    cmd.mutate(c, {
      onSuccess: () => {
        setError(null);
        toast.success(ok);
        void q.refetch();
      },
      onError: (e) => setError(errMsg(e)),
    });

  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={u?.fullName ?? 'User'} description={u && `${u.email}${u.isSynthetic ? ' · synthetic demo account' : ''}`}>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !u ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="space-y-5">
          {error && (
            <p role="alert" className="rounded-md border border-danger-100 bg-danger-50 p-3 text-xs text-danger-700">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-600">
              {u.isActive ? <Badge tone="success" dot>Active</Badge> : <Badge tone="danger">Deactivated</Badge>}
              <span className="ml-2 text-xs">Last sign-in {u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : 'never'}</span>
            </p>
            {u.id !== me.id && (
              <Button
                variant={u.isActive ? 'danger' : 'secondary'}
                size="sm"
                loading={cmd.isPending && cmd.variables?.kind === 'update'}
                onClick={() => run({ kind: 'update', id: u.id, input: { isActive: !u.isActive } }, u.isActive ? 'User deactivated' : 'User reactivated')}
              >
                {u.isActive ? 'Deactivate' : 'Reactivate'}
              </Button>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-ink-500">Organisation and platform roles</p>
            {!u.roles.length ? (
              <p className="text-xs text-ink-400">None</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                {u.roles.map((r) => (
                  <li key={r.grantId} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span>
                      {ROLE_LABEL[r.role]} <span className="text-xs text-ink-500">· {r.organizationName ?? 'Whole platform'}</span>
                    </span>
                    <Button variant="ghost" size="sm" aria-label={`Revoke ${ROLE_LABEL[r.role]}`} icon={<Trash2 className="size-3.5" />} onClick={() => run({ kind: 'revokeRole', id: u.id, grantId: r.grantId }, 'Role revoked')} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-ink-500">Facility roles</p>
            {!u.facilities.length ? (
              <p className="text-xs text-ink-400">None</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                {u.facilities.map((f) => (
                  <li key={`${f.facilityId}-${f.role}`} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span>
                      {ROLE_LABEL[f.role]} <span className="text-xs text-ink-500">· {f.facilityCode} {f.facilityName}</span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Revoke ${ROLE_LABEL[f.role]} at ${f.facilityCode}`}
                      icon={<Trash2 className="size-3.5" />}
                      onClick={() => run({ kind: 'revokeFacilityRole', id: u.id, facilityId: f.facilityId, role: f.role }, 'Facility role revoked')}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-line pt-4">
            <p className="mb-2 text-xs font-medium text-ink-700">Grant a role</p>
            <GrantEditor
              orgGrants={u.roles}
              facGrants={u.facilities}
              onAddOrg={(g) => run({ kind: 'grantRole', id: u.id, role: g.role, organizationId: g.organizationId }, 'Role granted')}
              onAddFac={(g) => run({ kind: 'grantFacilityRole', id: u.id, facilityId: g.facilityId, role: g.role }, 'Facility role granted')}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
