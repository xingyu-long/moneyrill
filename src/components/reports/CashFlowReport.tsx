import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Bar, Cell, ComposedChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { cash } from '../../lib/format.ts';
import { rangeLabel } from '../../lib/reportDates.ts';
import { bestPeriodSentence } from '../../lib/summary.ts';
import { linkClick } from '../../state/router.ts';
import { Words } from '../Words.tsx';
import { chartRows, downloadCsv, periodLabel, periodOf, toCsv } from '../../lib/reports.ts';
import { useReport } from '../../state/useReport.ts';
import type { CashFlowReport as Report, ReportCategory, ReportSlice } from '../../types.ts';
import { tooltipStyle } from '../chartStyle.ts';
import { scopeParams, type Scope } from './scope.ts';
import { Button } from '../ui/button.tsx';
import { Card } from '../ui/card.tsx';
import { Select } from '../ui/select.tsx';
import { cn } from '../../lib/cn.ts';
import { ReportCard } from './parts.tsx';
import { EMPTY, HINT } from './styles.ts';

type Interval = 'month' | 'quarter' | 'year';
const INTERVALS: [Interval, string][] = [
  ['month', 'Monthly'],
  ['quarter', 'Quarterly'],
  ['year', 'Yearly'],
];
/** How many categories a breakdown shows before "Show all". */
const TOP = 6;
const GREEN = 'var(--income)';
const RED = 'var(--expense)';

const rate = (r: number | null) => (r === null ? '—' : `${r}%`);

function Bars({
  slices,
  tone,
  onOpen,
}: {
  slices: ReportSlice[];
  tone: 'income' | 'expense';
  onOpen: (c: ReportCategory) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? slices : slices.slice(0, TOP);
  const max = Math.max(...slices.map((s) => Number(s.amount)), 0);
  const color = tone === 'income' ? 'var(--income)' : 'var(--expense)';
  return (
    <div className="grid gap-1">
      {shown.map((s) => (
        <button
          key={s.category.id}
          className="grid w-full grid-cols-[38px_1fr_auto] items-center gap-x-3 rounded-2xl px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
          title="Show this category month by month"
          onClick={() => onOpen(s.category)}
        >
          <span
            aria-hidden="true"
            className="grid size-[38px] place-items-center rounded-full text-[17px]"
            style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}
          >
            {s.category.emoji}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px]">{s.category.name}</span>
            <span className="mt-1.5 block h-[5px] overflow-hidden rounded-full bg-muted">
              <i
                className="block h-full rounded-full"
                style={{
                  width: max > 0 ? `${Math.max(0, (Number(s.amount) / max) * 100)}%` : 0,
                  background: color,
                }}
              />
            </span>
          </span>
          <span className="tabular-nums">
            {cash(Number(s.amount))} <small className="text-muted-foreground">({s.share}%)</small>
          </span>
        </button>
      ))}
      {slices.length > TOP && (
        <button
          className="justify-self-start px-2 pt-1 text-xs text-positive hover:underline"
          onClick={() => setAll(!all)}
        >
          {all ? 'Show fewer' : `Show all ${slices.length}`}
        </button>
      )}
    </div>
  );
}

