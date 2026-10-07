import { Download } from 'lucide-react';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { cash, isPrivate } from '../../lib/format.ts';
import { averageOf, downloadCsv, historyRows, periodTitle, toCsv } from '../../lib/reports.ts';
import { useReport } from '../../state/useReport.ts';
import type { CashFlowReport, Category, CategoryReport, ReportPeriod } from '../../types.ts';
import type { Interval } from '../../lib/routes.ts';
import { tooltipStyle } from '../chartStyle.ts';
import { CategorySummary, ReportCard, ReportTransactions } from './parts.tsx';
import { Button } from '../ui/button.tsx';
import { Segmented } from '../ui/segmented.tsx';
import { Select } from '../ui/select.tsx';
import { EMPTY, HINT, SPLIT } from './styles.ts';
import { scopeParams, type Scope } from './scope.ts';

const INTERVALS: [Interval, string][] = [
  ['month', 'Monthly'],
  ['quarter', 'Quarterly'],
  ['year', 'Yearly'],
];

/** What a history page is about: one category, or one merchant (whose money may come in or go out). */
export type Subject = { name: string; emoji?: string; categoryId?: number; merchant?: string };

/** The scope narrowed to the subject: a category replaces the category filter; a merchant adds to it. */
const narrow = (scope: Scope, subject: Subject): Scope => ({
  ...scope,
  ...(subject.categoryId ? { categories: [subject.categoryId] } : {}),
  ...(subject.merchant ? { merchant: subject.merchant } : {}),
});

/** One period of the history: its transactions and summary, cut to the chosen date range. */
function PeriodDetail({
  period,
  label,
  subject,
  type,
  scope,
  categories,
  refreshKey,
  onChanged,
}: {
  period: ReportPeriod;
  label: string;
  subject: Subject;
  type: 'income' | 'expense';
  scope: Scope;
  categories: Category[];
  refreshKey: unknown;
  onChanged: () => void;
}) {
  const from = scope.from && scope.from > period.start ? scope.from : period.start;
  const to = scope.to && scope.to < period.end ? scope.to : period.end;
  const only = narrow({ ...scope, from, to }, subject);
  const summary = useReport<CategoryReport>(
    'categories',
    { ...scopeParams(only), type },
    refreshKey,
  );
  return (
    <>
      <h2 className="mb-3 mt-1 font-serif text-[32px] font-normal">{label}</h2>
      <div className={SPLIT}>
        <ReportTransactions
          filters={{
            from,
            to,
            type,
            categories: only.categories,
            accounts: scope.accounts,
            merchant: only.merchant,
          }}
          categories={categories}
          refreshKey={refreshKey}
          onChanged={onChanged}
        />
        {summary.data ? (
          <CategorySummary type={type} report={summary.data} title={label} />
        ) : (
          <ReportCard label="Summary">
            <p className={HINT}>{summary.error || 'Loading…'}</p>
          </ReportCard>
        )}
      </div>
    </>
  );
}

