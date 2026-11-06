import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Database, RefreshCw, Snowflake } from 'lucide-react';
import { ApiError, type NetworkFacility, type NetworkGraph } from '@/api';
import { useCurrentUser } from '@/auth/AuthContext';
import { useFacilityScope } from '@/auth/FacilityScope';
import { hasRole } from '@/auth/permissions';
import { chrome, series } from '@/components/charts/theme';
import { Badge, Button, Card, CardBody, CardHeader, ErrorState, FormField, PageHeader, Segmented, Select, Skeleton, useToast } from '@/components/ui';
import { useFacilityDirectory, useMedicines, useNetworkDistance, useNetworkGraph, useNetworkSuppliers, useSyncNetwork } from '@/hooks/queries';
import { fmtDate, fmtNumber, fmtRelative } from '@/lib/format';
import { FACILITY_TYPE_LABEL } from '@/lib/labels';
import { NetworkMap, orgColours, type MapLayer } from './NetworkMap';

const LAYERS: { value: MapLayer; label: string }[] = [
  { value: 'supply', label: 'Supply links' },
  { value: 'corridors', label: 'Delivery corridors' },
  { value: 'distances', label: 'Distances' },
];

const LAYER_HINT: Record<MapLayer, string> = {
  supply: 'Lines join facilities that may send stock to each other: inside the dispatch radius, and the same organisation or an agreement in force. Dashed = one way only.',
  corridors: 'Completed deliveries. Thicker lines carried more units; arrows point to the receiving facility.',
  distances: 'Routed distance in km from the selected facility to every other one (great-circle × 1.3 road factor).',
};

