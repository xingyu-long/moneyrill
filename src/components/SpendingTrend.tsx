import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApp } from '../state/AppContext.tsx';
import { useReport } from '../state/useReport.ts';
import { cash, isPrivate } from '../lib/format.ts';
import { todayIso } from '../lib/calendar.ts';
import { DEFAULT_DATE } from '../lib/reportDates.ts';
import { reportUrl } from '../lib/routes.ts';
import {
  COMPARE_MODES,
  buildComparison,
  comparisonPlan,
  type CompareMode,
} from '../lib/spendingCompare.ts';
import type { CashFlowReport } from '../types.ts';
import { tooltipStyle } from './chartStyle.ts';
import { Note, Tile } from './HomeParts.tsx';
import { Select } from './ui/select.tsx';

const THIS: Record<CompareMode, string> = {
  week: 'this week',
  month: 'this month',
  'month-year': 'this month',
  average: 'this month',
  year: 'this year',
};
const UNIT: Record<CompareMode, string> = {
  week: 'last week',
  month: 'last month',
  'month-year': 'the same month last year',
  average: 'the average month',
  year: 'last year',
};

/** Home's Spending module: money out so far this period against another, as running totals. */
export function SpendingTrend() {
  const { data, homeLayout, setHomeLayout } = useApp();
  const mode = homeLayout.compare;
  const today = todayIso();
  const plan = comparisonPlan(mode, today);
  const {
    data: report,
    loading,
    error,
  } = useReport<CashFlowReport>('cash-flow', { ...plan, today }, data);
  const result = report ? buildComparison(mode, today, report.series) : null;
  const diff = result ? result.current.minus(result.previousSoFar) : null;
  // The card's link is the full Spending report, over the default range (this year).
  const spendingReport = reportUrl({
    date: DEFAULT_DATE,
    categories: [],
    accounts: [],
    view: 'sub',
    sub: 'Spending',
  });
  return (
    <Tile
      title="Spending"
      to="Reports"
      label="Spending"
      href={spendingReport}
      className="min-[641px]:col-span-2 min-[1101px]:col-span-8"
      extra={
        <Select
          aria-label="Compare spending"
          value={mode}
          onChange={(e) => setHomeLayout({ ...homeLayout, compare: e.target.value as CompareMode })}
        >
          {COMPARE_MODES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      }
    >
      {!result ? (
        <Note>{error || (loading ? 'Loading…' : '')}</Note>
      ) : (
        <>
          <div>
            <div className="my-1 font-serif text-[40px] leading-none tabular-nums max-[640px]:text-[34px]">
              {cash(result.current.toNumber())}
            </div>
            <div className="text-[11px] text-muted-foreground">
              spent {THIS[mode]}
              {result.any && diff && !isPrivate() && !diff.isZero()
                ? ` · ${cash(diff.abs().toNumber())} ${diff.gt(0) ? 'more' : 'less'} than ${UNIT[mode]} by now`
                : ''}
            </div>
          </div>
          {!result.any ? (
            <Note>No spending recorded in this comparison yet.</Note>
          ) : (
            <div role="img" aria-label={`Spending ${THIS[mode]} against ${UNIT[mode]}`}>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={result.rows} margin={{ top: 20, right: 10, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-fill)" />
                      <stop offset="100%" stopColor="var(--chart-fill)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    stroke="var(--chart-grid)"
                    vertical={false}
                    strokeDasharray="3 5"
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
                    minTickGap={24}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => (isPrivate() ? '' : cash(v, true))}
                    tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
                    width={65}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    itemStyle={{ color: 'var(--tip-text)' }}
                    formatter={(v: any, name: any) => [cash(Number(v)), name]}
                  />
                  <Area
                    name={result.previousLabel}
                    dataKey="previous"
                    type="monotone"
                    stroke="var(--chart-tick)"
                    strokeWidth={2}
                    fill="none"
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                  <Area
                    name={result.currentLabel}
                    dataKey="current"
                    type="monotone"
                    stroke="var(--chart-line)"
                    strokeWidth={2}
                    fill="url(#spendFill)"
                    dot={false}
                    activeDot={{ r: 4 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="m-0 mt-auto flex justify-center gap-4 pt-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <i className="block h-0.5 w-3 bg-[var(--chart-tick)]" /> {result.previousLabel}
            </span>
            <span className="flex items-center gap-1.5 text-positive">
              <i className="block h-0.5 w-3 bg-positive" /> {result.currentLabel}
            </span>
          </p>
        </>
      )}
    </Tile>
  );
}
