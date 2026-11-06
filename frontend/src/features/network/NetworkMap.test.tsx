import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { NetworkFacility, NetworkGraph } from '@/api/types';
import { NetworkMap } from './NetworkMap';

const facility = (id: number, lat: number, lon: number, critical: number | null = 0): NetworkFacility => ({
  id,
  code: `FAC-00${id}`,
  name: `Facility ${id}`,
  type: 'HOSPITAL',
  lat,
  lon,
  coldChain: false,
  radiusKm: 100,
  active: true,
  organizationId: 1,
  regionName: 'Bengaluru Urban',
  suppliers: 1,
  canSupply: 1,
  criticalShortages: critical,
  lowShortages: 0,
});

/** Shaped like a real /network/graph response: 1 ↔ 2 both ways, 3 → 1 one way only. */
const graph: NetworkGraph = {
  syncedAt: '2026-11-06T04:16:08.251Z',
  source: 'medshare',
  facilities: [facility(1, 12.97, 77.59, 2), facility(2, 13.1, 77.6), facility(3, 12.3, 76.65, null)],
  organisations: [{ id: 1, name: 'Deccan Public Health Network (Synthetic)', type: 'PUBLIC_HEALTH_AUTHORITY' }],
  supplyLinks: [
    { source: 1, destination: 2, km: 18.7, sameOrg: true },
    { source: 2, destination: 1, km: 18.7, sameOrg: true },
    { source: 3, destination: 1, km: 166.4, sameOrg: true },
  ],
  roads: [
    { a: 1, b: 2, km: 18.7 },
    { a: 1, b: 3, km: 166.4 },
    { a: 2, b: 3, km: 180.2 },
  ],
  corridors: [{ source: 3, destination: 1, transfers: 2, units: 500, lastReceivedAt: '2026-10-01T10:00:00+05:30' }],
};

describe('NetworkMap', () => {
  it('draws every facility as a selectable node and reports the choice', () => {
    const onSelect = vi.fn();
    render(<NetworkMap graph={graph} layer="supply" onSelect={onSelect} />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: /FAC-002/ }));
    fireEvent.keyDown(screen.getByRole('button', { name: /FAC-003/ }), { key: 'Enter' });
    expect(onSelect.mock.calls).toEqual([[2], [3]]);
  });

  it('labels the selected facility\'s supply links with their distance and dashes one-way links', () => {
    const { container } = render(<NetworkMap graph={graph} layer="supply" selectedId={1} onSelect={() => {}} />);
    expect(screen.getByText('18.7 km')).toBeInTheDocument();
    expect(screen.getByText('166.4 km')).toBeInTheDocument();
    const dashed = [...container.querySelectorAll('line')].filter((l) => l.getAttribute('stroke-dasharray'));
    expect(dashed).toHaveLength(1); // only 3 → 1 is one way
    expect(screen.getByRole('button', { name: /FAC-001/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows routed distances from the selected facility on the distances layer', () => {
    render(<NetworkMap graph={graph} layer="distances" selectedId={2} onSelect={() => {}} />);
    expect(screen.getByText('18.7')).toBeInTheDocument();
    expect(screen.getByText('180.2')).toBeInTheDocument();
    expect(screen.queryByText('166.4')).not.toBeInTheDocument(); // a pair not touching FAC-002
  });

  it('rings only facilities with a known critical shortage (null = outside the user\'s scope)', () => {
    const { container } = render(<NetworkMap graph={graph} layer="corridors" onSelect={() => {}} />);
    const rings = [...container.querySelectorAll('circle')].filter((c) => c.getAttribute('fill') === 'none');
    expect(rings).toHaveLength(1);
  });
});
