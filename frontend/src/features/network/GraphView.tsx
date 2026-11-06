import { useMemo, useRef, useState, type PointerEvent } from 'react';
import type { GraphNode, GraphRelationship } from '@/api/types';
import { categorical, chrome } from '@/components/charts/theme';
import { forceLayout } from './forceLayout';

const WIDTH = 800;
const HEIGHT = 520;

/** One colour per node label, in a fixed order so Facility is always the same colour. */
const LABEL_ORDER = ['Facility', 'Organisation', 'Region', 'Medicine'];
export const labelColour = (label: string) => {
  const i = LABEL_ORDER.indexOf(label);
  return i >= 0 ? categorical[i] : chrome.axis;
};

export const nodeCaption = (n: { labels: string[]; properties: Record<string, unknown> }) =>
  String(n.properties.code ?? n.properties.name ?? n.labels[0] ?? '?');

interface Props {
  nodes: GraphNode[];
  relationships: GraphRelationship[];
  selectedId?: string;
  onSelect(node: GraphNode | undefined): void;
}

/** Draws a Cypher result as a graph. Nodes can be dragged; clicking one shows its properties. */
export function GraphView({ nodes, relationships, selectedId, onSelect }: Props) {
  const initial = useMemo(() => forceLayout({ nodes, links: relationships }, WIDTH, HEIGHT), [nodes, relationships]);
  const [moved, setMoved] = useState<Map<string, { x: number; y: number }>>(new Map());
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; dragged: boolean } | null>(null);
  // pointerup clears `drag` before the click event, so remember whether that press was a drag.
  const wasDrag = useRef(false);
  const at = (id: string) => moved.get(id) ?? initial.get(id)!;

  // Several relationships between the same two nodes are drawn as separate arcs.
  const bends = useMemo(() => {
    const seen = new Map<string, number>();
    return new Map(
      relationships.map((r) => {
        const key = [r.start, r.end].sort().join('|');
        const k = seen.get(key) ?? 0;
        seen.set(key, k + 1);
        return [r.id, k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 28];
      }),
    );
  }, [relationships]);
  // Type labels on dense results only add noise; the hover title still names every relationship.
  const showTypes = relationships.length <= 30;
  const showCaptions = nodes.length <= 150;

  const toSvg = (e: PointerEvent) => {
    const m = svg.current!.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: Math.max(10, Math.min(WIDTH - 10, p.x)), y: Math.max(10, Math.min(HEIGHT - 10, p.y)) };
  };

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-auto w-full touch-none select-none"
      role="group"
      aria-label={`Query result graph: ${nodes.length} nodes, ${relationships.length} relationships`}
      onPointerMove={(e) => {
        if (!drag.current) return;
        drag.current.dragged = true;
        const p = toSvg(e);
        setMoved((m) => new Map(m).set(drag.current!.id, p));
      }}
      onPointerUp={() => {
        wasDrag.current = drag.current?.dragged ?? false;
        drag.current = null;
      }}
      onPointerLeave={() => (drag.current = null)}
      onClick={(e) => e.target === svg.current && onSelect(undefined)}
    >
      <defs>
        <marker id="rel-arrow" viewBox="0 0 10 10" refX="21" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill={chrome.axis} />
        </marker>
      </defs>
      {relationships.map((r) => {
        const [a, b] = [at(r.start), at(r.end)];
        if (!a || !b) return null;
        const bend = bends.get(r.id) ?? 0;
        const [mx, my] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
        const len = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
        const [qx, qy] = [mx - ((b.y - a.y) / len) * bend, my + ((b.x - a.x) / len) * bend];
        return (
          <g key={r.id}>
            <path d={`M${a.x},${a.y} Q${qx},${qy} ${b.x},${b.y}`} fill="none" stroke={chrome.axis} strokeOpacity={0.7} strokeWidth={1.2} markerEnd="url(#rel-arrow)">
              <title>{r.type}</title>
            </path>
            {showTypes && (
              <text x={(mx + qx) / 2} y={(my + qy) / 2} textAnchor="middle" dominantBaseline="middle" fontSize={8.5} fill={chrome.text}
                stroke={chrome.surface} strokeWidth={3} paintOrder="stroke">
                {r.type}
              </text>
            )}
          </g>
        );
      })}
      {nodes.map((n) => {
        const p = at(n.id);
        const selected = n.id === selectedId;
        return (
          <g
            key={n.id}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`${n.labels.join(', ')} ${nodeCaption(n)}`}
            className="cursor-pointer focus:outline-none"
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture?.(e.pointerId);
              drag.current = { id: n.id, dragged: false };
            }}
            onClick={() => {
              if (!wasDrag.current) onSelect(n);
              wasDrag.current = false;
            }}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(n))}
          >
            <title>{`${n.labels.join(':')} ${nodeCaption(n)}`}</title>
            {selected && <circle cx={p.x} cy={p.y} r={16} fill="none" stroke={chrome.text} strokeWidth={2} />}
            <circle cx={p.x} cy={p.y} r={11} fill={labelColour(n.labels[0])} stroke={chrome.surface} strokeWidth={1.5} />
            {showCaptions && (
              <text x={p.x} y={p.y + 21} textAnchor="middle" fontSize={9.5} fontWeight={selected ? 700 : 500} fill={chrome.text}
                stroke={chrome.surface} strokeWidth={3} paintOrder="stroke">
                {nodeCaption(n).length > 22 ? `${nodeCaption(n).slice(0, 21)}…` : nodeCaption(n)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