export function CashFlowReport({
  scope,
  refreshKey,
  production,
  onOpenCategory,
  reportHref,
}: {
  scope: Scope;
  refreshKey: unknown;
  production: boolean;
  /** Where the full Spending or Income report is, for the link in each breakdown card. */
  reportHref: (sub: 'Spending' | 'Income') => string;
  /** Clicking a category in the breakdown opens its own history. */
  onOpenCategory: (
    category: ReportCategory,
    type: 'income' | 'expense',
    /** What the chart was showing, so the category opens on the same period. */
    shown: { interval: Interval; period?: string },
  ) => void;
}) {
  const [interval, setInterval] = useState<Interval>('month');
  // The breakdown opens on the month (quarter, year) holding today when the range reaches it; a bar or the period
  // menu picks another, or the whole range. undefined = not chosen yet.
  const [choice, setPicked] = useState<{ start: string; end: string } | null | undefined>(
    undefined,
  );
  const base = scopeParams(scope);
  const scopeKey = JSON.stringify(base);
  useEffect(() => setPicked(undefined), [scopeKey, interval]);
  const now = scope.today ? periodOf(scope.today, interval) : null;
  const picked =
    choice !== undefined
      ? choice
      : now && now.end >= (scope.from ?? '') && now.start <= (scope.to ?? scope.today ?? '')
        ? now
        : null;
  // A picked period is cut to the chosen range (the first and last periods may stick out of it).
  const bFrom = picked && scope.from && scope.from > picked.start ? scope.from : picked?.start;
  const bTo = picked && scope.to && scope.to < picked.end ? scope.to : picked?.end;
  const { data, loading, error } = useReport<Report>(
    'cash-flow',
    { ...base, interval, breakdownFrom: bFrom, breakdownTo: bTo },
    refreshKey,
  );
  if (error && !data) return <p className={EMPTY}>{error}</p>;
  if (!data) return <p className={EMPTY}>{loading ? 'Loading…' : ''}</p>;
  const filtered = !!(scope.categories.length || scope.accounts.length);
  if (!data.first_date)
    return (
      <ReportCard>
        <p className={EMPTY}>
          {filtered
            ? 'No income or spending matches these filters.'
            : scope.from || scope.to
              ? 'No income or spending in this date range. Choose another range (Clear shows all time).'
              : production
                ? 'No transactions yet. Reports appear after a bank or card account syncs, or after the Monarch import.'
                : 'No transactions yet. Load the sandbox samples in Settings, then sync.'}
        </p>
      </ReportCard>
    );
  const rows = chartRows(data.series, interval).map((r) => ({
    ...r,
    expenses: Math.abs(r.expenses),
  }));
  const pickedIndex = picked ? data.series.findIndex((p) => p.start === picked.start) : -1;
  const periodName = (p: { start: string }) => periodLabel(p, interval, true);
  const intervalWord = interval === 'month' ? 'month' : interval === 'quarter' ? 'quarter' : 'year';
  const finished = data.series.filter((p) => !p.partial);
  const best = finished.reduce<(typeof finished)[number] | null>(
    (b, p) => (!b || Number(p.net) > Number(b.net) ? p : b),
    null,
  );
  const bestName = best
    ? interval === 'month'
      ? new Date(best.start + 'T12:00:00Z').toLocaleDateString('en-US', {
          month: 'long',
          timeZone: 'UTC',
        })
      : periodName(best)
    : '';
  const tiles: [string, string, string][] = [
    [cash(Number(data.totals.income)), 'Total income', 'income'],
    [cash(Number(data.totals.expenses)), 'Total expenses', 'expense'],
    [cash(Number(data.totals.net)), 'Total net income', ''],
    [rate(data.totals.savings_rate), 'Savings rate', ''],
  ];
  const wholeLabel = rangeLabel(data.breakdown.from, data.breakdown.to);
  // "this month" for the current period, its name for another
  const isNow = !!picked && !!now && picked.start === now.start;
  const when = picked ? (isNow ? `this ${intervalWord}` : `in ${periodName(picked)}`) : '';
  const open = (sub: 'Spending' | 'Income') => (
    <a
      href={reportHref(sub)}
      className="text-xs text-positive hover:underline"
      onClick={(e) => linkClick(e, reportHref(sub))}
    >
      Open {sub} →
    </a>
  );
  return (
    <>
      <ReportCard label="Cash flow trend" className="px-8 py-7 max-[760px]:px-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2.5 text-xs text-muted-foreground">
          <span>
            Income and expenses · {INTERVALS.find(([v]) => v === interval)?.[1].toLowerCase()}
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5">
              <i className="size-2.5 rounded-[3px]" style={{ background: GREEN }} /> Income
            </span>
            <span className="flex items-center gap-1.5">
              <i className="size-2.5 rounded-[3px]" style={{ background: RED }} /> Expenses
            </span>
            <Select
              aria-label="Interval"
              value={interval}
              onChange={(e) => setInterval(e.target.value as Interval)}
            >
              {INTERVALS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
            <Button
              variant="outline"
              title="Download the periods as a CSV file"
              onClick={() =>
                downloadCsv(
                  'cash-flow.csv',
                  toCsv(
                    ['Period start', 'Period end', 'Income', 'Expenses', 'Net'],
                    data.series.map((p) => [p.start, p.end, p.income, p.expenses, p.net]),
                  ),
                )
              }
            >
              <Download size={14} /> CSV
            </Button>
          </div>
        </div>
        <div role="img" aria-label="Income and expenses per period">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart
              data={rows}
              margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
              barGap={4}
              barCategoryGap="18%"
            >
              <XAxis
                dataKey="label"
                tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                minTickGap={16}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: 'var(--chart-cursor)' }}
                formatter={(v: any, name: any) => [cash(Math.abs(Number(v))), name]}
              />
              {(['income', 'expenses'] as const).map((key) => (
                <Bar
                  key={key}
                  dataKey={key}
                  name={key === 'income' ? 'Income' : 'Expenses'}
                  fill={key === 'income' ? GREEN : RED}
                  radius={[7, 7, 2, 2]}
                  isAnimationActive={false}
                  cursor="pointer"
                  onClick={(_: any, i: number) => {
                    const p = rows[i];
                    setPicked(picked?.start === p.start ? null : { start: p.start, end: p.end });
                  }}
                >
                  {rows.map((r, i) => (
                    <Cell
                      key={r.start}
                      // the chosen period, or the latest one when none is chosen, stands out
                      fillOpacity={
                        (picked ? picked.start === r.start : i === rows.length - 1) ? 1 : 0.5
                      }
                    />
                  ))}
                </Bar>
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ReportCard>
      <div className="rpt-tiles mb-3.5 grid grid-cols-4 gap-3.5 max-[760px]:grid-cols-2">
        {tiles.map(([value, label, tone]) => (
          <Card key={label} className="rpt-tile grid gap-2 px-5 py-5">
            <span className="text-xs tracking-[0.04em] text-muted-foreground">{label}</span>
            <strong
              className={cn(
                'font-serif text-[36px] font-normal leading-none tabular-nums',
                tone === 'income' && 'text-positive',
                tone === 'expense' && 'text-destructive',
              )}
            >
              {value}
            </strong>
          </Card>
        ))}
      </div>
      <div className="mb-2 flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
        {wholeLabel}
        <Select
          aria-label="Breakdown period"
          value={picked?.start ?? ''}
          onChange={(e) => {
            const p = data.series.find((x) => x.start === e.target.value);
            setPicked(p ? { start: p.start, end: p.end } : null);
          }}
        >
          <option value="">Whole range</option>
          {data.series.map((p) => (
            <option key={p.start} value={p.start}>
              {periodName(p)}
            </option>
          ))}
        </Select>
        {picked && (
          <Button
            variant="outline"
            aria-label="Show the whole range"
            onClick={() => setPicked(null)}
          >
            {rangeLabel(data.breakdown.from, data.breakdown.to)} <X size={12} />
          </Button>
        )}
      </div>
      <div className="grid items-start gap-3.5 min-[761px]:grid-cols-2 [&>*]:mb-0">
        <ReportCard label="Spending breakdown" className="gap-0">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Spending by category</span>
            {open('Spending')}
          </div>
          <h2 className="m-0 mb-3 mt-1 font-serif text-2xl font-normal">
            {when ? `Where it went ${when}` : 'Where it went'}
          </h2>
          {data.breakdown.expenses.length ? (
            <Bars
              slices={data.breakdown.expenses}
              tone="expense"
              onOpen={(c) => onOpenCategory(c, 'expense', { interval, period: picked?.start })}
            />
          ) : (
            <p className={HINT}>No expenses in this period.</p>
          )}
        </ReportCard>
        <ReportCard label="Income breakdown" className="gap-0">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Income by source</span>
            {open('Income')}
          </div>
          <h2 className="m-0 mb-3 mt-1 font-serif text-2xl font-normal">
            {when ? `Where it came from ${when}` : 'Where it came from'}
          </h2>
          {data.breakdown.income.length ? (
            <Bars
              slices={data.breakdown.income}
              tone="income"
              onOpen={(c) => onOpenCategory(c, 'income', { interval, period: picked?.start })}
            />
          ) : (
            <p className={HINT}>No income in this period.</p>
          )}
          {best && (
            <p className="m-0 mt-4 font-serif text-xl leading-[1.3] text-muted-foreground">
              <Words
                sentence={bestPeriodSentence({
                  unit: intervalWord,
                  name: bestName,
                  kept: Number(best.net),
                })}
              />
            </p>
          )}
        </ReportCard>
      </div>
      {data.skipped_non_usd > 0 && (
        <p className={HINT}>
          {data.skipped_non_usd} transaction{data.skipped_non_usd === 1 ? '' : 's'} in another
          currency {data.skipped_non_usd === 1 ? 'is' : 'are'} not included.
        </p>
      )}
      {pickedIndex >= 0 && (
        <span className="sr-only">Showing {periodName(data.series[pickedIndex])}</span>
      )}
    </>
  );
}
