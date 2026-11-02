import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type {
  CategoryStockPoint,
  ExpiryTrendPoint,
  InventoryDistributionPoint,
  MovementTrendPoint,
  ShortageRiskPoint,
  TransferStatsPoint,
} from '@/api/types';
import { fmtCompact, fmtMonth, fmtNumber } from '@/lib/format';
import { ChartTooltip, MiniTable } from './ChartCard';
import { axisProps, chrome, series, status } from './theme';

/* Each chart exports its plot plus the matching table view and legend. */

const shortName = (name: string) =>
  name
    .replace('Primary Health Centre', 'PHC')
    .replace('Community Health Centre', 'CHC')
    .replace('District Hospital', 'DH')
    .replace('General Hospital', 'GH')
    .replace('Regional Medical Stores', 'Medical Stores');

/* --------------------------- Inventory distribution --------------------------- */

export const inventoryLegend = [
  { label: 'Available', color: series.s1 },
  { label: 'Reserved for transfer', color: series.s2 },
  { label: 'Damaged', color: series.s3 },
];

export function InventoryDistributionChart({ data }: { data: InventoryDistributionPoint[] }) {
  const rows = data.map((d) => ({ ...d, short: shortName(d.facilityName) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap={6}>
        <CartesianGrid horizontal={false} stroke={chrome.grid} />
        <XAxis type="number" {...axisProps} tickFormatter={fmtCompact} />
        <YAxis type="category" dataKey="short" {...axisProps} axisLine={false} width={150} interval={0} />
        <Tooltip cursor={{ fill: chrome.cursor }} content={<ChartTooltip />} />
        <Bar isAnimationActive={false} dataKey="available" name="Available" stackId="s" fill={series.s1} stroke={chrome.surface} strokeWidth={1} />
        <Bar isAnimationActive={false} dataKey="reserved" name="Reserved for transfer" stackId="s" fill={series.s2} stroke={chrome.surface} strokeWidth={1} />
        <Bar isAnimationActive={false} dataKey="damaged" name="Damaged" stackId="s" fill={series.s3} stroke={chrome.surface} strokeWidth={1} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export const InventoryDistributionTable = ({ data }: { data: InventoryDistributionPoint[] }) => (
  <MiniTable
    head={['Facility', 'Available', 'Reserved', 'Damaged']}
    rows={data.map((d) => [d.facilityName, fmtNumber(d.available), fmtNumber(d.reserved), fmtNumber(d.damaged)])}
  />
);

/* -------------------------------- Expiry trend -------------------------------- */

export function ExpiryTrendChart({ data }: { data: ExpiryTrendPoint[] }) {
  const thisMonth = new Date().toISOString().slice(0, 7);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke={chrome.grid} />
        <XAxis dataKey="month" {...axisProps} tickFormatter={fmtMonth} />
        <YAxis {...axisProps} axisLine={false} tickFormatter={fmtCompact} width={44} />
        <Tooltip
          cursor={{ fill: chrome.cursor }}
          content={<ChartTooltip labelFormatter={(m) => `${fmtMonth(m)}${m < thisMonth ? ' (already expired)' : ''}`} />}
        />
        <Bar isAnimationActive={false} dataKey="units" name="Units expiring" radius={[4, 4, 0, 0]}>
          {/* Past months are de-emphasised; the label in the tooltip and table explains why. */}
          {data.map((d) => (
            <Cell key={d.month} fill={series.s1} fillOpacity={d.month < thisMonth ? 0.35 : 1} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export const ExpiryTrendTable = ({ data }: { data: ExpiryTrendPoint[] }) => (
  <MiniTable head={['Month', 'Batches', 'Units']} rows={data.map((d) => [fmtMonth(d.month), d.batches, fmtNumber(d.units)])} />
);

/* -------------------------------- Shortage risk ------------------------------- */

export const shortageLegend = [
  { label: 'Facilities at critical level', color: status.critical },
  { label: 'Facilities below reorder level', color: status.warning },
];

export function ShortageRiskChart({ data }: { data: ShortageRiskPoint[] }) {
  const rows = data.map((d) => ({ ...d, low: d.facilitiesAffected - d.criticalCount }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap={6}>
        <CartesianGrid horizontal={false} stroke={chrome.grid} />
        <XAxis type="number" allowDecimals={false} {...axisProps} />
        <YAxis type="category" dataKey="medicineName" {...axisProps} axisLine={false} width={160} interval={0} />
        <Tooltip cursor={{ fill: chrome.cursor }} content={<ChartTooltip />} />
        <Bar isAnimationActive={false} dataKey="criticalCount" name="Critical" stackId="s" fill={status.critical} stroke={chrome.surface} strokeWidth={1} />
        <Bar isAnimationActive={false} dataKey="low" name="Low stock" stackId="s" fill={status.warning} stroke={chrome.surface} strokeWidth={1} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export const ShortageRiskTable = ({ data }: { data: ShortageRiskPoint[] }) => (
  <MiniTable
    head={['Medicine', 'Critical', 'Affected facilities', 'Min. days left']}
    rows={data.map((d) => [d.medicineName, d.criticalCount, d.facilitiesAffected, d.minDaysRemaining ?? '—'])}
  />
);

/* ------------------------------- Transfer volume ------------------------------ */

export const transferLegend = [
  { label: 'Requested', color: series.s1 },
  { label: 'Received', color: series.s2 },
  { label: 'Rejected', color: series.s3 },
];

export function TransferVolumeChart({ data }: { data: TransferStatsPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="24%">
        <CartesianGrid vertical={false} stroke={chrome.grid} />
        <XAxis dataKey="month" {...axisProps} tickFormatter={fmtMonth} />
        <YAxis {...axisProps} axisLine={false} allowDecimals={false} width={32} />
        <Tooltip cursor={{ fill: chrome.cursor }} content={<ChartTooltip labelFormatter={fmtMonth} />} />
        <Bar isAnimationActive={false} dataKey="requested" name="Requested" fill={series.s1} radius={[4, 4, 0, 0]} />
        <Bar isAnimationActive={false} dataKey="received" name="Received" fill={series.s2} radius={[4, 4, 0, 0]} />
        <Bar isAnimationActive={false} dataKey="rejected" name="Rejected" fill={series.s3} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export const TransferVolumeTable = ({ data }: { data: TransferStatsPoint[] }) => (
  <MiniTable head={['Month', 'Requested', 'Received', 'Rejected']} rows={data.map((d) => [fmtMonth(d.month), d.requested, d.received, d.rejected])} />
);

/* ------------------------------- Movement trend ------------------------------- */

export const movementLegend = [
  { label: 'Inbound (receipts + transfers in)', color: series.s1 },
  { label: 'Outbound (dispensed + transfers out)', color: series.s2 },
  { label: 'Losses (damage + write-off)', color: series.s3 },
];

export function MovementTrendChart({ data }: { data: MovementTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={chrome.grid} />
        <XAxis dataKey="month" {...axisProps} tickFormatter={fmtMonth} />
        <YAxis {...axisProps} axisLine={false} tickFormatter={fmtCompact} width={44} />
        <Tooltip cursor={{ stroke: chrome.axis, strokeDasharray: '3 3' }} content={<ChartTooltip labelFormatter={fmtMonth} />} />
        {(['inbound', 'outbound', 'losses'] as const).map((k, i) => (
          <Line isAnimationActive={false}
            key={k}
            type="monotone"
            dataKey={k}
            name={['Inbound', 'Outbound', 'Losses'][i]}
            stroke={[series.s1, series.s2, series.s3][i]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: chrome.surface }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export const MovementTrendTable = ({ data }: { data: MovementTrendPoint[] }) => (
  <MiniTable
    head={['Month', 'Inbound', 'Outbound', 'Losses']}
    rows={data.map((d) => [fmtMonth(d.month), fmtNumber(d.inbound), fmtNumber(d.outbound), fmtNumber(d.losses)])}
  />
);

/* ------------------------------ Stock by category ----------------------------- */

export function CategoryStockChart({ data }: { data: CategoryStockPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap={5}>
        <CartesianGrid horizontal={false} stroke={chrome.grid} />
        <XAxis type="number" {...axisProps} tickFormatter={fmtCompact} />
        <YAxis type="category" dataKey="category" {...axisProps} axisLine={false} width={130} interval={0} />
        <Tooltip cursor={{ fill: chrome.cursor }} content={<ChartTooltip />} />
        <Bar isAnimationActive={false} dataKey="units" name="Units in stock" fill={series.s1} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export const CategoryStockTable = ({ data }: { data: CategoryStockPoint[] }) => (
  <MiniTable head={['Category', 'Units']} rows={data.map((d) => [d.category, fmtNumber(d.units)])} />
);
