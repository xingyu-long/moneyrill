import { api } from '../api.ts';
import { tooltipStyle } from './chartStyle.ts';
import { cash, dateLabel, dateLabelYear, isPrivate, percent } from '../lib/format.ts';
import { ArrowDownRight, ArrowUpRight, Layers } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '../lib/cn.ts';
import { useApp } from '../state/AppContext.tsx';
import { Button } from './ui/button.tsx';
import { Segmented } from './ui/segmented.tsx';
import { Th } from './ui/table.tsx';

export function Trend({
  value,
  amount,
  className,
}: {
  value: number | null;
  amount?: number | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[3px] text-[11px]',
        className,
        value === null ? 'text-muted-foreground' : value < 0 ? 'text-destructive' : 'text-positive',
      )}
    >
      {value !== null && (value < 0 ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />)}
      {amount !== undefined && amount !== null && !isPrivate() ? cash(Math.abs(amount)) + ' ' : ''}
      {value === null ? 'Not enough history' : percent(value)}
    </span>
  );
}

const PERIODS = ['1M', '2M', '3M', '6M', 'YTD', '1Y', 'ALL'] as const;

/** The chart period for the current page (Investments keeps its own). */
export function Range({
  options = PERIODS,
  soft = false,
}: {
  options?: readonly string[];
  soft?: boolean;
}) {
  const { activePeriod, setHomePeriod, setInvestmentPeriod, setPeriod, tab } = useApp();
  return (
    <Segmented
      label="Chart range"
      tone={soft ? 'soft' : 'default'}
      options={options}
      value={activePeriod}
      onChange={
        tab === 'Investments' ? setInvestmentPeriod : tab === 'Home' ? setHomePeriod : setPeriod
      }
      render={(p) => (p === 'ALL' ? 'All' : p)}
    />
  );
}

/**
 * `bare` is the Home hero's chart: just the line and its fill (no axes or grid), edge to edge, with the hover tooltip.
 * Its bottom margin keeps the line clear of the cards that overlap the chart's lower edge.
 */
export function Chart({
  points,
  small = false,
  bare = false,
}: {
  points?: any[];
  small?: boolean;
  bare?: boolean;
}) {
  const { chart } = useApp();
  const series = points ?? chart;
  const fill = bare ? 'bareFill' : small ? 'smallFill' : 'chartFill';
  return (
    <ResponsiveContainer width="100%" height={bare ? 280 : small ? 180 : 290}>
      <AreaChart
        data={series}
        margin={
          bare
            ? { top: 10, right: 0, bottom: 56, left: 0 }
            : { top: 20, right: 10, bottom: 0, left: 0 }
        }
      >
        <defs>
          <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-fill)" />
            <stop offset="100%" stopColor="var(--chart-fill)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {!bare && (
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} strokeDasharray="3 5" />
        )}
        <XAxis
          dataKey="date"
          hide={bare}
          tickFormatter={dateLabel}
          tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
          minTickGap={50}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          hide={bare}
          tickFormatter={(v) => (isPrivate() ? '' : cash(v, true))}
          tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
          width={65}
          axisLine={false}
          tickLine={false}
          domain={['auto', 'auto']}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelFormatter={(v) => dateLabelYear(String(v))}
          formatter={(v: any) => cash(Number(v))}
        />
        <Area
          type="monotone"
          dataKey="value"
          name="Balance"
          dot={false}
          activeDot={{ r: 4 }}
          stroke="var(--chart-line)"
          strokeWidth={bare ? 2.5 : 2}
          fill={`url(#${fill})`}
          connectNulls={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function Empty({ text }: { text: string }) {
  const { action, base, busy, data, dataset, production } = useApp();
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-11 text-center text-muted-foreground">
      <Layers size={28} />
      <h3 className="m-0 text-[15px] font-medium text-foreground">
        {text.includes('snapshot') || text.includes('comparison')
          ? 'Waiting for history'
          : 'No data here yet'}
      </h3>
      <p className="m-0 max-w-[440px] text-xs">{text}</p>
      {!production && dataset !== 'simulated' && base.length === 0 && (
        <Button
          className="mt-2.5"
          disabled={busy || !data.hasPlaidKeys}
          onClick={() => action(() => api('/sandbox-samples', {}), 'Sandbox samples loaded')}
        >
          Load sandbox samples
        </Button>
      )}
    </div>
  );
}

export function SortHead({
  k,
  label,
  className,
}: {
  k: string;
  label: string;
  className?: string;
}) {
  const { holdingSort, sortBy } = useApp();
  const active = holdingSort.key === k;
  return (
    <Th
      className={className}
      aria-sort={active ? (holdingSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        className={cn('inline-flex items-center gap-1.5', active && 'text-foreground')}
        onClick={() => sortBy(k)}
      >
        {label}
        {active && (
          <span aria-hidden="true" className="text-[9px]">
            {holdingSort.dir === 'asc' ? '▲' : '▼'}
          </span>
        )}
      </button>
    </Th>
  );
}