/** One category or merchant, period by period: a bar per month (or quarter, or year), then the chosen period's detail. */
export function History({
  subject,
  type,
  scope,
  categories,
  refreshKey,
  onChanged,
  interval,
  period: picked,
  onInterval,
  onPeriod,
  onType,
}: {
  subject: Subject;
  type: 'income' | 'expense';
  scope: Scope;
  categories: Category[];
  refreshKey: unknown;
  onChanged: () => void;
  interval: Interval;
  /** Start of the chosen period (from the address); none = the latest with activity. */
  period?: string;
  onInterval: (i: Interval) => void;
  onPeriod: (start: string) => void;
  /** A merchant can be spending or income; a category is one or the other. */
  onType?: (type: 'income' | 'expense') => void;
}) {
  const only = narrow(scope, subject);
  const params = { ...scopeParams(only), interval };
  const { data, loading, error } = useReport<CashFlowReport>('cash-flow', params, refreshKey);
  if (error && !data) return <p className={EMPTY}>{error}</p>;
  if (!data) return <p className={EMPTY}>{loading ? 'Loading…' : ''}</p>;
  const rows = historyRows(data.series, type, interval);
  const typeToggle = onType && (
    <Segmented
      label="Kind"
      options={['expense', 'income'] as const}
      value={type}
      onChange={onType}
      render={(t) => (t === 'expense' ? 'Spending' : 'Income')}
    />
  );
  if (!rows.length)
    return (
      <ReportCard title={subject.name} tools={typeToggle}>
        <p className={EMPTY}>
          No {type === 'expense' ? 'spending' : 'income'} in {subject.name} for this range
          {subject.merchant ? ' (transfers are not counted)' : ''}.
        </p>
      </ReportCard>
    );
  // Until a bar is chosen, show the latest period that has something in it.
  const chosen =
    rows.find((r) => r.start === picked) ??
    [...rows].reverse().find((r) => r.amount !== 0) ??
    rows[rows.length - 1];
  const period = data.series.find((p) => p.start === chosen.start)!;
  const color = type === 'expense' ? 'var(--expense)' : 'var(--income)';
  const average = averageOf(rows);
  return (
    <>
      <ReportCard
        label={`${subject.name} by period`}
        title={[subject.emoji, subject.name].filter(Boolean).join(' ')}
        tools={
          <>
            {typeToggle}
            <Segmented
              label="Interval"
              options={INTERVALS.map(([v]) => v)}
              value={interval}
              onChange={onInterval}
              render={(v) => INTERVALS.find(([k]) => k === v)![1]}
            />
            <Select
              aria-label="Period"
              value={chosen.start}
              onChange={(e) => onPeriod(e.target.value)}
            >
              {rows.map((r) => (
                <option key={r.start} value={r.start}>
                  {periodTitle(r, interval)}
                </option>
              ))}
            </Select>
            <Button
              variant="outline"
              title="Download the periods as a CSV file"
              onClick={() =>
                downloadCsv(
                  `${subject.name.toLowerCase().replace(/\W+/g, '-')}-by-period.csv`,
                  toCsv(
                    ['Period start', 'Period end', subject.name],
                    rows.map((r) => [r.start, r.end, r.value]),
                  ),
                )
              }
            >
              <Download size={14} /> CSV
            </Button>
          </>
        }
      >
        <div role="img" aria-label={`${subject.name} per period`}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={rows}
              margin={{ top: 10, right: average === null ? 10 : 104, bottom: 0, left: 0 }}
            >
              <XAxis
                dataKey="label"
                tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                minTickGap={24}
                axisLine={false}
                tickLine={false}
              />
              {average !== null && rows.length > 1 && (
                <ReferenceLine
                  y={average}
                  stroke="var(--chart-tick)"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                  label={{
                    value: isPrivate() ? 'Average' : `Average ${cash(average)}`,
                    position: 'right',
                    fill: 'var(--chart-tick)',
                    fontSize: 11,
                  }}
                />
              )}
              <Tooltip
                contentStyle={tooltipStyle}
                itemStyle={{ color: 'var(--tip-text)' }}
                cursor={{ fill: 'var(--chart-cursor)' }}
                formatter={(v: any) => [cash(Number(v)), subject.name]}
              />
              <Bar
                dataKey="amount"
                name={subject.name}
                radius={[7, 7, 2, 2]}
                isAnimationActive={false}
                cursor="pointer"
                onClick={(_: any, i: number) => onPeriod(rows[i].start)}
              >
                {rows.map((r) => (
                  <Cell
                    key={r.start}
                    fill={color}
                    fillOpacity={r.start === chosen.start ? 1 : 0.5}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ReportCard>
      <PeriodDetail
        key={period.start + interval}
        period={period}
        label={periodTitle(period, interval) + (period.partial ? ' (so far)' : '')}
        subject={subject}
        type={type}
        scope={scope}
        categories={categories}
        refreshKey={refreshKey}
        onChanged={onChanged}
      />
    </>
  );
}