export default function NetworkPage() {
  const user = useCurrentUser();
  const toast = useToast();
  const { facilityId: scoped } = useFacilityScope();
  const graph = useNetworkGraph();
  const sync = useSyncNetwork();
  const [layer, setLayer] = useState<MapLayer>('supply');
  const [selectedId, setSelectedId] = useState<number | undefined>(scoped);
  const [toId, setToId] = useState<number | undefined>();

  useEffect(() => {
    if (selectedId === undefined && graph.data) setSelectedId(scoped ?? user.scopeFacilityIds[0] ?? graph.data.facilities[0]?.id);
  }, [graph.data, scoped, selectedId, user.scopeFacilityIds]);

  const distance = useNetworkDistance(selectedId, toId);
  const chain = distance.data?.supplyChain?.facilities.map((f) => f.id);

  const runSync = () =>
    sync.mutate(undefined, {
      onSuccess: () => toast.success('Graph rebuilt', 'The network now reflects the current PostgreSQL data.'),
      onError: (e) => toast.error('Graph sync failed', e instanceof ApiError ? e.message : undefined),
    });

  return (
    <>
      <PageHeader
        title="Network map"
        description="How the facilities connect: distances, who may supply whom, and where stock has moved. Served from the Neo4j graph database."
        actions={
          <>
            {graph.data && (
              <span className="flex items-center gap-1.5 text-xs text-ink-500" title={`Built from the ${graph.data.source} database`}>
                <Database className="size-3.5" aria-hidden />
                Synced {fmtRelative(graph.data.syncedAt)}
              </span>
            )}
            {hasRole(user, 'SYSTEM_ADMIN') && (
              <Button variant="secondary" size="sm" icon={<RefreshCw className="size-3.5" />} loading={sync.isPending} onClick={runSync}>
                Sync from PostgreSQL
              </Button>
            )}
          </>
        }
      />

      {graph.error ? (
        <Card>
          <ErrorState error={graph.error} onRetry={() => graph.refetch()} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Facilities" description={LAYER_HINT[layer]} actions={<Segmented value={layer} onChange={setLayer} options={LAYERS} />} />
            <CardBody>
              {graph.data ? (
                <>
                  <NetworkMap graph={graph.data} layer={layer} selectedId={selectedId} path={chain} onSelect={setSelectedId} />
                  <Legend graph={graph.data} layer={layer} />
                </>
              ) : (
                <Skeleton className="h-96" />
              )}
            </CardBody>
          </Card>

          <div className="flex min-w-0 flex-col gap-4">
            {graph.data && selectedId !== undefined && <FacilityPanel graph={graph.data} id={selectedId} onSelect={setSelectedId} />}
            {graph.data && (
              <Card>
                <CardHeader title="Distance between facilities" description="From the selected facility to another one." />
                <CardBody className="space-y-3">
                  <FormField label="To" htmlFor="distance-to">
                    <Select id="distance-to" value={toId ?? ''} onChange={(e) => setToId(e.target.value ? Number(e.target.value) : undefined)}>
                      <option value="">Choose a facility…</option>
                      {graph.data.facilities
                        .filter((f) => f.id !== selectedId)
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.code} · {f.name}
                          </option>
                        ))}
                    </Select>
                  </FormField>
                  {distance.error && <ErrorState error={distance.error} />}
                  {distance.data && (
                    <dl className="space-y-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-500">Routed distance</dt>
                        <dd className="tabular font-semibold text-ink-900">{distance.data.routedKm} km</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-500">Straight line</dt>
                        <dd className="tabular text-ink-700">{distance.data.straightLineKm} km</dd>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-ink-500">Direct supply</dt>
                        <dd className="flex flex-wrap gap-1">
                          <Badge tone={distance.data.fromCanSupplyTo ? 'success' : 'neutral'}>
                            {distance.data.from.code} → {distance.data.to.code} {distance.data.fromCanSupplyTo ? 'allowed' : 'not allowed'}
                          </Badge>
                          <Badge tone={distance.data.toCanSupplyFrom ? 'success' : 'neutral'}>
                            {distance.data.to.code} → {distance.data.from.code} {distance.data.toCanSupplyFrom ? 'allowed' : 'not allowed'}
                          </Badge>
                        </dd>
                      </div>
                      {!distance.data.fromCanSupplyTo && (
                        <div className="rounded-md bg-subtle p-2.5 text-xs text-ink-600">
                          {distance.data.supplyChain ? (
                            <>
                              <p className="font-medium text-ink-800">Shortest chain of legal supply links ({distance.data.supplyChain.km.toFixed(1)} km), drawn on the map:</p>
                              <p className="mt-1 flex flex-wrap items-center gap-1">
                                {distance.data.supplyChain.facilities.map((f, i) => (
                                  <span key={f.id} className="flex items-center gap-1">
                                    {i > 0 && <ArrowRight className="size-3 text-ink-400" aria-hidden />}
                                    <span className="tabular font-medium">{f.code}</span>
                                  </span>
                                ))}
                              </p>
                              <p className="mt-1">Each step would be a separate transfer.</p>
                            </>
                          ) : (
                            'No chain of legal supply links connects these facilities.'
                          )}
                        </div>
                      )}
                    </dl>
                  )}
                </CardBody>
              </Card>
            )}
          </div>

          {graph.data && selectedId !== undefined && (
            <div className="lg:col-span-3">
              <SuppliersCard graph={graph.data} id={selectedId} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Legend({ graph, layer }: { graph: NetworkGraph; layer: MapLayer }) {
  const colour = orgColours(graph);
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line pt-3 text-xs text-ink-600">
      {graph.organisations.map((o) => (
        <span key={o.id} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: colour.get(o.id) }} aria-hidden />
          {o.name.replace(' (Synthetic)', '')}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-ink-400" aria-hidden />
        Square = warehouse
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-full border-[1.5px] border-danger-500" aria-hidden />
        Ring = critical shortage
      </span>
      {layer === 'supply' && (
        <>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4" style={{ background: series.s3 }} aria-hidden />
            May supply the selected facility
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4" style={{ background: series.s1 }} aria-hidden />
            Selected facility may supply it
          </span>
        </>
      )}
      <span className="basis-full text-ink-500">Directions are real; distances are compressed so nearby facilities stay readable. The km labels are true distances.</span>
      {layer === 'corridors' && graph.corridors.length === 0 && <span style={{ color: chrome.text }}>No completed deliveries in your scope yet.</span>}
    </div>
  );
}

function FacilityPanel({ graph, id, onSelect }: { graph: NetworkGraph; id: number; onSelect(id: number): void }) {
  const f = graph.facilities.find((x) => x.id === id);
  const org = graph.organisations.find((o) => o.id === f?.organizationId);
  const nearest = useMemo(
    () =>
      graph.roads
        .filter((r) => r.a === id || r.b === id)
        .map((r) => ({ other: graph.facilities.find((x) => x.id === (r.a === id ? r.b : r.a)) as NetworkFacility, km: r.km }))
        .sort((x, y) => x.km - y.km)
        .slice(0, 4),
    [graph, id],
  );
  if (!f) return null;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-1.5">
            {f.name}
            {f.coldChain && <Snowflake className="size-3.5 text-info-500" aria-label="Cold chain capable" />}
          </span>
        }
        description={`${f.code} · ${FACILITY_TYPE_LABEL[f.type]} · ${org?.name.replace(' (Synthetic)', '')}`}
        actions={
          <Link to={`/facilities/${f.id}`} className="text-xs font-medium text-brand-700 hover:underline">
            Details
          </Link>
        }
      />
      <CardBody className="space-y-3">
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-subtle p-2">
            <dt className="text-[11px] text-ink-500">May be supplied by</dt>
            <dd className="tabular text-lg font-semibold text-ink-900">{f.suppliers}</dd>
          </div>
          <div className="rounded-md bg-subtle p-2">
            <dt className="text-[11px] text-ink-500">May supply</dt>
            <dd className="tabular text-lg font-semibold text-ink-900">{f.canSupply}</dd>
          </div>
          <div className="rounded-md bg-subtle p-2">
            <dt className="text-[11px] text-ink-500">Critical shortages</dt>
            <dd className={f.criticalShortages ? 'tabular text-lg font-semibold text-danger-600' : 'tabular text-lg font-semibold text-ink-900'}>
              {f.criticalShortages ?? <span className="text-sm font-normal text-ink-400" title="Outside your facility scope">—</span>}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-ink-500">
          {f.regionName} · dispatch radius {fmtNumber(f.radiusKm)} km{!f.active && ' · inactive'}
        </p>
        <div>
          <p className="mb-1 text-xs font-medium text-ink-700">Nearest facilities</p>
          <ul className="space-y-0.5 text-sm">
            {nearest.map(({ other, km }) => (
              <li key={other.id}>
                <button type="button" onClick={() => onSelect(other.id)} className="flex w-full justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-subtle">
                  <span className="truncate text-ink-800">
                    <span className="tabular text-xs text-ink-500">{other.code}</span> {other.name}
                  </span>
                  <span className="tabular shrink-0 text-ink-600">{km} km</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </CardBody>
    </Card>
  );
}

function SuppliersCard({ graph, id }: { graph: NetworkGraph; id: number }) {
  const directory = useFacilityDirectory();
  const inScope = directory.byId(id)?.inScope ?? false;
  const medicines = useMedicines({ pageSize: 100, sortBy: 'name' }, inScope);
  const [medicineId, setMedicineId] = useState<number | undefined>();
  const suppliers = useNetworkSuppliers(inScope ? id : undefined, medicineId);
  const name = graph.facilities.find((f) => f.id === id)?.name;

  return (
    <Card>
      <CardHeader
        title={`Who may supply ${name ?? 'this facility'}`}
        description="Nearest first. One graph query: supply links into this facility, joined to the stock each supplier holds."
        actions={
          inScope && (
            <Select aria-label="Medicine" value={medicineId ?? ''} onChange={(e) => setMedicineId(e.target.value ? Number(e.target.value) : undefined)} className="max-w-64">
              <option value="">Any medicine</option>
              {(medicines.data?.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )
        }
      />
      {!inScope ? (
        <CardBody className="text-sm text-ink-500">Suppliers and their stock are shown for facilities in your scope.</CardBody>
      ) : suppliers.error ? (
        <ErrorState error={suppliers.error} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Facilities that may supply {name}</caption>
            <thead className="bg-subtle text-left text-xs text-ink-500">
              <tr>
                <th className="px-4 py-2 font-medium">Supplier</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">Organisation</th>
                <th className="px-4 py-2 text-right font-medium">Distance</th>
                {medicineId && <th className="px-4 py-2 text-right font-medium">Usable</th>}
                {medicineId && <th className="hidden px-4 py-2 font-medium sm:table-cell">Nearest expiry</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {suppliers.isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-3">
                    <Skeleton className="h-5" />
                  </td>
                </tr>
              )}
              {suppliers.data?.suppliers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink-500">
                    {medicineId ? 'No facility that may supply this one holds this medicine.' : 'No facility may supply this one.'}
                  </td>
                </tr>
              )}
              {suppliers.data?.suppliers.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2">
                    <p className="font-medium text-ink-900">{s.name}</p>
                    <p className="tabular text-xs text-ink-500">
                      {s.code} · {FACILITY_TYPE_LABEL[s.type]}
                    </p>
                  </td>
                  <td className="hidden px-4 py-2 sm:table-cell">
                    <span className="text-ink-700">{s.organizationName.replace(' (Synthetic)', '')}</span>{' '}
                    {s.sameOrg ? <Badge tone="success">Same organisation</Badge> : <Badge tone="info">Agreement</Badge>}
                  </td>
                  <td className="tabular px-4 py-2 text-right text-ink-800">{s.km} km</td>
                  {medicineId && <td className="tabular px-4 py-2 text-right text-ink-800">{fmtNumber(s.usable)}</td>}
                  {medicineId && <td className="hidden px-4 py-2 text-ink-700 sm:table-cell">{fmtDate(s.nearestExpiry)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
