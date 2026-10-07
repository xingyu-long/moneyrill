import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { cash } from '../../lib/format.ts';
import { rangeLabel } from '../../lib/reportDates.ts';
import { downloadCsv, legend, toCsv } from '../../lib/reports.ts';
import { useReport } from '../../state/useReport.ts';
import type { Category, CategoryReport as Report, ReportCategory } from '../../types.ts';
import { tooltipStyle } from '../chartStyle.ts';
import { CategorySummary, ReportCard, ReportTransactions } from './parts.tsx';
import { Button } from '../ui/button.tsx';
import { EMPTY, SPLIT } from './styles.ts';
import { scopeParams, type Scope } from './scope.ts';

const TITLE = { expense: 'Spending', income: 'Income' } as const;

/** Spending or Income: where the money went (or came from) as a donut, the transactions behind it, and a summary. */
export function CategoryReport({
  type,
  scope,
  categories,
  refreshKey,
  production,
  onChanged,
  onOpenCategory,
}: {
  type: 'income' | 'expense';
  scope: Scope;
  categories: Category[];
  refreshKey: unknown;
  production: boolean;
  /** An edit in the drawer may move money between categories or out of this report. */
  onChanged: () => void;
  /** Clicking a category opens its own history. */
  onOpenCategory: (category: ReportCategory) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const base = scopeParams(scope);
  const scopeKey = JSON.stringify(base) + type;
  useEffect(() => setShowAll(false), [scopeKey]);
  const { data, loading, error } = useReport<Report>('categories', { ...base, type }, refreshKey);
  const filtered = !!(scope.categories.length || scope.accounts.length);
  const noun = type === 'expense' ? 'spending' : 'income';
  if (error && !data) return <p className={EMPTY}>{error}</p>;
  if (!data) return <p className={EMPTY}>{loading ? 'Loading…' : ''}</p>;
  const lg = legend(data.slices);
  const items = showAll ? lg.all : lg.items;
  const drawn = lg.all;
  const s = data.summary;
  const open = (id: number | undefined) => {
    const slice = data.slices.find((x) => x.category.id === id);
    if (slice) onOpenCategory(slice.category);
  };
  return (
    <>
      <ReportCard
        label={TITLE[type] + ' by category'}
        title={rangeLabel(scope.from ?? s.first_date, scope.to ?? s.last_date)}
        tools={
          <Button
            variant="outline"
            title="Download the categories as a CSV file"
            onClick={() =>
              downloadCsv(
                `${noun}-by-category.csv`,
                toCsv(
                  ['Category', 'Group', 'Amount', 'Share (%)'],
                  data.slices.map((x) => [x.category.name, x.category.group, x.amount, x.share]),
                ),
              )
            }
          >
            <Download size={14} /> CSV
          </Button>
        }
      >
        {!drawn.length ? (
          <p className={EMPTY}>
            {filtered
              ? `No ${noun} matches these filters.`
              : scope.from || scope.to
                ? `No ${noun} in this date range. Choose another range (Clear shows all time).`
                : production
                  ? `No ${noun} yet. It appears after a bank or card account syncs, or after the Monarch import.`
                  : 'No transactions yet. Load the sandbox samples in Settings, then sync.'}
          </p>
        ) : (
          <div className="grid items-center gap-6 min-[761px]:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
            <div className="relative" role="img" aria-label={`${TITLE[type]} by category`}>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={lg.items.map((i) => ({ ...i, value: Number(i.amount) }))}
                    dataKey="value"
                    nameKey="label"
                    innerRadius="78%"
                    outerRadius="100%"
                    stroke="none"
                    startAngle={90}
                    endAngle={-270}
                    isAnimationActive={false}
                    cursor="pointer"
                    onClick={(d: any) => open(d?.payload?.id ?? d?.id)}
                  >
                    {lg.items.map((i) => (
                      <Cell key={i.key} fill={i.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={tooltipStyle}
                    itemStyle={{ color: 'var(--tip-text)' }}
                    formatter={(v: any, _n: any, item: any) =>
                      `${cash(Number(v))} (${item?.payload?.share ?? ''}%)`
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
                <strong className="text-lg font-medium">{cash(Number(data.total))}</strong>
                <span className="text-[11px] text-muted-foreground">Total</span>
              </div>
            </div>
            <div>
              <ul className="m-0 mb-2 grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-3.5 gap-y-1 p-0">
                {items.map((i) => (
                  <li key={i.key}>
                    <button
                      className="grid w-full grid-cols-[10px_1fr] gap-x-2 gap-y-0.5 rounded-xl px-2 py-1.5 text-left text-xs enabled:hover:bg-accent"
                      disabled={i.id === undefined}
                      title={i.id === undefined ? undefined : 'Show this category month by month'}
                      onClick={() => open(i.id)}
                    >
                      <i
                        className="mt-[3px] size-2.5 rounded-full"
                        style={{ background: i.color }}
                      />
                      <span>{i.label}</span>
                      <small className="col-start-2 text-[11px] text-muted-foreground">
                        {cash(Number(i.amount))} ({i.share}%)
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
              {lg.all.length > lg.items.length || showAll ? (
                <button
                  className="text-[11px] text-positive underline"
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll ? 'Show fewer categories' : 'Show all categories'}
                </button>
              ) : null}
            </div>
          </div>
        )}
      </ReportCard>
      <div className={SPLIT}>
        <ReportTransactions
          filters={{
            from: scope.from,
            to: scope.to,
            type,
            categories: scope.categories,
            accounts: scope.accounts,
          }}
          categories={categories}
          refreshKey={refreshKey}
          onChanged={onChanged}
        />
        <CategorySummary type={type} report={data} />
      </div>
    </>
  );
}
