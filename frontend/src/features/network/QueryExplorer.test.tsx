import { describe, expect, it } from 'vitest';
import { forceLayout } from './forceLayout';
import { formatCell } from './QueryExplorer';

describe('forceLayout', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  const links = [
    { start: 'a', end: 'b' },
    { start: 'b', end: 'c' },
    { start: 'c', end: 'a' },
    { start: 'd', end: 'e' },
  ];

  it('places every node inside the frame, apart from each other, the same way every time', () => {
    const first = forceLayout({ nodes, links }, 800, 520);
    const again = forceLayout({ nodes, links }, 800, 520);
    expect([...first.keys()]).toEqual(['a', 'b', 'c', 'd', 'e']);
    for (const p of first.values()) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(800);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(520);
    }
    const pts = [...first.values()];
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(20);
    expect(again).toEqual(first);
  });

  it('keeps linked nodes closer than unlinked ones', () => {
    const p = forceLayout({ nodes, links }, 800, 520);
    const dist = (u: string, v: string) => Math.hypot(p.get(u)!.x - p.get(v)!.x, p.get(u)!.y - p.get(v)!.y);
    expect(dist('d', 'e')).toBeLessThan(dist('a', 'e'));
  });

  it('copes with empty, single-node and self-loop results', () => {
    expect(forceLayout({ nodes: [], links: [] }, 800, 520).size).toBe(0);
    expect(forceLayout({ nodes: [{ id: 'x' }], links: [{ start: 'x', end: 'x' }] }, 800, 520).get('x')).toEqual({ x: 400, y: 260 });
  });
});

describe('formatCell', () => {
  it('writes graph values in Cypher-like shorthand and plain values as they are', () => {
    // Shapes as /network/queries/run returns them.
    expect(formatCell({ node: '4:x:1', labels: ['Facility'], properties: { code: 'FAC-001', name: 'Bengaluru Central' } })).toBe('(:Facility FAC-001)');
    expect(formatCell({ relationship: '5:x:2', type: 'CAN_SUPPLY', properties: { km: 13.4 } })).toBe('[:CAN_SUPPLY]');
    expect(formatCell({ path: ['FAC-009', 'FAC-012', 'FAC-003'], length: 2 })).toBe('FAC-009 → FAC-012 → FAC-003');
    expect(formatCell([1, 'a', null])).toBe('[1, a, null]');
    expect(formatCell(47.7)).toBe('47.7');
    expect(formatCell({ supplier: 'FAC-012', km: 13.4 })).toBe('{"supplier":"FAC-012","km":13.4}');
  });
});
