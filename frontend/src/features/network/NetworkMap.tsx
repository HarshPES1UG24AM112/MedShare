import { useMemo } from 'react';
import type { NetworkFacility, NetworkGraph } from '@/api/types';
import { categorical, chrome, series, status } from '@/components/charts/theme';
import { FACILITY_TYPE_LABEL } from '@/lib/labels';

export type MapLayer = 'supply' | 'corridors' | 'distances';

const WIDTH = 800;
const PAD = 48;

/** Colour per organisation, stable across renders (organisations come sorted by name). */
export function orgColours(graph: NetworkGraph) {
  return new Map(graph.organisations.map((o, i) => [o.id, categorical[i % categorical.length]]));
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/**
 * Real directions, compressed distances. Facilities are placed by latitude and
 * longitude (km east/north of the network's median point), then each point's
 * distance from that centre is log-compressed, so a city cluster a few km apart
 * stays readable beside towns 150 km away. The map is therefore not to scale;
 * the km labels carry the true distances.
 */
function project(facilities: NetworkFacility[]) {
  const KM_PER_DEG = 111.32;
  const lat0 = median(facilities.map((f) => f.lat));
  const lon0 = median(facilities.map((f) => f.lon));
  const k = Math.cos(lat0 * (Math.PI / 180));
  const D0 = 12; // km: below this, distances stay almost linear
  const raw = facilities.map((f) => {
    const [east, north] = [(f.lon - lon0) * k * KM_PER_DEG, (f.lat - lat0) * KM_PER_DEG];
    const d = Math.hypot(east, north);
    const s = d === 0 ? 0 : (D0 * Math.log1p(d / D0)) / d;
    return { id: f.id, x: east * s, y: -north * s };
  });
  const [x0, x1] = [Math.min(...raw.map((p) => p.x)), Math.max(...raw.map((p) => p.x))];
  const [y0, y1] = [Math.min(...raw.map((p) => p.y)), Math.max(...raw.map((p) => p.y))];
  const scale = Math.min((WIDTH - 2 * PAD) / Math.max(x1 - x0, 1e-6), 520 / Math.max(y1 - y0, 1e-6));
  const height = Math.round((y1 - y0) * scale + 2 * PAD);
  const offsetX = (WIDTH - (x1 - x0) * scale) / 2;
  const pts = raw.map((p) => ({ id: p.id, x: offsetX + (p.x - x0) * scale, y: PAD + (p.y - y0) * scale }));
  // Facilities in the same town (a couple of km apart) would overlap: push such pairs apart.
  const GAP = 30;
  for (let pass = 0; pass < 20; pass++) {
    for (const a of pts)
      for (const b of pts) {
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (a === b || d >= GAP) continue;
        const [ux, uy] = d === 0 ? [1, 0] : [(b.x - a.x) / d, (b.y - a.y) / d];
        const push = (GAP - d) / 2;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
      }
  }
  return { at: new Map(pts.map((p) => [p.id, { x: p.x, y: p.y }])), height };
}

const radius = (f: NetworkFacility) => (f.type === 'WAREHOUSE' ? 9 : f.type === 'HOSPITAL' ? 8 : f.type === 'PHARMACY' ? 5.5 : 6.5);

interface Props {
  graph: NetworkGraph;
  layer: MapLayer;
  selectedId?: number;
  /** Facility ids of a supply chain to draw on top, in order. */
  path?: number[];
  onSelect(id: number): void;
}

export function NetworkMap({ graph, layer, selectedId, path, onSelect }: Props) {
  const { at, height } = useMemo(() => project(graph.facilities), [graph.facilities]);
  const colour = useMemo(() => orgColours(graph), [graph]);
  const maxUnits = Math.max(1, ...graph.corridors.map((c) => c.units));
  const pos = (id: number) => at.get(id)!;

  // Supply links drawn once per pair; "both" when either facility may supply the other.
  const pairs = useMemo(() => {
    const m = new Map<string, { a: number; b: number; km: number; both: boolean }>();
    for (const l of graph.supplyLinks) {
      const [a, b] = l.source < l.destination ? [l.source, l.destination] : [l.destination, l.source];
      const key = `${a}-${b}`;
      const seen = m.get(key);
      m.set(key, { a, b, km: l.km, both: Boolean(seen) });
    }
    return [...m.values()];
  }, [graph.supplyLinks]);

  const incoming = new Set(graph.supplyLinks.filter((l) => l.destination === selectedId).map((l) => l.source));
  const outgoing = new Set(graph.supplyLinks.filter((l) => l.source === selectedId).map((l) => l.destination));

  const label = (x: number, y: number, text: string, key: string) => (
    <text key={key} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill={chrome.text} stroke={chrome.surface} strokeWidth={3} paintOrder="stroke">
      {text}
    </text>
  );

  const edges: JSX.Element[] = [];
  const edgeLabels: JSX.Element[] = [];
  if (layer === 'supply') {
    for (const p of pairs) {
      const [a, b] = [pos(p.a), pos(p.b)];
      const touches = selectedId !== undefined && (p.a === selectedId || p.b === selectedId);
      if (selectedId !== undefined && !touches) {
        edges.push(<line key={`s${p.a}-${p.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={chrome.grid} strokeWidth={1} />);
        continue;
      }
      const other = p.a === selectedId ? p.b : p.a;
      // Green: may supply the selected facility; blue: the selected facility may supply it.
      const stroke = !touches ? chrome.axis : incoming.has(other) ? series.s3 : series.s1;
      edges.push(
        <line key={`s${p.a}-${p.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeOpacity={touches ? 0.9 : 0.35}
          strokeWidth={touches ? 2 : 1} strokeDasharray={p.both ? undefined : '4 3'} />,
      );
      if (touches) edgeLabels.push(label((a.x + b.x) / 2, (a.y + b.y) / 2, `${p.km} km`, `l${p.a}-${p.b}`));
    }
  } else if (layer === 'corridors') {
    const involved = graph.corridors.some((c) => c.source === selectedId || c.destination === selectedId);
    for (const c of graph.corridors) {
      const [a, b] = [pos(c.source), pos(c.destination)];
      // Highlight the selected facility's deliveries; when it has none, show every corridor at full strength.
      const touches = !involved || c.source === selectedId || c.destination === selectedId;
      edges.push(
        <line key={`c${c.source}-${c.destination}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={series.s2} strokeOpacity={touches ? 0.85 : 0.15}
          strokeWidth={1.5 + (c.units / maxUnits) * 6} markerEnd="url(#arrow)" strokeLinecap="round" />,
      );
    }
  } else if (selectedId !== undefined) {
    for (const r of graph.roads) {
      if (r.a !== selectedId && r.b !== selectedId) continue;
      const [a, b] = [pos(r.a), pos(r.b)];
      edges.push(<line key={`r${r.a}-${r.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={chrome.axis} strokeOpacity={0.6} strokeWidth={1} />);
      edgeLabels.push(label((a.x + b.x) / 2, (a.y + b.y) / 2, `${r.km}`, `d${r.a}-${r.b}`));
    }
  }

  // A supply chain is about legal links and distances, not past deliveries.
  const chain = path && path.length > 1 && layer !== 'corridors' ? path.map((id) => pos(id)) : null;

  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} className="h-auto w-full select-none" role="group" aria-label="Map of the facility network">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="22" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto">

          <path d="M0,0 L10,5 L0,10 z" fill={series.s2} />
        </marker>
      </defs>
      <g>{edges}</g>
      {chain && (
        <polyline points={chain.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={chrome.text} strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round" strokeOpacity={0.85} />
      )}
      <g>{edgeLabels}</g>
      <g>
        {graph.facilities.map((f) => {
          const p = pos(f.id);
          const r = radius(f);
          const selected = f.id === selectedId;
          const dim = layer === 'supply' && selectedId !== undefined && !selected && !incoming.has(f.id) && !outgoing.has(f.id);
          const critical = (f.criticalShortages ?? 0) > 0;
          return (
            <g
              key={f.id}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={`${f.code} ${f.name}`}
              onClick={() => onSelect(f.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(f.id))}
              className="cursor-pointer focus:outline-none"
              opacity={dim ? 0.35 : 1}
            >
              <title>{`${f.code} · ${f.name}\n${FACILITY_TYPE_LABEL[f.type]} · ${f.regionName}`}</title>
              {critical && <circle cx={p.x} cy={p.y} r={r + 4} fill="none" stroke={status.critical} strokeWidth={1.5} />}
              {selected && <circle cx={p.x} cy={p.y} r={r + 7} fill="none" stroke={chrome.text} strokeWidth={2} />}
              {f.type === 'WAREHOUSE' ? (
                <rect x={p.x - r} y={p.y - r} width={2 * r} height={2 * r} rx={2} fill={f.active ? colour.get(f.organizationId) : chrome.surface}
                  stroke={colour.get(f.organizationId)} strokeWidth={1.5} />
              ) : (
                <circle cx={p.x} cy={p.y} r={r} fill={f.active ? colour.get(f.organizationId) : chrome.surface} stroke={chrome.surface} strokeWidth={1.5} />
              )}
              <text x={p.x} y={p.y - r - 6} textAnchor="middle" fontSize={10.5} fontWeight={selected ? 700 : 500} fill={chrome.text}
                stroke={chrome.surface} strokeWidth={3} paintOrder="stroke">
                {f.code.replace('FAC-', '')}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
